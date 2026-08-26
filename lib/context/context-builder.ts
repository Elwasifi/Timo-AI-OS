// Context Builder — merges all context sources into a single unified prompt
// that every agent receives. No agent may build its own isolated context.

import type {
  AssembledContext, ContextDecisions, DetectedIntent, ToolExecutionRecord,
  ReasoningStep, ContextMetadata,
} from './types';
import type { Intent } from '@/types';
import type { SearchResult, EpisodicEvent, RAGContext } from '@/lib/memory/types';
import type { ChatMessage } from '@/lib/ai/conversation-service';

export interface ContextBuilderInput {
  userInput: string;
  intent: Intent;
  detectedIntent: DetectedIntent;
  decisions: ContextDecisions;
  memories: SearchResult[];
  memoryConfidence: number;
  memoryClassification: string | null;
  memoryDecisionReason: string | null;
  toolDecisionReason: string | null;
  llmSkipReason: string | null;
  timelineEvents: EpisodicEvent[];
  ragContext: RAGContext | null;
  toolExecutions: ToolExecutionRecord[];
  knowledgeGraphRelations: string[];
  activeAgent: string;
  conversationId: string | null;
  agentCount: number;
  reasoningSteps: ReasoningStep[];
  source: ContextMetadata['source'];
  conversationHistory: ChatMessage[];
}

export function buildContext(input: ContextBuilderInput): AssembledContext {
  const unifiedPrompt = assemblePrompt(input);

  const toolsUsed = input.toolExecutions.length > 0;
  const workflowUsed = input.toolExecutions.some((e) => e.toolId.startsWith('n8n.'));
  const memoryUsed = input.memories.length > 0;
  const timelineUsed = input.timelineEvents.length > 0;
  const ragUsed = input.ragContext?.injected ?? false;

  const metadata: ContextMetadata = {
    intent: input.intent.category,
    memorySearch: input.decisions.needMemory,
    retrievedMemories: input.memories.length,
    memoryClassification: input.memoryClassification ?? null,
    memoryMatchScore: input.memoryConfidence,
    memoryDecisionReason: input.memoryDecisionReason ?? null,
    toolDecisionReason: input.toolDecisionReason ?? null,
    llmSkipReason: input.llmSkipReason ?? null,
    toolsSelected: input.toolExecutions.map((e) => e.toolId),
    toolsExecuted: input.toolExecutions.map((e) => e.toolId),
    toolResults: input.toolExecutions.filter((e) => e.success).length,
    workflowSelected: workflowUsed,
    ragDocuments: input.ragContext?.totalFound ?? 0,
    promptSize: unifiedPrompt.length,
    reasoningTimeline: input.reasoningSteps,
    confidenceScore: input.memoryConfidence,
    finalAgent: input.activeAgent,
    reasoningPath: buildReasoningPath(input),
    source: input.source,
  };

  return {
    userInput: input.userInput,
    intent: input.intent,
    memories: input.memories,
    memoryConfidence: input.memoryConfidence,
    memoryUsed,
    timelineEvents: input.timelineEvents,
    timelineUsed,
    ragContext: input.ragContext,
    ragUsed,
    toolExecutions: input.toolExecutions,
    toolsUsed,
    workflowUsed,
    knowledgeGraphRelations: input.knowledgeGraphRelations,
    conversationHistory: input.conversationHistory,
    systemState: {
      activeAgent: input.activeAgent,
      conversationId: input.conversationId,
      agentCount: input.agentCount,
    },
    unifiedPrompt,
    metadata,
  };
}

function assemblePrompt(input: ContextBuilderInput): string {
  const sections: string[] = [];

  // 0. Conversation History (so the LLM has multi-turn context)
  const history = input.conversationHistory.slice(-10);
  if (history.length > 0) {
    sections.push('--- CONVERSATION HISTORY ---');
    sections.push('Recent messages from this conversation. Use this for context — do not re-answer old questions.');
    for (const msg of history) {
      const role = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'System';
      const content = msg.content.slice(0, 500);
      sections.push(`${role}: ${content}`);
    }
    sections.push('');
  }

  // 1. Relevant Memories (Priority 1)
  if (input.memories.length > 0) {
    sections.push('--- RELEVANT MEMORIES (Priority 1) ---');
    sections.push('The following memories are known facts about the user. Use these to answer. Do NOT contradict or hallucinate beyond these.');
    for (const r of input.memories.slice(0, 5)) {
      const m = r.memory;
      const importance = m.importance !== 'medium' ? `[${m.importance.toUpperCase()}] ` : '';
      const tags = m.tags.length > 0 ? ` #${m.tags.join(' #')}` : '';
      sections.push(`${importance}${m.title}${tags}`);
      sections.push(m.content.slice(0, 300));
      if (m.summary) sections.push(`Summary: ${m.summary}`);
      sections.push('');
    }
  }

  // 2. Tool Results (Priority 2)
  const successfulTools = input.toolExecutions.filter((e) => e.success);
  if (successfulTools.length > 0) {
    sections.push('--- TOOL RESULTS (Priority 2) ---');
    sections.push('The following data was retrieved by executing tools. This is real data — present it to the user. Do NOT fabricate or guess.');
    for (const e of successfulTools) {
      sections.push(`Tool: ${e.toolName} (${e.toolId})`);
      const data = extractToolData(e.result);
      if (data) {
        sections.push(formatToolData(data));
      }
      sections.push('');
    }
  }

  // 3. RAG Documents (Priority 3)
  if (input.ragContext?.injected) {
    sections.push('--- RAG CONTEXT (Priority 3) ---');
    sections.push(input.ragContext.summary);
    sections.push('');
  }

  // 4. Timeline Events
  if (input.timelineEvents.length > 0) {
    sections.push('--- TIMELINE EVENTS ---');
    for (const e of input.timelineEvents.slice(0, 10)) {
      sections.push(`[${new Date(e.createdAt).toLocaleString()}] ${e.eventTitle} (${e.eventType})`);
      if (e.eventDetail) sections.push(`  ${e.eventDetail}`);
    }
    sections.push('');
  }

  // 5. Knowledge Graph Relations
  if (input.knowledgeGraphRelations.length > 0) {
    sections.push('--- KNOWLEDGE GRAPH RELATIONS ---');
    for (const rel of input.knowledgeGraphRelations) {
      sections.push(rel);
    }
    sections.push('');
  }

  // 6. System State
  sections.push('--- SYSTEM STATE ---');
  sections.push(`Active Agent: ${input.activeAgent}`);
  sections.push(`Conversation: ${input.conversationId ?? 'new'}`);
  sections.push(`Agent Count: ${input.agentCount}`);
  sections.push('');

  // 7. Instructions
  sections.push('--- INSTRUCTIONS ---');
  sections.push('Priority order: Memory > Tools > RAG > LLM knowledge.');
    sections.push('If memories above answer the question, use them. Do not invent.');
    sections.push('If tool results above answer the question, present them. Do not guess.');
    sections.push('Only use your own knowledge if memories and tools did not provide an answer.');

  return sections.join('\n');
}

// Convert tool data to human-readable text instead of raw JSON.
function formatToolData(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data === null || data === undefined) return 'No data returned.';
  if (Array.isArray(data)) {
    if (data.length === 0) return 'No items found.';
    return data.map((item, i) => formatObjectAsHumanReadable(item as Record<string, unknown>, `item${i}`)).join('\n');
  }
  if (typeof data === 'object') {
    return formatObjectAsHumanReadable(data as Record<string, unknown>, 'result');
  }
  return String(data);
}

function formatObjectAsHumanReadable(obj: Record<string, unknown>, prefix: string): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    if (value === null || value === undefined) continue;
    if (typeof value === 'object') {
      lines.push(`${label}:`);
      lines.push(formatToolData(value).split('\n').map((l) => `  ${l}`).join('\n'));
    } else {
      lines.push(`${label}: ${value}`);
    }
  }
  return lines.length > 0 ? lines.join('\n') : `${prefix}: (empty)`;
}

function buildReasoningPath(input: ContextBuilderInput): string {
  const steps: string[] = [];
  if (input.memories.length > 0) steps.push(`Memory(${input.memories.length})`);
  if (input.toolExecutions.length > 0) steps.push(`Tools(${input.toolExecutions.length})`);
  if (input.ragContext?.injected) steps.push('RAG');
  steps.push('LLM');
  return steps.join(' → ');
}

function extractToolData(result: unknown): unknown {
  if (typeof result !== 'object' || result === null) return null;
  const r = result as Record<string, unknown>;
  if ('data' in r) return r.data;
  if ('results' in r) {
    const results = r.results as Array<Record<string, unknown>>;
    const last = results[results.length - 1];
    return last?.data ?? null;
  }
  return null;
}
