// Memory Decision Engine — Priority 1 in the reasoning pipeline.
// Memory is the Source of Truth. This engine:
//   1. Stores "remember" requests deterministically (no LLM classification)
//   2. Searches memory for queries and returns direct answers when confident
//   3. Returns a "not found" message when memory is empty — NEVER lets the
//      LLM hallucinate an answer that should come from memory.

import { memory } from '@/lib/memory/memoryService';
import { knowledge } from '@/lib/knowledge/engine';
import { loadMemorySettings } from '@/lib/memory/memorySettings';
import { classifyMemory, cleanRememberStatement } from './intent-detector';
import type { SearchResult, EpisodicEvent, RAGContext } from '@/lib/memory/types';
import type { DetectedIntent, MemoryClassification } from './types';

export interface MemoryDecisionResult {
  shouldUseMemory: boolean;
  shouldUseSemanticSearch: boolean;
  shouldUseTimeline: boolean;
  memories: SearchResult[];
  timelineEvents: EpisodicEvent[];
  ragContext: RAGContext | null;
  confidence: number;
  directAnswer: string | null;
  fullyAnswered: boolean;
  // Whether this was a "remember" request that was stored
  wasStored: boolean;
  // The classification applied (for debug panel)
  classification: MemoryClassification | null;
  // Human-readable answer for memory queries (even when not fully confident)
  humanReadableAnswer: string | null;
}

const HIGH_CONFIDENCE_THRESHOLD = 0.75;
const MEDIUM_CONFIDENCE_THRESHOLD = 0.55;

export async function decideMemory(
  input: string,
  intent: DetectedIntent,
  agentId?: string,
  tenantId?: string | null,
): Promise<MemoryDecisionResult> {
  const settings = await loadMemorySettings().catch(() => null);
  const threshold = settings?.similarity_threshold ?? 0.7;

  const shouldUseMemory = intent.asksAboutMemory || intent.asksToRemember;
  const shouldUseTimeline = intent.asksAboutTimeline;
  const shouldUseSemanticSearch = intent.asksAboutMemory && !intent.asksToRemember;

  // ---- RULE #1: "Remember" requests are stored, never sent to the LLM ----
  if (intent.asksToRemember && !intent.asksForToolAction) {
    const classification = classifyMemory(input);
    const cleanedStatement = cleanRememberStatement(input);

    try {
      // Delegate to Knowledge Engine — it extracts structured facts and
      // stores both structured + semantic in one call.
      await knowledge.store({
        text: cleanedStatement,
        source: 'user',
        agent: agentId,
        tenantId,
      });
    } catch {
      // Knowledge Engine failed — fall back to direct semantic store
      try {
        await memory.store({
          type: classification.type,
          title: extractTitle(cleanedStatement),
          content: cleanedStatement,
          tags: classification.tags,
          importance: classification.importance,
          source: 'user',
          agent: agentId,
          tenantId,
        });
      } catch {
        // Storage failed — still return confirmation so user knows we tried
      }
    }

    return {
      shouldUseMemory: true,
      shouldUseSemanticSearch: false,
      shouldUseTimeline: false,
      memories: [],
      timelineEvents: [],
      ragContext: null,
      confidence: 0.95,
      directAnswer: classification.confirmationMessage,
      fullyAnswered: true,
      wasStored: true,
      classification,
      humanReadableAnswer: classification.confirmationMessage,
    };
  }

  // ---- RULE #3: Memory queries must search before any LLM generation ----
  let memories: SearchResult[] = [];
  let ragContext: RAGContext | null = null;

  if (shouldUseSemanticSearch) {
    try {
      ragContext = await memory.retrieveContext(input, { agentId, tenantId });
      memories = ragContext.memories;
    } catch {
      try {
        memories = await memory.search({ query: input, mode: 'keyword', topK: 5, tenantId });
      } catch {
        memories = [];
      }
    }
  }

  // Retrieve timeline if needed
  let timelineEvents: EpisodicEvent[] = [];
  if (shouldUseTimeline) {
    try {
      timelineEvents = await memory.timeline({ limit: 10 });
    } catch {
      timelineEvents = [];
    }
  }

  const topResult = memories.length > 0 ? memories[0] : null;
  const topSimilarity = topResult?.score ?? 0;
  const confidence = topSimilarity;

  let directAnswer: string | null = null;
  let fullyAnswered = false;
  let humanReadableAnswer: string | null = null;

  if (topResult && topSimilarity >= HIGH_CONFIDENCE_THRESHOLD) {
    // High confidence — return the memory directly, no LLM
    directAnswer = formatMemoryAnswer(topResult);
    fullyAnswered = true;
    humanReadableAnswer = directAnswer;
  } else if (topResult && topSimilarity >= MEDIUM_CONFIDENCE_THRESHOLD) {
    // Medium confidence — return as context but let LLM refine
    humanReadableAnswer = formatMemoryAnswer(topResult);
    fullyAnswered = false;
  } else if (shouldUseSemanticSearch && memories.length === 0) {
    // RULE #4: No memory found — return "not found", do NOT let LLM hallucinate
    directAnswer = "I couldn't find this information in your memory.";
    fullyAnswered = true;
    humanReadableAnswer = directAnswer;
  }

  // Timeline requests get a human-readable summary
  if (shouldUseTimeline && timelineEvents.length > 0) {
    humanReadableAnswer = formatTimelineAnswer(timelineEvents);
    directAnswer = humanReadableAnswer;
    fullyAnswered = true;
  } else if (shouldUseTimeline && timelineEvents.length === 0) {
    directAnswer = "You don't have any recent memories or events yet.";
    fullyAnswered = true;
    humanReadableAnswer = directAnswer;
  }

  return {
    shouldUseMemory,
    shouldUseSemanticSearch,
    shouldUseTimeline,
    memories,
    timelineEvents,
    ragContext,
    confidence,
    directAnswer,
    fullyAnswered,
    wasStored: false,
    classification: null,
    humanReadableAnswer,
  };
}

function extractTitle(input: string): string {
  const cleaned = input
    .replace(/^(remember that|remember|i prefer|my favorite|we are building|our project|always|never|from now on|my default|use .{0,15}by default|my preferred|note that|store that|save that|keep in mind that|don'?t forget that)\s*/i, '')
    .trim();
  return cleaned.slice(0, 80) || input.slice(0, 80);
}

// Natural-language answer formatting for retrieved memories.
// Instead of returning the raw stored content, we transform it into a
// conversational answer based on the memory's category and content.
function formatMemoryAnswer(result: SearchResult): string {
  const m = result.memory;
  const content = (m.summary || m.content).slice(0, 200);
  const isPreference = m.tags.includes('preference') || m.title.toLowerCase().includes('prefer') || m.title.toLowerCase().includes('favorite');
  const isProject = m.tags.includes('project');

  if (isPreference) {
    return transformToUserFacing(content, 'preference');
  }
  if (isProject) {
    return transformToUserFacing(content, 'project');
  }
  return transformToUserFacing(content, 'general');
}

// Transform a stored statement into a natural "Your X is Y" answer.
// "my favorite IDE is VS Code" → "Your favorite IDE is VS Code."
function transformToUserFacing(content: string, category: string): string {
  let text = content.trim();
  // Replace first-person possessives with second-person
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
  // Ensure it ends with a period
  if (!text.endsWith('.')) text += '.';
  return text;
}

function formatTimelineAnswer(events: EpisodicEvent[]): string {
  const lines: string[] = ['Recent Memories:', ''];
  for (const e of events.slice(0, 10)) {
    const time = new Date(e.createdAt).toLocaleDateString();
    lines.push(`• ${e.eventTitle} (${e.eventType}) — ${time}`);
  }
  return lines.join('\n');
}
