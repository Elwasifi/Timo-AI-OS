import type { Agent, RoutingResult, TaskRecord, TimelineEvent, ActivityFeedItem } from '@/types';
import { RoutingEngine } from './routing-engine';
import { AIIntentAnalyzer } from './ai-intent-analyzer';
import { AgentRegistry } from './agent-registry';
import { loadAgents } from '@/lib/agents/agentRegistryService';
import { useAuthStore } from '@/stores/authStore';
import { getClientProfile, buildIdentityDirective } from '@/lib/governance/clientProfile';
import { AgentState } from './agent-state';
import { AgentMemory } from './agent-memory';
import { getAgentGreeting } from './agent-responses';
import { buildSystemPrompt, buildTemoCoordinatorPrompt } from './agent-system-prompts';
import { chatWithFallback, streamWithFallback, type ChatMessage } from '@/lib/ai/ai-provider';
import { route, classifyTask } from '@/lib/ai/router';
import { loadSettings } from '@/lib/settings/settings-service';
import { ConversationService } from '@/lib/ai/conversation-service';
import { logger } from '@/lib/utils/logger';
import { useOrchestrationStore } from '@/stores/orchestrationStore';
import { executeN8nAction, isN8nRequest } from './n8n-action-handler';
import { delegateManagerTask, selectWorkerForManager } from './manager-delegation';
import { agentToolBridge } from '@/lib/tools/agent-bridge';
import { toolRegistry } from '@/lib/tools/registry';
import { permissionEngine } from '@/lib/tools/permissions';
import { toolPlanner } from '@/lib/tools/planner';
import { memory } from '@/lib/memory/memoryService';
import { loadMemorySettings } from '@/lib/memory/memorySettings';
import { runContextManager } from '@/lib/context/context-manager';
import { useContextManagerStore } from '@/stores/contextManagerStore';

/**
 * CrewCoordinator — the top-level orchestrator that Temo uses.
 *
 * Real AI implementation: uses the AI provider layer (Gemini/OpenAI/Anthropic)
 * to generate responses, the AIIntentAnalyzer for intent classification, and
 * the conversation service for history. Temo analyzes intent, routes to the
 * best specialist, announces the routing, and coordinates the response.
 *
 * The public interface (routeAndRespond, callbacks, init) is unchanged from
 * the mock version so the UI and voice manager work without modification.
 */

export interface RouteCallbacks {
  onTimeline?: (taskId: string, label: string, detail: string, status?: TimelineEvent['status']) => void;
  onActivity?: (item: Omit<ActivityFeedItem, 'id' | 'timestamp'>) => void;
  onAgentStatus?: (agentId: string, status: Agent['status'], activity?: string) => void;
  onRoutingAnnouncement?: (text: string, fromAgentId: string, toAgentId: string) => void;
  onTaskComplete?: (task: TaskRecord) => void;
  onStreamDelta?: (agentId: string, delta: string, full: string) => void;
  onWorkerActive?: (workerId: string | null) => void;
}

export class CrewCoordinator {
  readonly engine: RoutingEngine;
  readonly registry = new AgentRegistry();
  readonly state = new AgentState();
  readonly memory = new AgentMemory();
  private initialized = false;
  private callbacks: RouteCallbacks = {};
  private currentConversationId: string | null = null;

  constructor() {
    this.engine = new RoutingEngine(new AIIntentAnalyzer());
  }

  setCallbacks(cb: RouteCallbacks): void {
    this.callbacks = cb;
  }

  init(agents: Agent[]): void {
    if (this.initialized) return;
    this.registry.registerAll(agents);
    agents.forEach((a) => {
      this.state.init(a);
      this.memory.init(a.id);
    });
    this.initialized = true;

    // Sync hierarchy metadata from the unified registry (lib/agents/
    // agentRegistryService) so routing reflects the canonical source of
    // truth. Fire-and-forget: loadAgents() already falls back to static
    // seed data internally on any DB failure, and this merge only enriches
    // agents already registered above — it never blocks or replaces init.
    loadAgents()
      .then((records) => this.registry.mergeFromRegistry(records))
      .catch((err) => {
        logger.routing(`Unified registry sync failed, keeping initial agent data: ${err}`);
      });
  }

  /** Register a new agent dynamically. */
  registerAgent(agent: Agent): void {
    this.registry.register(agent);
    this.state.init(agent);
    this.memory.init(agent.id);
  }

  /** Start a new conversation session and return its id. */
  async startConversation(title: string = 'New Conversation', agentId: string = 'temo'): Promise<string> {
    try {
      const tenantId = useAuthStore.getState().currentTenantId ?? '00000000-0000-0000-0000-000000000001';
      const conv = await ConversationService.createConversation(title, agentId, tenantId);
      this.currentConversationId = conv.id;
      return conv.id;
    } catch (err) {
      console.error('[coordinator] conversation start failed:', err);
      this.currentConversationId = null;
      return '';
    }
  }

  setConversationId(id: string | null): void {
    this.currentConversationId = id;
  }

  getConversationId(): string | null {
    return this.currentConversationId;
  }

  /**
   * Full routing pipeline: classify → route → announce → respond.
   * Returns the routing result and the agent's response text.
   * Uses real AI (via the edge function proxy) for response generation.
   */
  async routeAndRespond(
    input: string,
    options?: { announce?: boolean; stream?: boolean; isSimulation?: boolean; isVoice?: boolean }
  ): Promise<{ routing: RoutingResult; response: string; task: TaskRecord }> {
    logger.routing(`Routing input: "${input.slice(0, 60)}"`);
    const agents = this.registry.getAll();
    const { routing, execution, task } = await this.engine.route(input, agents);
    logger.routing(`Routed to ${routing.selectedAgentName} (${Math.round(routing.confidence * 100)}%)`);

    const announce = options?.announce ?? true;
    const useStream = options?.stream ?? false;

    // Timeline: task received
    this.emitTimeline(task.id, 'Task received', input, 'completed');
    this.emitTimeline(task.id, 'Intent analyzed', `${routing.intent.category} (${Math.round(routing.confidence * 100)}% confidence)`, 'completed');
    this.emitTimeline(task.id, 'Agent selected', `${routing.selectedAgentName} (${Math.round(routing.confidence * 100)}%)`, 'completed');

    // Activity feed
    this.emitActivity({
      type: 'routing',
      title: `Routed to ${routing.selectedAgentName}`,
      detail: routing.reason,
      agentId: routing.selectedAgentId,
      agentColor: this.registry.getById(routing.selectedAgentId)?.color,
    });

    // Persist the user message
    this.persistMessage('user', input).catch((e) => console.error('[coordinator] persist user msg:', e));

    // If clarification needed, Temo asks
    if (routing.needsClarification && routing.clarificationQuestion) {
      this.emitTimeline(task.id, 'Clarification needed', routing.clarificationQuestion, 'active');
      const response = routing.clarificationQuestion;
      this.persistMessage('assistant', response, routing.selectedAgentId, routing.confidence).catch((e) => console.error('[coordinator] persist clarification:', e));
      const completedTask = this.engine.results.complete(task, response);
      this.callbacks.onTaskComplete?.(completedTask);
      return { routing, response, task: completedTask };
    }

    // Announce routing (Temo speaks)
    if (announce && routing.selectedAgentId !== 'temo') {
      const announcement = this.buildAnnouncement(routing);
      this.emitTimeline(task.id, 'Routing announced', announcement, 'completed');
      this.callbacks.onRoutingAnnouncement?.(announcement, 'temo', routing.selectedAgentId);
    }

    // Agent thinking
    this.emitTimeline(task.id, `${routing.selectedAgentName} is thinking`, 'Processing request...', 'active');
    this.callbacks.onAgentStatus?.(routing.selectedAgentId, 'thinking', 'Processing request');

    // ---- Context Manager: the mandatory layer before any LLM call ----
    // Runs the full pipeline: Intent → Memory → Tools → RAG → Context Builder
    // The LLM NEVER receives only the user message — it receives enriched context.
    this.emitTimeline(task.id, 'Context Manager', 'Running reasoning pipeline...', 'active');
    useContextManagerStore.getState().setRunning(true);

    // M5-11: work out whether this request would delegate to a worker
    // BEFORE the tool-decision gate runs, so a worker's own
    // AGENT_PERMISSIONS scope (M5-10) is what actually gets checked for
    // delegated work — this previously always checked the manager's
    // broader permissions instead, even for work a worker would end up
    // doing (Deep Integrity Audit, Section B). Real delegation below
    // (delegateManagerTask) does its own worker selection independently;
    // this is a cheap, side-effect-free pre-check purely to know which
    // agent's permissions apply, not a second delegation.
    const routedAgent = this.registry.getById(routing.selectedAgentId);
    let toolDecisionAgentId = routing.selectedAgentId;
    if (routedAgent?.level === 'manager') {
      const candidateWorker = await selectWorkerForManager(routedAgent.id, input);
      if (candidateWorker) toolDecisionAgentId = candidateWorker.id;
    }

    let ctxResult;
    try {
      ctxResult = await runContextManager(
        input,
        routing.intent,
        routing.selectedAgentId,
        this.currentConversationId,
        this.registry.getAll().length,
        useAuthStore.getState().currentTenantId,
        options?.isSimulation ?? false,
        toolDecisionAgentId,
      );
    } catch (e) {
      console.warn('[coordinator] Context Manager failed:', e instanceof Error ? e.message : e);
      ctxResult = null;
    }

    if (ctxResult) {
      useContextManagerStore.getState().setResult(ctxResult);

      // Emit reasoning steps as timeline events
      for (const step of ctxResult.context.metadata.reasoningTimeline) {
        this.emitTimeline(task.id, step.label, step.detail, step.status === 'skipped' ? 'completed' : step.status);
      }

      // If Memory fully answered the question, return directly — no LLM needed
      if (ctxResult.directAnswer) {
        const response = ctxResult.directAnswer;
        this.emitTimeline(task.id, 'Memory answered', 'Retrieved from memory — no LLM call needed', 'completed');
        this.callbacks.onAgentStatus?.(routing.selectedAgentId, 'speaking', 'Responding');
        this.persistMessage('assistant', response, routing.selectedAgentId, routing.confidence).catch((e) => console.error('[coordinator] persist memory answer:', e));
        const completedTask = this.engine.results.complete(task, response);
        this.emitTimeline(task.id, 'Completed', `Duration: ${completedTask.duration}ms`, 'completed');
        this.callbacks.onAgentStatus?.(routing.selectedAgentId, 'available', this.registry.getById(routing.selectedAgentId)?.currentActivity ?? 'Idle');
        this.callbacks.onTaskComplete?.(completedTask);
        this.memory.recordInteraction(routing.selectedAgentId, input.slice(0, 30));
        void execution;
        void useOrchestrationStore;
        return { routing, response, task: completedTask };
      }

      // If a Tool fully answered the question, return the tool result — no LLM needed
      if (ctxResult.toolAnswer) {
        const response = ctxResult.toolAnswer;
        this.emitTimeline(task.id, 'Tool answered', 'Retrieved from tool execution — no LLM call needed', 'completed');
        this.callbacks.onAgentStatus?.(routing.selectedAgentId, 'speaking', 'Responding');
        this.persistMessage('assistant', response, routing.selectedAgentId, routing.confidence).catch((e) => console.error('[coordinator] persist tool answer:', e));
        const completedTask = this.engine.results.complete(task, response);
        this.emitTimeline(task.id, 'Completed', `Duration: ${completedTask.duration}ms`, 'completed');
        this.callbacks.onAgentStatus?.(routing.selectedAgentId, 'available', this.registry.getById(routing.selectedAgentId)?.currentActivity ?? 'Idle');
        this.callbacks.onTaskComplete?.(completedTask);
        this.memory.recordInteraction(routing.selectedAgentId, input.slice(0, 30));
        void execution;
        void useOrchestrationStore;
        return { routing, response, task: completedTask };
      }
    }

    // The Context Manager determined the LLM is needed — proceed with enriched context
    const enrichedPrompt = ctxResult?.context.unifiedPrompt ?? '';
    const conversationHistory = ctxResult?.context.conversationHistory ?? [];
    const selectedAgent = this.registry.getById(routing.selectedAgentId);

    // ---- Manager → Worker Delegation (generalized, Sprint 2) ----
    // Any selected agent at the 'manager' hierarchy level (registry-driven,
    // not a hardcoded id) gets a chance to delegate to one of its registered
    // active workers. If the manager has no workers, or none match the
    // request, delegateManagerTask returns delegated: false — never a fake
    // result — and execution falls through to the normal LLM response path.
    let response = '';
    let delegated = false;

    if (selectedAgent?.level === 'manager' && !ctxResult?.directAnswer && !ctxResult?.toolAnswer) {
      const managerName = selectedAgent.name ?? selectedAgent.id;
      this.emitTimeline(task.id, 'Delegation check', `${managerName} evaluating worker delegation...`, 'active');

      const delegationResult = await delegateManagerTask(selectedAgent.id, input, enrichedPrompt, task.id, {
        onTimeline: (tid, label, detail, status) => this.emitTimeline(tid, label, detail, status),
        onActivity: (item) => this.emitActivity(item),
        onAgentStatus: (agentId, status, activity) => this.callbacks.onAgentStatus?.(agentId, status, activity),
        onWorkerActive: (workerId) => this.callbacks.onWorkerActive?.(workerId),
      });

      if (delegationResult.delegated && delegationResult.response) {
        response = delegationResult.response;
        delegated = true;
        this.emitTimeline(
          task.id,
          'Delegation complete',
          `${managerName} reviewed result from ${delegationResult.workerId}`,
          'completed',
        );
      } else {
        this.emitTimeline(task.id, 'Delegation skipped', `No worker matched — ${managerName} handling directly`, 'completed');
      }
    }

    try {
      if (!delegated) {
      if (selectedAgent?.id === 'flow' && isN8nRequest(input) && !ctxResult?.toolAnswer) {
        this.emitTimeline(task.id, 'tool planning', 'Selecting n8n tool...', 'active');

        // Use the tool planner to let AI pick the right n8n tool
        const permissions = permissionEngine.getPermissions('flow');
        const plan = await toolPlanner.plan(input, 'flow', permissions);

        if (plan && plan.tools.length > 0) {
          this.emitTimeline(task.id, 'tool execution', `Executing ${plan.tools.length} tool(s)...`, 'active');
          const result = await toolPlanner.executePlan(plan, 'flow');

          // Feed the real tool output back to the agent's LLM so it can
          // format the actual payload into a natural response. The planner's
          // explanation is only metadata about which tool was picked — it is
          // never the user-facing answer.
          if ('ok' in result) {
            if (result.ok) {
              response = await this.generateToolResponse(selectedAgent, input, result.data);
            } else {
              response = `Tool execution failed: ${result.error}`;
            }
          } else {
            // Chain result — pass the final step's data to the LLM
            const lastData = result.results.length > 0
              ? result.results[result.results.length - 1].data
              : undefined;
            if (result.success) {
              response = await this.generateToolResponse(selectedAgent, input, lastData);
            } else {
              response = `Tool chain failed at step ${result.failedStep}`;
            }
          }

          if ('ok' in result && !result.ok) {
            this.emitTimeline(task.id, 'tool failed', result.error ?? 'Unknown error', 'error');
          } else if ('success' in result && !result.success) {
            this.emitTimeline(task.id, 'tool chain failed', `Failed at step ${result.failedStep}`, 'error');
          } else {
            this.emitTimeline(task.id, 'tool complete', response.slice(0, 60), 'completed');
          }
        } else {
          // Fallback to direct n8n action handler if planner fails
          this.emitTimeline(task.id, 'n8n action', 'Executing n8n workflow action...', 'active');
          const result = await executeN8nAction(input);
          response = result.summary;
          if (!result.success) {
            this.emitTimeline(task.id, 'n8n action failed', result.summary, 'error');
          } else {
            this.emitTimeline(task.id, 'n8n action complete', result.summary.slice(0, 60), 'completed');
          }
        }
      } else if (useStream && this.callbacks.onStreamDelta) {
        response = await this.generateStreamResponse(selectedAgent, input, routing.selectedAgentId, enrichedPrompt, conversationHistory, options?.isVoice ?? false);
      } else {
        response = await this.generateResponse(selectedAgent, input, enrichedPrompt, conversationHistory, options?.isVoice ?? false);
      }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI request failed';
      logger.error(`AI generation failed: ${message}`);
      response = `I encountered an issue: ${message}`;
      this.emitTimeline(task.id, 'Error', message, 'error');
    }

    this.emitTimeline(task.id, 'Response generated', `${response.slice(0, 60)}...`, 'completed');
    this.callbacks.onAgentStatus?.(routing.selectedAgentId, 'speaking', 'Responding');

    // Persist the assistant message
    this.persistMessage('assistant', response, routing.selectedAgentId, routing.confidence).catch((e) => console.error('[coordinator] persist assistant msg:', e));

    // Complete
    const completedTask = this.engine.results.complete(task, response);
    this.emitTimeline(task.id, 'Completed', `Duration: ${completedTask.duration}ms`, 'completed');
    this.callbacks.onAgentStatus?.(routing.selectedAgentId, 'available', this.registry.getById(routing.selectedAgentId)?.currentActivity ?? 'Idle');
    this.callbacks.onTaskComplete?.(completedTask);

    this.memory.recordInteraction(routing.selectedAgentId, input.slice(0, 30));

    // Auto-remember: store important interactions as memories after completion.
    // Skip when the Context Manager already stored a memory (directAnswer from
    // memory) or when the input was a memory query — those are already stored
    // by the memory decision layer, and auto-remembering them would create
    // duplicate/polluted memories.
    const wasMemoryAnswered = !!ctxResult?.directAnswer;
    const wasToolAnswered = !!ctxResult?.toolAnswer;
    if (!wasMemoryAnswered && !wasToolAnswered) {
      try {
        const memSettings = await loadMemorySettings();
        if (memSettings.auto_remember) {
          await memory.autoRemember({
            title: `User request: ${input.slice(0, 80)}`,
            content: `User asked: ${input}\n\nAgent ${routing.selectedAgentName} responded: ${response.slice(0, 500)}`,
            agent: routing.selectedAgentId,
            source: 'conversation',
            tags: ['auto', routing.selectedAgentId],
            tenantId: useAuthStore.getState().currentTenantId,
          });
        }
      } catch (e) {
        console.warn('[coordinator] Auto-remember failed:', e instanceof Error ? e.message : e);
      }
    }

    void execution;
    void useOrchestrationStore;
    return { routing, response, task: completedTask };
  }

  /**
   * Generate a response from the selected agent using the active AI provider.
   */
  /** V1 (Sections 15–16): append the tenant's assistant-name/language customization, if any. */
  private async withIdentity(systemPrompt: string): Promise<string> {
    const tenantId = useAuthStore.getState().currentTenantId;
    const profile = await getClientProfile(tenantId);
    return systemPrompt + buildIdentityDirective(profile);
  }

  private async generateResponse(
    agent: Agent | undefined,
    currentInput: string,
    ragContext: string = '',
    conversationHistory: ChatMessage[] = [],
    isVoice: boolean = false,
  ): Promise<string> {
    if (!agent) throw new Error('No agent selected');

    const settings = await loadSettings();

    const systemPrompt = agent.id === 'temo'
      ? buildTemoCoordinatorPrompt(this.registry.getAll())
      : buildSystemPrompt(agent);

    const fullSystemPrompt = await this.withIdentity(
      ragContext ? `${systemPrompt}\n\n${ragContext}` : systemPrompt,
    );

    const messages: ChatMessage[] = [
      ...conversationHistory.slice(-10),
      { role: 'user', content: currentInput },
    ];

    const tenantId = useAuthStore.getState().currentTenantId;
    const classification = classifyTask({ text: currentInput, isVoice });
    const decision = await route({ classification, tenantId });

    const result = await chatWithFallback(messages, {
      systemPrompt: fullSystemPrompt,
      temperature: settings.temperature,
      maxTokens: settings.max_tokens,
      candidates: decision.candidates,
      usageContext: { operation: 'chat', agentId: agent.id, tenantId, metadata: { taskType: decision.taskType, routingMode: decision.mode } },
    });

    return result.content;
  }

  /**
   * After a tool executes successfully, feed the real payload back to the
   * agent's LLM so it can format the actual data into a natural response.
   * This is the bridge that was previously missing — the tool result's
   * `data` field was discarded and only the planner's metadata was shown.
   */
  private async generateToolResponse(
    agent: Agent | undefined,
    userRequest: string,
    toolData: unknown
  ): Promise<string> {
    if (!agent) throw new Error('No agent selected');

    const settings = await loadSettings();

    const systemPrompt = agent.id === 'temo'
      ? buildTemoCoordinatorPrompt(this.registry.getAll())
      : buildSystemPrompt(agent);

    const payload = typeof toolData === 'string'
      ? toolData
      : JSON.stringify(toolData, null, 2);

    const toolContext = `The user asked: "${userRequest}"

A tool was executed and returned the following result. Format this data into a clear, helpful response for the user. Present the actual information (names, IDs, statuses, counts, etc.) — do not describe the tool itself.

Tool result:
${payload}`;

    const messages: ChatMessage[] = [{ role: 'user', content: toolContext }];

    const tenantId = useAuthStore.getState().currentTenantId;
    // Formatting a tool's real payload into a response is a
    // structured/reliable-output task, not an open-ended chat turn —
    // classify it as such rather than reusing the general chat profile.
    const classification = classifyTask({ text: toolContext, needsStructuredOutput: true, needsTools: true });
    const decision = await route({ classification, tenantId });

    const result = await chatWithFallback(messages, {
      systemPrompt: await this.withIdentity(systemPrompt),
      temperature: settings.temperature,
      maxTokens: settings.max_tokens,
      candidates: decision.candidates,
      usageContext: { operation: 'tool_response', agentId: agent.id, tenantId, metadata: { taskType: decision.taskType, routingMode: decision.mode } },
    });

    return result.content;
  }

  private async generateStreamResponse(
    agent: Agent | undefined,
    currentInput: string,
    agentId: string,
    ragContext: string = '',
    conversationHistory: ChatMessage[] = [],
    isVoice: boolean = false,
  ): Promise<string> {
    if (!agent) throw new Error('No agent selected');

    const settings = await loadSettings();

    const systemPrompt = agent.id === 'temo'
      ? buildTemoCoordinatorPrompt(this.registry.getAll())
      : buildSystemPrompt(agent);

    const fullSystemPrompt = await this.withIdentity(
      ragContext ? `${systemPrompt}\n\n${ragContext}` : systemPrompt,
    );

    const messages: ChatMessage[] = [
      ...conversationHistory.slice(-10),
      { role: 'user', content: currentInput },
    ];

    const classification = classifyTask({ text: currentInput, isVoice });
    const decision = await route({ classification, tenantId: useAuthStore.getState().currentTenantId });

    return streamWithFallback(messages, {
      systemPrompt: fullSystemPrompt,
      temperature: settings.temperature,
      maxTokens: settings.max_tokens,
      candidates: decision.candidates,
      usageContext: { operation: 'chat', agentId, tenantId: useAuthStore.getState().currentTenantId, metadata: { taskType: decision.taskType, routingMode: decision.mode } },
      onDelta: (delta, full) => {
        this.callbacks.onStreamDelta?.(agentId, delta, full);
      },
    });
  }

  private async persistMessage(
    role: 'user' | 'assistant' | 'system',
    content: string,
    agentId: string | null = null,
    confidence: number | null = null
  ): Promise<void> {
    if (!this.currentConversationId) return;
    await ConversationService.addMessage(this.currentConversationId, role, content, agentId, confidence);
  }

  private buildAnnouncement(routing: RoutingResult): string {
    const agentName = routing.selectedAgentName;
    const templates: Record<string, string[]> = {
      nova: [`I'll let Nova handle this — she's our engineering expert.`, `Nova can take this one. She's great with code.`, `I'm asking Nova to handle this. She'll have a clean solution.`],
      flow: [`I'll let Flow handle this automation.`, `This is Flow's domain. Let me route it to him.`, `Flow will take this — he's our automation architect.`],
      atlas: [`Atlas should weigh in on this. Let me bring him in.`, `This looks like a business question. Atlas is joining us.`, `I'll route this to Atlas — he's our strategist.`],
      luna: [`This looks like a design task. Luna is joining us.`, `Luna will make this beautiful. Let me hand it to her.`, `I'm asking Luna to handle this design request.`],
      echo: [`Echo can craft this content. Let me bring him in.`, `I'll let Echo handle this — he's our content specialist.`, `Echo will take this one. He knows how to make content connect.`],
    };
    const pool = templates[routing.selectedAgentId] ?? [`I'll let ${agentName} handle this.`];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  getAgent(id: string): Agent | undefined { return this.registry.getById(id); }
  getAllAgents(): Agent[] { return this.registry.getAll(); }
  getAvailableAgents(): Agent[] { return this.registry.getAvailable(); }
  get chief(): Agent | undefined { return this.registry.getById('temo'); }
  get specialists(): Agent[] { return this.registry.getAll().filter((a) => a.id !== 'temo'); }

  setAgentStatus(agentId: string, status: Agent['status'], activity?: string): void {
    this.state.setStatus(agentId, status, activity);
    this.registry.update(agentId, { status, currentActivity: activity ?? this.registry.getById(agentId)?.currentActivity });
  }

  toggleFavorite(agentId: string): void {
    const agent = this.registry.getById(agentId);
    if (agent) this.registry.update(agentId, { isFavorite: !agent.isFavorite });
  }

  getGreeting(agentId: string): string { return getAgentGreeting(agentId); }

  private emitTimeline(taskId: string, label: string, detail: string, status: TimelineEvent['status'] = 'completed'): void {
    this.callbacks.onTimeline?.(taskId, label, detail, status);
  }

  private emitActivity(item: Omit<ActivityFeedItem, 'id' | 'timestamp'>): void {
    this.callbacks.onActivity?.(item);
  }
}

export const crewCoordinator = new CrewCoordinator();
