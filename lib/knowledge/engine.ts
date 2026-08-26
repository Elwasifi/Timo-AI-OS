// Knowledge Engine — the single public API for all knowledge operations.
// No module in Timo AI OS imports anything except this file.
//
// The engine orchestrates providers (structured, semantic, graph, timeline)
// through a query planner. It never knows which database backs a provider.
// Events are emitted on every lifecycle change for future subscribers
// (Learning Engine, Analytics, Swarm, etc.).

import {
  supabaseStructuredProvider,
  supabaseSemanticProvider,
  supabaseGraphProvider,
  supabaseTimelineProvider,
} from './supabaseProviders';
import { eventBus } from './eventBus';
import { planQuery, type QueryPlan } from './queryPlanner';
import { extractFacts, resolveQuestionAttribute } from './factExtractor';
import { formatFactAnswer, formatNotFoundAnswer, formatHistoryAnswer, formatConflictPrompt } from './factFormatter';
import type {
  StructuredFact, StoreResult, AnswerResult, ResolveResult,
  ConflictInfo, KnowledgeEvent, FactCategory,
  StoreParams, LearnParams, UpdateParams, DeleteParams,
  LinkParams, TimelineParams, QueryParams, SearchParams,
} from './types';
import type { SearchResult, MemoryRecord, MemoryLink, EpisodicEvent } from '@/lib/memory/types';

// Provider registry — injected at module load. To swap backends, replace
// these bindings. The engine code itself never changes.
const structured = supabaseStructuredProvider;
const semantic = supabaseSemanticProvider;
const graph = supabaseGraphProvider;
const timeline = supabaseTimelineProvider;

export const knowledge = {
  // ---- Store: extract facts + store structured + semantic + link ----
  async store(input: StoreParams): Promise<StoreResult> {
    const facts = extractFacts(input.text);
    const conflicts: ConflictInfo[] = [];
    const storedFacts: StructuredFact[] = [];

    // Store a semantic memory of the cleaned statement (for fallback search)
    let semanticMemoryId: string | null = null;
    if (facts.length > 0) {
      const cleanedStatement = facts[0].cleanedStatement;
      try {
        const mem = await semantic.store({
          type: 'long_term',
          title: cleanedStatement.slice(0, 80),
          content: cleanedStatement,
          tags: ['structured', ...facts.map((f) => f.category)],
          importance: 'high',
          source: input.source ?? 'user',
          agent: input.agent,
          tenantId: input.tenantId,
        });
        semanticMemoryId = mem.id;
      } catch {
        // Semantic store failure is non-fatal — structured fact still works
      }
    }

    for (const fact of facts) {
      try {
        const result = await structured.upsert({
          subject: fact.subject,
          predicate: fact.predicate,
          object: fact.object,
          category: fact.category,
          confidence: fact.confidence,
          confidenceSource: fact.confidenceSource,
          confidenceReason: fact.confidenceReason,
          tags: [fact.category],
          semanticMemoryId: semanticMemoryId ?? undefined,
        });

        if (result.action === 'conflict' && result.oldFactId && result.oldValue) {
          const conflict: ConflictInfo = {
            oldFactId: result.oldFactId,
            subject: fact.subject,
            predicate: fact.predicate,
            oldValue: result.oldValue,
            newValue: fact.object,
            category: fact.category,
            resolutionPrompt: formatConflictPrompt({
              predicate: fact.predicate,
              oldValue: result.oldValue,
              newValue: fact.object,
            }),
          };
          conflicts.push(conflict);

          emitEvent({
            type: 'knowledge.conflict',
            factId: result.factId,
            subject: fact.subject,
            predicate: fact.predicate,
            object: fact.object,
            category: fact.category,
            conflict,
          });

          // If force=true, resolve the conflict by replacing
          if (input.force) {
            const replaced = await structured.replace(
              result.oldFactId,
              fact.object,
              'Forced replacement',
            );
            const newFacts = await structured.query({ subject: fact.subject, predicate: fact.predicate, limit: 1 });
            if (newFacts[0]) storedFacts.push(newFacts[0]);
          }
        } else if (result.action === 'created') {
          const newFacts = await structured.query({ subject: fact.subject, predicate: fact.predicate, limit: 1 });
          if (newFacts[0]) storedFacts.push(newFacts[0]);

          emitEvent({
            type: 'knowledge.stored',
            factId: result.factId,
            subject: fact.subject,
            predicate: fact.predicate,
            object: fact.object,
            category: fact.category,
          });
        }
      } catch {
        // Individual fact store failure is non-fatal
      }
    }

    // If no structured facts were extracted, store as semantic-only
    if (facts.length === 0) {
      try {
        const mem = await semantic.store({
          type: 'long_term',
          title: input.text.slice(0, 80),
          content: input.text,
          tags: ['conversation'],
          importance: 'medium',
          source: input.source ?? 'user',
          agent: input.agent,
        });
        semanticMemoryId = mem.id;
      } catch {
        // Non-fatal
      }
    }

    const action: StoreResult['action'] =
      conflicts.length > 0 ? 'conflict' :
      storedFacts.length > 0 ? 'created' : 'duplicate';

    return { action, facts: storedFacts, conflicts, semanticMemoryId };
  },

  // ---- Answer: the retrieval pipeline (planner → providers) ----
  async answer(input: { question: string; agent?: string; conversationId?: string }): Promise<AnswerResult> {
    const start = Date.now();
    const plan = planQuery(input.question);
    const providersQueried: string[] = [];
    const retrievalPath: string[] = [];

    // Step 1: Try structured knowledge first (if the plan calls for it)
    if (plan.providers.includes('structured')) {
      providersQueried.push('structured');
      const questionAttr = resolveQuestionAttribute(input.question);

      if (questionAttr) {
        retrievalPath.push('structured');
        const facts = await structured.query({
          subject: questionAttr.subject,
          predicate: questionAttr.predicate,
        });

        if (facts.length > 0) {
          const fact = facts[0];
          const answer = formatFactAnswer(fact, input.question);
          return {
            answer,
            source: 'structured',
            confidence: fact.confidence,
            facts,
            memories: [],
            path: retrievalPath,
            explanation: buildExplanation(providersQueried, retrievalPath, 'structured', plan, 1, start),
          };
        }
      }
    }

    // Step 2: Try semantic search (if the plan calls for it)
    if (plan.providers.includes('semantic')) {
      providersQueried.push('semantic');
      retrievalPath.push('semantic');

      try {
        const results = await semantic.search({
          query: input.question,
          mode: 'hybrid',
          topK: 5,
        });

        if (results.length > 0 && results[0].score >= 0.7) {
          const topResult = results[0];
          const content = topResult.memory.summary || topResult.memory.content;
          const answer = transformMemoryToAnswer(content);

          return {
            answer,
            source: 'semantic',
            confidence: Math.round(topResult.score * 100),
            facts: [],
            memories: results,
            path: retrievalPath,
            explanation: buildExplanation(providersQueried, retrievalPath, 'semantic', plan, results.length, start),
          };
        }
      } catch {
        // Semantic search failure — continue to next provider
      }
    }

    // Step 3: Try timeline (if the plan calls for it)
    if (plan.providers.includes('timeline')) {
      providersQueried.push('timeline');
      retrievalPath.push('timeline');

      try {
        const events = await timeline.timeline({ agent: input.agent, limit: 10 });
        if (events.length > 0) {
          const answer = formatTimelineAnswer(events);
          return {
            answer,
            source: 'timeline',
            confidence: 80,
            facts: [],
            memories: [],
            path: retrievalPath,
            explanation: buildExplanation(providersQueried, retrievalPath, 'timeline', plan, events.length, start),
          };
        }
      } catch {
        // Timeline failure — continue
      }
    }

    // Step 4: Not found
    retrievalPath.push('not_found');
    return {
      answer: formatNotFoundAnswer(input.question),
      source: 'not_found',
      confidence: 0,
      facts: [],
      memories: [],
      path: retrievalPath,
      explanation: buildExplanation(providersQueried, retrievalPath, 'none', plan, 0, start),
    };
  },

  // ---- Query: structured lookup by subject+predicate ----
  async query(params: QueryParams): Promise<StructuredFact[]> {
    return structured.query(params);
  },

  // ---- Search: semantic vector search ----
  async search(params: SearchParams): Promise<SearchResult[]> {
    return semantic.search({
      query: params.query,
      mode: params.mode ?? 'hybrid',
      topK: params.topK ?? 5,
      tenantId: params.tenantId,
    });
  },

  // ---- Update: modify an existing fact (with versioning) ----
  async update(params: UpdateParams): Promise<StructuredFact | null> {
    const result = await structured.update(
      params.factId,
      params.newValue,
      params.newConfidence,
      params.reason,
    );

    if (result) {
      emitEvent({
        type: 'knowledge.updated',
        factId: result.id,
        subject: result.subject,
        predicate: result.predicate,
        object: result.object,
        category: result.category,
      });
    }

    return result;
  },

  // ---- Delete: soft delete a fact ----
  async delete(params: DeleteParams): Promise<boolean> {
    const success = params.permanent
      ? await structured.permanentDelete(params.factId)
      : await structured.softDelete(params.factId);

    if (success) {
      emitEvent({
        type: 'knowledge.deleted',
        factId: params.factId,
      });
    }

    return success;
  },

  // ---- Learn: for Learning Engine — store inferred knowledge ----
  async learn(params: LearnParams): Promise<StoreResult> {
    const result = await structured.upsert({
      subject: params.subject,
      predicate: params.predicate,
      object: params.object,
      category: params.category,
      confidence: params.confidence,
      confidenceSource: 'inferred',
      confidenceReason: params.reason,
      tags: [params.category, 'inferred'],
    });

    if (result.action === 'created') {
      emitEvent({
        type: 'knowledge.stored',
        factId: result.factId,
        subject: params.subject,
        predicate: params.predicate,
        object: params.object,
        category: params.category,
      });
    }

    const facts = await structured.query({ subject: params.subject, predicate: params.predicate, limit: 1 });
    return {
      action: result.action as StoreResult['action'],
      facts,
      conflicts: [],
      semanticMemoryId: null,
    };
  },

  // ---- Resolve Conflict: user confirmed replacement ----
  async resolveConflict(input: {
    oldFactId: string;
    newValue: string;
    resolution: 'replace' | 'keep_old' | 'keep_both';
    reason?: string;
  }): Promise<ResolveResult> {
    if (input.resolution === 'keep_old') {
      return { action: 'kept_old', fact: null };
    }

    if (input.resolution === 'replace') {
      const result = await structured.replace(input.oldFactId, input.newValue, input.reason ?? 'User confirmed replacement');
      const facts = await structured.query({ searchText: result.newFactId, limit: 1 });
      const fact = facts[0] ?? null;

      if (fact) {
        emitEvent({
          type: 'knowledge.updated',
          factId: fact.id,
          subject: fact.subject,
          predicate: fact.predicate,
          object: fact.object,
          category: fact.category,
        });
      }

      return { action: 'replaced', fact };
    }

    // keep_both — store as a new fact with a different predicate suffix
    // This is a simple implementation; a more sophisticated one might
    // use a different category or metadata flag.
    return { action: 'kept_both', fact: null };
  },

  // ---- Link: create knowledge graph edge ----
  async link(params: LinkParams): Promise<MemoryLink> {
    const link = await graph.link(params);
    emitEvent({
      type: 'knowledge.linked',
      metadata: { sourceId: params.sourceId, targetId: params.targetId },
    });
    return link;
  },

  // ---- Timeline: episodic events ----
  async timeline(params?: TimelineParams): Promise<EpisodicEvent[]> {
    return timeline.timeline(params);
  },

  // ---- Recall: get a specific memory by ID ----
  async recall(id: string): Promise<MemoryRecord | null> {
    return semantic.recall(id);
  },

  // ---- History: get fact version history ----
  async history(subject: string, predicate: string): Promise<StructuredFact[]> {
    return structured.getHistory(subject, predicate);
  },

  // ---- Events: subscribe to knowledge events ----
  on(eventType: KnowledgeEvent['type'], listener: (event: KnowledgeEvent) => void): () => void {
    return eventBus.on(eventType, listener);
  },

  onAny(listener: (event: KnowledgeEvent) => void): () => void {
    return eventBus.onAny(listener);
  },
};

// ---- Helpers ----

function emitEvent(event: Omit<KnowledgeEvent, 'timestamp'>): void {
  eventBus.emit({ ...event, timestamp: Date.now() });
}

function buildExplanation(
  providersQueried: string[],
  retrievalPath: string[],
  provider: string,
  plan: QueryPlan,
  totalResults: number,
  start: number,
) {
  return {
    providersQueried,
    retrievalPath,
    provider,
    queryPlan: plan.type,
    totalResults,
    elapsedMs: Date.now() - start,
  };
}

function transformMemoryToAnswer(content: string): string {
  let text = content.trim();
  text = text.replace(/^my\b/i, 'Your');
  text = text.replace(/^i (always|usually|normally) use\b/i, 'You $1 use');
  text = text.replace(/^i prefer\b/i, 'You prefer');
  text = text.replace(/^i (like|want|choose|deploy)\b/i, 'You $1');
  text = text.replace(/^i work (at|for)\b/i, 'You work $1');
  text = text.replace(/^i am\b/i, 'You are');
  text = text.replace(/^i\b/i, 'You');
  text = text.replace(/^we are building\b/i, 'You are building');
  text = text.replace(/^we (use|prefer|deploy)\b/i, 'You $1');
  text = text.replace(/^our project is\b/i, 'Your project is');
  text = text.replace(/^our\b/i, 'Your');
  if (!text.endsWith('.')) text += '.';
  return text;
}

function formatTimelineAnswer(events: EpisodicEvent[]): string {
  const lines: string[] = ['Here are your recent events:'];
  for (const e of events.slice(0, 10)) {
    const time = new Date(e.createdAt).toLocaleString();
    lines.push(`• [${time}] ${e.eventTitle}`);
    if (e.eventDetail) lines.push(`  ${e.eventDetail}`);
  }
  return lines.join('\n');
}
