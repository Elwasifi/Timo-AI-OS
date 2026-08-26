import type { Agent, AgentStatus } from '@/types';

/**
 * AgentState — tracks the live runtime state of a single agent.
 * Separated from the static Agent profile so animation/status changes
 * don't mutate the registry.
 */

export interface AgentRuntimeState {
  agentId: string;
  status: AgentStatus;
  animationState: 'idle' | 'speaking' | 'thinking' | 'listening' | 'offline';
  currentActivity: string;
  volume: number;
  lastActiveAt: number;
}

export class AgentState {
  private states = new Map<string, AgentRuntimeState>();

  init(agent: Agent): AgentRuntimeState {
    const state: AgentRuntimeState = {
      agentId: agent.id,
      status: agent.status,
      animationState: this.toAnimationState(agent.status),
      currentActivity: agent.currentActivity,
      volume: 0,
      lastActiveAt: Date.now(),
    };
    this.states.set(agent.id, state);
    return state;
  }

  get(agentId: string): AgentRuntimeState | undefined {
    return this.states.get(agentId);
  }

  setStatus(agentId: string, status: AgentStatus, activity?: string): void {
    const state = this.states.get(agentId);
    if (state) {
      state.status = status;
      state.animationState = this.toAnimationState(status);
      if (activity !== undefined) state.currentActivity = activity;
      state.lastActiveAt = Date.now();
    }
  }

  setVolume(agentId: string, volume: number): void {
    const state = this.states.get(agentId);
    if (state) state.volume = volume;
  }

  private toAnimationState(status: AgentStatus): AgentRuntimeState['animationState'] {
    switch (status) {
      case 'available': return 'idle';
      case 'busy': return 'thinking';
      case 'thinking': return 'thinking';
      case 'speaking': return 'speaking';
      case 'offline': return 'offline';
      default: return 'idle';
    }
  }
}
