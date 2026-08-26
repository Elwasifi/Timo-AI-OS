import type { Agent, RoutingResult, Intent, AgentScore, TaskExecution } from '@/types';
import { IntentAnalyzer } from './intent-analyzer';
import { TaskClassifier } from './task-classifier';
import { TaskRouter } from './task-router';
import { TaskDispatcher } from './task-dispatcher';
import { TaskResult } from './task-result';

/**
 * RoutingEngine — the core orchestration engine.
 *
 * Wires together the pluggable IntentAnalyzer, TaskClassifier, TaskRouter,
 * TaskDispatcher, and TaskResult into a single pipeline:
 *
 *   input → classify → score agents → select best → dispatch → create task record
 *
 * The IntentAnalyzer is swappable — pass any implementation that satisfies
 * the interface (mock, Gemini, OpenAI, Claude) and the routing architecture
 * stays identical.
 */
export class RoutingEngine {
  private classifier: TaskClassifier;
  private router: TaskRouter;

  readonly dispatcher = new TaskDispatcher();
  readonly results = new TaskResult();

  constructor(analyzer: IntentAnalyzer) {
    this.classifier = new TaskClassifier(analyzer);
    this.router = new TaskRouter(this.classifier);
  }

  /**
   * Run the full routing pipeline for a user input.
   * Returns the routing result, the selected agent's execution object,
   * and the initial task record.
   */
  async route(input: string, agents: Agent[]): Promise<{
    routing: RoutingResult;
    execution: TaskExecution;
    task: import('@/types').TaskRecord;
  }> {
    const taskId = `task-${Date.now()}`;
    const intent = await this.classifier.classify(input);
    const routing = this.router.route(taskId, input, intent, agents);

    const selectedAgent = agents.find((a) => a.id === routing.selectedAgentId);
    const execution = this.dispatcher.dispatch(routing, selectedAgent?.workflow ?? {
      workflowId: 'wf-none',
      workflowEndpoint: '/api/workflows/none',
    });
    const task = this.results.create(routing, execution, selectedAgent?.color ?? '#00E5FF');

    return { routing, execution, task };
  }

  /** Swap the intent analyzer at runtime (e.g., switch from mock to LLM). */
  setAnalyzer(analyzer: IntentAnalyzer): void {
    this.classifier = new TaskClassifier(analyzer);
    this.router = new TaskRouter(this.classifier);
  }
}
