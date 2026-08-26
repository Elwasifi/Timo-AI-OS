import type { Agent, Intent, AgentScore, TaskCategory } from '@/types';
import type { IntentAnalyzer } from './intent-analyzer';

/**
 * TaskClassifier — takes raw user input and produces an Intent.
 * Delegates to the pluggable IntentAnalyzer interface.
 */
export class TaskClassifier {
  constructor(private analyzer: IntentAnalyzer) {}

  async classify(input: string): Promise<Intent> {
    return this.analyzer.analyze(input);
  }

  /** Map an intent category to the agent id that should handle it. */
  categoryToAgentId(category: TaskCategory): string {
    switch (category) {
      case 'code': return 'nova';
      case 'workflow': return 'flow';
      case 'business': return 'atlas';
      case 'design': return 'luna';
      case 'content': return 'echo';
      default: return 'temo';
    }
  }
}
