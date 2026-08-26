import type { Agent } from '@/types';
import { AgentRegistry } from './agent-registry';
import { AgentState } from './agent-state';
import { AgentSelector } from './agent-selector';
import { AgentMemory } from './agent-memory';

/**
 * CrewManager — the top-level orchestrator for the AI Crew.
 *
 * Wires together AgentRegistry (static profiles), AgentState (runtime status),
 * AgentSelector (routing), and AgentMemory (conversation history).
 *
 * Temo is the Chief AI that coordinates; the other five are specialists.
 * This is architecture-only — no n8n connections are made.
 */
export class CrewManager {
  readonly registry = new AgentRegistry();
  readonly state = new AgentState();
  readonly selector = new AgentSelector();
  readonly memory = new AgentMemory();
  private initialized = false;

  init(agents: Agent[]): void {
    if (this.initialized) return;
    this.registry.registerAll(agents);
    agents.forEach((a) => {
      this.state.init(a);
      this.memory.init(a.id);
    });
    this.initialized = true;
  }

  getAgent(id: string): Agent | undefined {
    return this.registry.getById(id);
  }

  getAgentByName(name: string): Agent | undefined {
    return this.registry.getByName(name);
  }

  getAllAgents(): Agent[] {
    return this.registry.getAll();
  }

  getAvailableAgents(): Agent[] {
    return this.registry.getAvailable();
  }

  getFavorites(): Agent[] {
    return this.registry.getFavorites();
  }

  /** Temo coordinates: routes user input to the best specialist. */
  route(input: string): { specialistId: string; specialistName: string; reason: string } {
    return this.selector.route(input, this.registry.getAll());
  }

  setAgentStatus(agentId: string, status: Agent['status'], activity?: string): void {
    this.state.setStatus(agentId, status, activity);
    this.registry.update(agentId, { status, currentActivity: activity ?? this.registry.getById(agentId)?.currentActivity });
  }

  toggleFavorite(agentId: string): void {
    const agent = this.registry.getById(agentId);
    if (agent) {
      this.registry.update(agentId, { isFavorite: !agent.isFavorite });
    }
  }

  recordConversation(agentId: string, topic: string): void {
    this.memory.recordInteraction(agentId, topic);
  }

  getMemorySummary(agentId: string): string {
    return this.memory.getSummary(agentId);
  }

  get chief(): Agent | undefined {
    return this.registry.getById('temo');
  }

  get specialists(): Agent[] {
    return this.registry.getAll().filter((a) => a.id !== 'temo');
  }

  get count(): number {
    return this.registry.getAll().length;
  }

  get availableCount(): number {
    return this.getAvailableAgents().length;
  }
}

export const crewManager = new CrewManager();
