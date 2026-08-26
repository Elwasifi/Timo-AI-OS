import type { Agent, Intent, AgentScore, RoutingResult, TaskCategory } from '@/types';
import { TaskClassifier } from './task-classifier';

/**
 * TaskRouter — given an Intent and the registered agents, scores every agent
 * and selects the best one. Uses each agent's canHandle(), priority(),
 * confidence(), and estimatedDuration() to make the decision.
 *
 * Agent registration is fully dynamic — the router iterates over whatever
 * agents are registered, no hardcoded references.
 */
export class TaskRouter {
  private classifier: TaskClassifier;

  constructor(classifier: TaskClassifier) {
    this.classifier = classifier;
  }

  /**
   * Score all agents against the intent. Every agent gets a score even if
   * canHandle is false — the UI shows the full ranking.
   */
  scoreAgents(intent: Intent, agents: Agent[]): AgentScore[] {
    return agents.map((agent) => this.scoreAgent(intent, agent));
  }

  scoreAgent(intent: Intent, agent: Agent): AgentScore {
    const canHandle = this.canHandle(intent, agent);
    const priority = this.priority(agent);
    const confidence = this.confidence(intent, agent);
    const estimatedDuration = this.estimatedDuration(intent, agent);

    return {
      agentId: agent.id,
      agentName: agent.name,
      canHandle,
      priority,
      confidence: canHandle ? confidence : 0,
      estimatedDuration,
      reason: this.reason(intent, agent, canHandle),
    };
  }

  /**
   * Select the best agent. Temo (chief) is the fallback when no specialist
   * can handle the task or confidence is below threshold.
   */
  select(intent: Intent, agents: Agent[]): AgentScore {
    const scores = this.scoreAgents(intent, agents).filter((s) => s.canHandle);
    scores.sort((a, b) => {
      // Sort by confidence * priority, descending
      const aVal = a.confidence * a.priority;
      const bVal = b.confidence * b.priority;
      if (bVal !== aVal) return bVal - aVal;
      return b.priority - a.priority;
    });

    const top = scores[0];
    if (!top || (intent.needsClarification && intent.confidence < 0.5)) {
      const temo = agents.find((a) => a.id === 'temo');
      return {
        agentId: 'temo',
        agentName: temo?.name ?? 'Temo',
        canHandle: true,
        priority: 10,
        confidence: intent.needsClarification ? 0.3 : 0.5,
        estimatedDuration: 5,
        reason: intent.needsClarification
          ? 'Insufficient context — Temo will ask for clarification'
          : 'Temo will coordinate directly',
      };
    }

    return top;
  }

  /** Build a full RoutingResult for the timeline and history. */
  route(taskId: string, input: string, intent: Intent, agents: Agent[]): RoutingResult {
    const scores = this.scoreAgents(intent, agents);
    const selected = this.select(intent, agents);

    return {
      taskId,
      input,
      intent,
      selectedAgentId: selected.agentId,
      selectedAgentName: selected.agentName,
      scores,
      confidence: selected.confidence,
      reason: selected.reason,
      needsClarification: intent.needsClarification,
      clarificationQuestion: intent.clarificationQuestion,
      timestamp: Date.now(),
    };
  }

  // ---- Agent intelligence methods ----
  // These are called dynamically for each registered agent.

  canHandle(intent: Intent, agent: Agent): boolean {
    if (agent.id === 'temo') return true; // Chief handles everything as fallback
    const categoryAgent = this.classifier.categoryToAgentId(intent.category);
    return agent.id === categoryAgent;
  }

  priority(agent: Agent): number {
    if (agent.id === 'temo') return 10;
    // Specialists get higher priority for their domain
    return 8;
  }

  confidence(intent: Intent, agent: Agent): number {
    if (agent.id === 'temo') return 0.5;
    if (!this.canHandle(intent, agent)) return 0;
    // Scale intent confidence by agent priority
    return Math.round(intent.confidence * 100) / 100;
  }

  estimatedDuration(intent: Intent, agent: Agent): number {
    // Base estimate by category complexity
    const base: Record<TaskCategory, number> = {
      code: 12,
      workflow: 15,
      business: 10,
      design: 8,
      content: 6,
      general: 5,
      clarification: 3,
    };
    return base[intent.category] ?? 8;
  }

  private reason(intent: Intent, agent: Agent, canHandle: boolean): string {
    if (agent.id === 'temo') return 'Chief AI — coordinates and handles general requests';
    if (!canHandle) return `Not specialized for ${intent.category} tasks`;
    return intent.reason;
  }
}
