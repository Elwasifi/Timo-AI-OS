// Context Manager — the mandatory layer between the user request and every
// AI agent. Runs the full reasoning pipeline:
//
//   Intent Detection → Memory Decision → Tool Decision → RAG Retrieval →
//   Context Builder → (returns assembled context to coordinator)
//
// The LLM NEVER receives only the user message. It receives the enriched
// context produced here.

import { memory } from '@/lib/memory/memoryService';
import { knowledgeGraph } from '@/lib/memory/knowledgeGraph';
import { knowledge } from '@/lib/knowledge/engine';
import { detectIntent } from './intent-detector';
import { decideMemory } from './memory-decision';
import { decideTools } from './tool-decision';
import { buildContext } from './context-builder';
import { ConversationService, type ChatMessage } from '@/lib/ai/conversation-service';
import type {
  DetectedIntent, ContextDecisions, ContextManagerResult,
  AssembledContext, ReasoningStep, ContextMetadata, ReasoningPriorityLevel,
} from './types';
import type { Intent } from '@/types';

let stepCounter = 0;

function makeStep(label: string, detail: string, priority: number, status: ReasoningStep['status'] = 'pending'): ReasoningStep {
  return {
    id: `step-${++stepCounter}`,
    label,
    detail,
    status,
    priority: priority as ReasoningPriorityLevel,
    timestamp: Date.now(),
  };
}

export async function runContextManager(
  input: string,
  routingIntent: Intent,
  agentId: string,
  conversationId: string | null,
  agentCount: number,
  tenantId?: string | null,
  isSimulation?: boolean,
  // M5-11: the agent whose AGENT_PERMISSIONS scope decideTools() should
  // check — defaults to `agentId` (unchanged behavior for every existing
  // caller). Lets crew-coordinator.ts pass a worker's own id when this
  // request is about to be delegated, without changing `agentId` itself
  // (which still attributes memory storage/context-building to the
  // routed manager, unaffected — this ticket is scoped to tool
  // permission gating specifically, not memory attribution semantics).
  toolDecisionAgentId?: string,
): Promise<ContextManagerResult> {
  const reasoningSteps: ReasoningStep[] = [];

  // ---- Step 0: Load conversation history ----
  let conversationHistory: ChatMessage[] = [];
  if (conversationId) {
    try {
      const messages = await ConversationService.getMessages(conversationId);
      // Exclude the just-persisted user message (last message) to avoid duplication
      conversationHistory = messages.slice(-11, -1).map((m) => ({
        role: m.role,
        content: m.content,
      }));
    } catch {
      conversationHistory = [];
    }
  }

  // ---- Step 0.5: Structured Knowledge Resolution (Knowledge Engine) ----
  // (Moved below intent detection — needs detectedIntent)

  // ---- Step 1: Intent Detection ----
  const step1 = makeStep('Intent Detection', 'Analyzing user request...', 0, 'active');
  reasoningSteps.push(step1);

  const detectedIntent: DetectedIntent = detectIntent(input, routingIntent);
  step1.status = 'completed';
  step1.detail = `Memory:${detectedIntent.asksAboutMemory} Tool:${detectedIntent.asksForToolAction} Timeline:${detectedIntent.asksAboutTimeline}`;
  step1.durationMs = Date.now() - step1.timestamp;

  // ---- Build decisions from intent ----
  const decisions: ContextDecisions = {
    needMemory: detectedIntent.asksAboutMemory || detectedIntent.asksToRemember,
    needSemanticSearch: detectedIntent.asksAboutMemory && !detectedIntent.asksToRemember,
    needEpisodicMemory: detectedIntent.asksAboutTimeline,
    needTimeline: detectedIntent.asksAboutTimeline,
    needTool: detectedIntent.asksForToolAction,
    needN8n: detectedIntent.toolCategoryHint === 'n8n',
    needGitHub: detectedIntent.toolCategoryHint === 'github',
    needWebSearch: detectedIntent.toolCategoryHint === 'web',
    needWorkflow: detectedIntent.toolCategoryHint === 'n8n',
    needMultipleTools: false,
    needNothing: !detectedIntent.asksAboutMemory && !detectedIntent.asksForToolAction && !detectedIntent.asksAboutTimeline,
  };

  // ---- Step 1.5: Structured Knowledge Resolution (Knowledge Engine) ----
  // Before falling through to semantic memory search, ask the Knowledge Engine
  // if it can answer the question directly from structured facts (O(1)).
  if (detectedIntent.asksAboutMemory && !detectedIntent.asksToRemember) {
    const step1b = makeStep('Knowledge Engine', 'Querying structured knowledge...', 0, 'active');
    reasoningSteps.push(step1b);

    try {
      const answerResult = await knowledge.answer({ question: input, agent: agentId, conversationId: conversationId ?? undefined });
      if (answerResult.source !== 'not_found') {
        step1b.status = 'completed';
        step1b.detail = `Answered by ${answerResult.source} (confidence: ${answerResult.confidence}%)`;
        step1b.durationMs = Date.now() - step1b.timestamp;

        // Skip memory decision, tool decision, and RAG — structured knowledge answered
        const step2skip = makeStep('Memory Decision', 'Skipped — Knowledge Engine answered', 1, 'skipped');
        reasoningSteps.push(step2skip);
        const step3skip = makeStep('Tool Decision', 'Skipped — Knowledge Engine answered', 2, 'skipped');
        reasoningSteps.push(step3skip);
        const step4skip = makeStep('RAG Retrieval', 'Skipped — Knowledge Engine answered', 3, 'skipped');
        reasoningSteps.push(step4skip);
        const step5 = makeStep('Context Builder', 'Answer from structured knowledge', 4, 'completed');
        reasoningSteps.push(step5);

        const context = buildContext({
          userInput: input,
          intent: routingIntent,
          detectedIntent,
          decisions,
          memories: [],
          memoryConfidence: answerResult.confidence / 100,
          memoryClassification: null,
          memoryDecisionReason: `Knowledge Engine answered via ${answerResult.source}.`,
          toolDecisionReason: 'Skipped — Knowledge Engine answered.',
          llmSkipReason: `Knowledge Engine answered with ${answerResult.confidence}% confidence.`,
          timelineEvents: [],
          ragContext: null,
          toolExecutions: [],
          knowledgeGraphRelations: [],
          activeAgent: agentId,
          conversationId,
          agentCount,
          reasoningSteps,
          source: 'memory',
          conversationHistory,
        });

        return {
          context,
          decisions,
          directAnswer: answerResult.answer,
          toolAnswer: null,
          shouldCallLLM: false,
        };
      }
    } catch {
      // Knowledge Engine failure — fall through to memory decision
    }

    step1b.status = 'skipped';
    step1b.detail = 'No structured match found';
    step1b.durationMs = Date.now() - step1b.timestamp;
  }

  // ---- Step 2: Memory Decision (Priority 1) ----
  const step2 = makeStep('Memory Decision', 'Checking memory...', 1, 'active');
  reasoningSteps.push(step2);

  let memoryResult;
  try {
    memoryResult = await decideMemory(input, detectedIntent, agentId, tenantId);
  } catch (e) {
    memoryResult = {
      shouldUseMemory: false,
      shouldUseSemanticSearch: false,
      shouldUseTimeline: false,
      memories: [],
      timelineEvents: [],
      ragContext: null,
      confidence: 0,
      directAnswer: null,
      fullyAnswered: false,
      wasStored: false,
      classification: null,
      humanReadableAnswer: null,
    };
  }

  step2.status = 'completed';
  const memDetail = memoryResult.wasStored
    ? `Stored as ${memoryResult.classification?.label ?? 'Memory'}`
    : `${memoryResult.memories.length} memories found, confidence: ${(memoryResult.confidence * 100).toFixed(0)}%`;
  step2.detail = memDetail;
  step2.durationMs = Date.now() - step2.timestamp;

  // If memory fully answers the question, return immediately — no LLM needed
  if (memoryResult.fullyAnswered && memoryResult.directAnswer) {
    const step3 = makeStep('Tool Decision', 'Skipped — memory fully answered', 2, 'skipped');
    reasoningSteps.push(step3);

    const step4 = makeStep('RAG Retrieval', 'Skipped — memory fully answered', 3, 'skipped');
    reasoningSteps.push(step4);

    const step5 = makeStep('Context Builder', 'Building context from memory...', 4, 'completed');
    reasoningSteps.push(step5);

    const context = buildContext({
      userInput: input,
      intent: routingIntent,
      detectedIntent,
      decisions,
      memories: memoryResult.memories,
      memoryConfidence: memoryResult.confidence,
      memoryClassification: memoryResult.classification?.label ?? null,
      memoryDecisionReason: memoryResult.wasStored
        ? `User asked to remember; classified as ${memoryResult.classification?.label ?? 'Memory'} and stored.`
        : `Memory match confidence ${(memoryResult.confidence * 100).toFixed(0)}% >= threshold; returning stored memory directly.`,
      toolDecisionReason: 'Skipped — memory fully answered the question.',
      llmSkipReason: memoryResult.wasStored
        ? 'Memory was stored; confirmation returned to user.'
        : 'Memory answered with high confidence; LLM not needed.',
      timelineEvents: memoryResult.timelineEvents,
      ragContext: memoryResult.ragContext,
      toolExecutions: [],
      knowledgeGraphRelations: [],
      activeAgent: agentId,
      conversationId,
      agentCount,
      reasoningSteps,
      source: 'memory',
      conversationHistory,
    });

    return {
      context,
      decisions,
      directAnswer: memoryResult.directAnswer,
      toolAnswer: null,
      shouldCallLLM: false,
    };
  }

  // ---- Step 3: Tool Decision (Priority 2) ----
  const step3 = makeStep('Tool Decision', 'Checking available tools...', 2, 'active');
  reasoningSteps.push(step3);

  let toolResult;
  try {
    toolResult = await decideTools(input, detectedIntent, toolDecisionAgentId ?? agentId, tenantId, isSimulation);
  } catch (e) {
    toolResult = {
      shouldUseTool: false,
      selectedToolIds: [],
      executions: [],
      toolAnswer: null,
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    };
  }

  step3.status = toolResult.shouldUseTool ? 'completed' : 'skipped';
  step3.detail = toolResult.shouldUseTool
    ? `${toolResult.selectedToolIds.length} tool(s): ${toolResult.selectedToolIds.join(', ')}`
    : 'No tool action needed';
  step3.durationMs = Date.now() - step3.timestamp;

  // If a tool produced the complete answer, return it
  if (toolResult.toolAnswer && toolResult.success) {
    const step4 = makeStep('RAG Retrieval', 'Skipped — tool fully answered', 3, 'skipped');
    reasoningSteps.push(step4);

    const step5 = makeStep('Context Builder', 'Building context from tool results...', 4, 'completed');
    reasoningSteps.push(step5);

    const context = buildContext({
      userInput: input,
      intent: routingIntent,
      detectedIntent,
      decisions,
      memories: memoryResult.memories,
      memoryConfidence: memoryResult.confidence,
      memoryClassification: null,
      memoryDecisionReason: 'Memory did not fully answer; proceeding to tools.',
      toolDecisionReason: `Tool matched user request category '${detectedIntent.toolCategoryHint}'; executed ${toolResult.selectedToolIds.length} tool(s).`,
      llmSkipReason: 'Tool produced a complete answer; LLM not needed.',
      timelineEvents: memoryResult.timelineEvents,
      ragContext: memoryResult.ragContext,
      toolExecutions: toolResult.executions,
      knowledgeGraphRelations: [],
      activeAgent: agentId,
      conversationId,
      agentCount,
      reasoningSteps,
      source: 'tool',
      conversationHistory,
    });

    return {
      context,
      decisions,
      directAnswer: null,
      toolAnswer: toolResult.toolAnswer,
      shouldCallLLM: false,
    };
  }

  // ---- Step 4: RAG Retrieval (Priority 3) ----
  const step4 = makeStep('RAG Retrieval', 'Retrieving additional context...', 3, 'active');
  reasoningSteps.push(step4);

  // RAG was already partially done in memory decision; if memory was partial,
  // we already have the ragContext. If no memory was needed but we still
  // want context, retrieve now.
  let ragContext = memoryResult.ragContext;
  if (!ragContext && decisions.needMemory) {
    try {
      ragContext = await memory.retrieveContext(input, { agentId, tenantId });
    } catch {
      ragContext = null;
    }
  }

  step4.status = ragContext?.injected ? 'completed' : 'skipped';
  step4.detail = ragContext?.injected ? `${ragContext.totalFound} documents retrieved` : 'No additional context';
  step4.durationMs = Date.now() - step4.timestamp;

  // ---- Step 5: Knowledge Graph Relations ----
  let knowledgeGraphRelations: string[] = [];
  if (memoryResult.memories.length > 0) {
    try {
      const topMemoryId = memoryResult.memories[0].memory.id;
      const neighborIds = await knowledgeGraph.getNeighbors(topMemoryId);
      knowledgeGraphRelations = neighborIds.map((id) => `${topMemoryId} → relates_to → ${id}`);
    } catch {
      knowledgeGraphRelations = [];
    }
  }

  // ---- Step 6: Context Builder ----
  const step5 = makeStep('Context Builder', 'Merging all context sources...', 4, 'completed');
  reasoningSteps.push(step5);

  const source: ContextMetadata['source'] =
    memoryResult.memories.length > 0 && toolResult.executions.length > 0 ? 'hybrid' :
    memoryResult.memories.length > 0 ? 'memory' :
    toolResult.executions.length > 0 ? 'tool' :
    ragContext?.injected ? 'rag' : 'llm';

  const context = buildContext({
    userInput: input,
    intent: routingIntent,
    detectedIntent,
    decisions,
    memories: memoryResult.memories,
    memoryConfidence: memoryResult.confidence,
    memoryClassification: null,
    memoryDecisionReason: 'Memory did not fully answer; using as context for LLM.',
    toolDecisionReason: toolResult.shouldUseTool
      ? `Tool executed but did not produce a complete answer; results passed to LLM as context.`
      : 'No tool action needed for this request.',
    llmSkipReason: null,
    timelineEvents: memoryResult.timelineEvents,
    ragContext,
    toolExecutions: toolResult.executions,
    knowledgeGraphRelations,
    activeAgent: agentId,
    conversationId,
    agentCount,
    reasoningSteps,
    source,
    conversationHistory,
  });

  step5.detail = `Prompt size: ${context.unifiedPrompt.length} chars`;
  step5.durationMs = Date.now() - step5.timestamp;

  return {
    context,
    decisions,
    directAnswer: null,
    toolAnswer: null,
    shouldCallLLM: true,
  };
}
