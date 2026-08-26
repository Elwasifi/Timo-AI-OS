import type { Agent, Intent } from '@/types';

/**
 * AgentProfile — wraps an Agent with convenience accessors for the UI.
 * Provides typed getters for profile, capabilities, and workflow metadata.
 * Also exposes the crew intelligence methods: canHandle, priority,
 * confidence, estimatedDuration.
 */

export class AgentProfile {
  constructor(public readonly agent: Agent) {}

  get id() { return this.agent.id; }
  get name() { return this.agent.name; }
  get role() { return this.agent.role; }
  get color() { return this.agent.color; }
  get icon() { return this.agent.icon; }

  get bio(): string { return this.agent.personality.bio; }
  get greeting(): string { return this.agent.personality.greeting; }
  get tone(): string { return this.agent.personality.tone; }
  get traits(): string[] { return this.agent.personality.traits; }
  get skills(): string[] { return this.agent.skills; }
  get capabilities(): string[] { return this.agent.capabilities; }
  get model(): string { return this.agent.model; }
  get voiceConfig() { return this.agent.voice; }
  get workflowConfig() { return this.agent.workflow; }
  get memory() { return this.agent.memory; }
  get status() { return this.agent.status; }
  get isFavorite() { return this.agent.isFavorite; }
  get currentActivity() { return this.agent.currentActivity; }

  get isWorkflowReady(): boolean {
    return this.agent.workflow.enabled && this.agent.workflow.workflowStatus !== 'disabled';
  }

  get initials(): string { return this.agent.name.slice(0, 2).toUpperCase(); }

  // ---- Crew Intelligence ----

  /** Whether this agent can handle a given intent. */
  canHandle(intent: Intent): boolean {
    if (this.agent.id === 'temo') return true;
    const categoryMap: Record<string, string> = {
      code: 'nova', workflow: 'flow', business: 'atlas', design: 'luna', content: 'echo',
    };
    return categoryMap[intent.category] === this.agent.id;
  }

  /** Priority weight (higher = more likely to be selected). */
  priority(): number {
    return this.agent.id === 'temo' ? 10 : 8;
  }

  /** Confidence score for handling this intent (0-1). */
  confidence(intent: Intent): number {
    if (this.agent.id === 'temo') return 0.5;
    if (!this.canHandle(intent)) return 0;
    return intent.confidence;
  }

  /** Estimated handling time in seconds. */
  estimatedDuration(intent: Intent): number {
    const base: Record<string, number> = {
      code: 12, workflow: 15, business: 10, design: 8, content: 6, general: 5, clarification: 3,
    };
    return base[intent.category] ?? 8;
  }
}
