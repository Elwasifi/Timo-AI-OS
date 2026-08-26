import type { Agent, AgentStatus, AgentAnimationState } from '@/types';
import type { AgentRecord } from '@/lib/agents/types';
import { mergeRegistryIntoAgents } from '@/lib/agents/agentRegistryService';

/**
 * AgentRegistry — in-memory routing cache for crew member lookups by id,
 * name, and role. Consumed by CrewManager, AgentSelector, and the UI layer.
 *
 * As of Sprint 1, this class is no longer the source of truth for agent
 * identity/hierarchy — lib/agents/agentRegistryService.ts is canonical.
 * Use mergeFromRegistry() to hydrate already-registered agents with
 * up-to-date hierarchy metadata from the unified registry.
 */

export class AgentRegistry {
  private agents = new Map<string, Agent>();
  private nameIndex = new Map<string, string>();

  register(agent: Agent): void {
    this.agents.set(agent.id, agent);
    this.nameIndex.set(agent.name.toLowerCase(), agent.id);
  }

  registerAll(agents: Agent[]): void {
    agents.forEach((a) => this.register(a));
  }

  getById(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  getByName(name: string): Agent | undefined {
    const id = this.nameIndex.get(name.toLowerCase());
    return id ? this.agents.get(id) : undefined;
  }

  getByRole(role: string): Agent | undefined {
    for (const agent of Array.from(this.agents.values())) {
      if (agent.role.toLowerCase().includes(role.toLowerCase())) return agent;
    }
    return undefined;
  }

  getAll(): Agent[] {
    return Array.from(this.agents.values());
  }

  getAvailable(): Agent[] {
    return this.getAll().filter((a) => a.status === 'available');
  }

  getFavorites(): Agent[] {
    return this.getAll().filter((a) => a.isFavorite);
  }

  has(id: string): boolean {
    return this.agents.has(id);
  }

  update(id: string, patch: Partial<Agent>): void {
    const current = this.agents.get(id);
    if (current) {
      this.agents.set(id, { ...current, ...patch });
    }
  }

  /**
   * Enrich already-registered agents with hierarchy/identity metadata from
   * the unified registry (lib/agents/agentRegistryService). Does not create
   * new agents — only merges into ones already registered via register()/
   * registerAll(), so callers still control which runtime Agent objects
   * (with personality/voice/workflow data) exist.
   */
  mergeFromRegistry(records: AgentRecord[]): void {
    const merged = mergeRegistryIntoAgents(this.getAll(), records);
    merged.forEach((agent) => this.register(agent));
  }
}
