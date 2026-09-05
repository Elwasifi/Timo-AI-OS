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
import { decideTools, type ToolDecisionResult } from './tool-decision';
import { buildContext } from './context-builder';
import { runAgentLoop } from '@/lib/swarm/agentLoop';
import { getAgentById } from '@/lib/agents/agentRegistryService';
import { getApproval } from '@/lib/governance/approvals';
import { ConversationService, type ChatMessage } from '@/lib/ai/conversation-service';
import type {
  DetectedIntent, ContextDecisions, ContextManagerResult,
  AssembledContext, ReasoningStep, ContextMetadata, ReasoningPriorityLevel,
} from './types';
import type { MemoryDecisionResult } from './memory-decision';
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
      const answerResult = await knowledge.answer({ question: input, agent: agentId, conversationId: conversationId ?? undefined, tenantId });
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
  const memDetail = memoryResult.classification
    ? memoryResult.wasStored
      ? `Stored as ${memoryResult.classification.label}`
      : `Storage failed — not stored (${memoryResult.classification.label})`
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
      // M6-01: this used to branch on wasStored, which now correctly
      // distinguishes "stored" from "attempted but failed" for a remember
      // request — classification !== null is the real signal for "this was
      // a remember request" regardless of whether storage succeeded.
      memoryDecisionReason: memoryResult.classification
        ? memoryResult.wasStored
          ? `User asked to remember; classified as ${memoryResult.classification.label} and stored.`
          : `User asked to remember; classified as ${memoryResult.classification.label} but storage failed — reported honestly, not stored.`
        : `Memory match confidence ${(memoryResult.confidence * 100).toFixed(0)}% >= threshold; returning stored memory directly.`,
      toolDecisionReason: 'Skipped — memory fully answered the question.',
      llmSkipReason: memoryResult.classification
        ? memoryResult.wasStored
          ? 'Memory was stored; confirmation returned to user.'
          : 'Memory storage failed; failure reported to user instead of a false confirmation.'
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
      outcome: 'attempted_failed' as const,
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

  // M7-04 bugfix (found live during this ticket's own E2E test, same day):
  // the upfront decideTools() planner can plan several tool calls in one
  // batch (e.g. "show me X, then delete it" -> memory.recall +
  // memory.forget). A gated call among them now comes back tagged
  // outcome: 'pending_approval' instead of ever reaching 'attempted_failed'
  // (see tool-decision.ts's ToolDecisionOutcome for the full incident this
  // fixes) — handled HERE, first, before the 'attempted_failed' fallback
  // below ever gets a chance to run. Deliberately does NOT fall through to
  // attempt the agent loop for this same request: the loop would very
  // likely re-plan and hit the identical gated call again, creating a
  // SECOND, redundant pending approval for what the user experiences as
  // one request. Same message-building as the loop's own awaiting_approval
  // pause further below — chat has no turn-state to resume into either
  // way, so both cases are completed identically (tell the user plainly,
  // approving it executes that one call directly via
  // /api/approvals/[id]/confirm, not "ask me again").
  if (toolResult.outcome === 'pending_approval' && toolResult.pendingApprovalId) {
    return await buildAwaitingApprovalResult(toolResult.pendingApprovalId, {
      input, routingIntent, detectedIntent, decisions, memoryResult, toolResult,
      agentId, conversationId, agentCount, reasoningSteps, conversationHistory,
    });
  }

  // M7-03: the upfront gate matched a tool category but couldn't produce a
  // full answer in one shot (outcome === 'attempted_failed') — before this
  // ticket, chat had no fallback for this case at all and just proceeded
  // straight to a plain one-shot LLM call below, silently discarding the
  // fact that a tool was actually relevant. Mission tasks already got a
  // bounded multi-step fallback in M7-01 (lib/swarm/agentLoop.ts); this
  // reuses the SAME mechanism here instead of chat having none. Requests
  // where no tool category matched at all (outcome === 'declined_no_match')
  // skip this entirely and fall through to the existing plain-LLM path
  // unchanged — preserving the near-zero-cost shortcut for ordinary
  // conversation, not paying reasoning-loop overhead on every message.
  //
  // Uses a simpler system prompt (registry role/description/capabilities)
  // than the primary chat response path's full persona pipeline
  // (buildSystemPrompt/buildTemoCoordinatorPrompt + identity directive in
  // crew-coordinator.ts) — a deliberate, honest simplification for what is
  // a fallback path, not the main chat experience. If the loop itself
  // fails (throws — e.g. max steps exceeded), this falls through to the
  // exact same plain-LLM path chat already had before this ticket, so a
  // failed loop attempt never makes chat worse than its pre-M7-03 behavior.
  if (toolResult.outcome === 'attempted_failed') {
    try {
      const loopAgentId = toolDecisionAgentId ?? agentId;
      const agentRecord = await getAgentById(loopAgentId);
      const loopSystemPrompt = agentRecord
        ? `You are ${agentRecord.displayName}, ${agentRecord.role}. ${agentRecord.description}\n\nCapabilities: ${agentRecord.capabilities.join(', ')}.`
        : `You are ${loopAgentId}, an AI agent assisting the user.`;

      const loopResult = await runAgentLoop(
        loopSystemPrompt,
        input,
        { agentId: loopAgentId, tenantId, isSimulation },
        { usageContext: { operation: 'chat_tool_loop', agentId: loopAgentId, tenantId } },
      );

      // M7-04: the loop paused on a gated tool call. Chat has no
      // turn-state to resume into (agentLoop.ts's AgentLoopContext
      // comment) — mission tasks get a real checkpoint-resume once
      // approved (lib/governance/approvals.ts), but a chat conversation
      // has already moved on by the time a human gets to the approval.
      // So this does NOT silently fall through to a plain LLM call (that
      // would fabricate an answer for an action that never actually ran,
      // defeating the entire point of gating it) — it tells the user
      // plainly what's pending, via the same shared helper the upfront
      // gate's 'pending_approval' outcome uses further above (both cases
      // are completed identically for chat).
      if (loopResult.status === 'awaiting_approval' && loopResult.pendingApprovalId) {
        return await buildAwaitingApprovalResult(loopResult.pendingApprovalId, {
          input, routingIntent, detectedIntent, decisions, memoryResult, toolResult,
          agentId, conversationId, agentCount, reasoningSteps, conversationHistory,
        });
      }

      const step4 = makeStep('RAG Retrieval', 'Skipped — agent loop produced an answer', 3, 'skipped');
      reasoningSteps.push(step4);
      const step5 = makeStep('Context Builder', 'Building context from agent loop result...', 4, 'completed');
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
        toolDecisionReason: `Tool category '${detectedIntent.toolCategoryHint}' matched but the one-shot planner couldn't fully resolve it; agent loop ran ${loopResult.stepsUsed} step(s).`,
        llmSkipReason: 'Agent loop produced a complete answer; no further LLM call needed.',
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
        toolAnswer: loopResult.output,
        shouldCallLLM: false,
      };
    } catch {
      // Loop failed (e.g. max steps exceeded) — fall through to the
      // existing plain-LLM path below, unchanged.
    }
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

// M7-04: shared by both places chat can hit a gated tool call — the
// upfront decideTools() gate's own 'pending_approval' outcome, and the
// agent-loop fallback's 'awaiting_approval' pause. Both are completed
// identically for chat: there's no turn-state to resume into either way
// (see agentLoop.ts's AgentLoopContext comment), so this just tells the
// user plainly what's pending, without ever fabricating an answer for an
// action that never actually ran.
async function buildAwaitingApprovalResult(
  pendingApprovalId: string,
  ctx: {
    input: string;
    routingIntent: Intent;
    detectedIntent: DetectedIntent;
    decisions: ContextDecisions;
    memoryResult: MemoryDecisionResult;
    toolResult: ToolDecisionResult;
    agentId: string;
    conversationId: string | null;
    agentCount: number;
    reasoningSteps: ReasoningStep[];
    conversationHistory: ChatMessage[];
  },
): Promise<ContextManagerResult> {
  const approval = await getApproval(pendingApprovalId);
  const risk = approval?.payload as { riskLevel?: string; blastRadius?: string } | undefined;
  const riskNote = risk?.riskLevel || risk?.blastRadius
    ? ` (${[risk.riskLevel, risk.blastRadius].filter(Boolean).join(', ')})`
    : '';
  const message = approval
    ? `This requires your confirmation before I can continue: ${approval.title}${riskNote}. ${approval.detail} Please review and approve or reject it, and I'll take care of the rest — no need to ask me again.`
    : 'This requires your confirmation before I can continue. Please review the pending approval and respond with your decision.';

  const step = makeStep('RAG Retrieval', 'Skipped — awaiting approval', 3, 'skipped');
  ctx.reasoningSteps.push(step);
  const context = buildContext({
    userInput: ctx.input,
    intent: ctx.routingIntent,
    detectedIntent: ctx.detectedIntent,
    decisions: ctx.decisions,
    memories: ctx.memoryResult.memories,
    memoryConfidence: ctx.memoryResult.confidence,
    memoryClassification: null,
    memoryDecisionReason: 'Memory did not fully answer; proceeding to tools.',
    toolDecisionReason: `Tool category '${ctx.detectedIntent.toolCategoryHint}' matched a gated tool — paused pending human approval.`,
    llmSkipReason: 'Action requires approval; no answer to give until it is resolved.',
    timelineEvents: ctx.memoryResult.timelineEvents,
    ragContext: ctx.memoryResult.ragContext,
    toolExecutions: ctx.toolResult.executions,
    knowledgeGraphRelations: [],
    activeAgent: ctx.agentId,
    conversationId: ctx.conversationId,
    agentCount: ctx.agentCount,
    reasoningSteps: ctx.reasoningSteps,
    source: 'tool',
    conversationHistory: ctx.conversationHistory,
  });
  return { context, decisions: ctx.decisions, directAnswer: null, toolAnswer: message, shouldCallLLM: false };
}
