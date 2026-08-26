// Tool Chain — sequential execution of multiple tool requests with shared
// context. Each step's output is merged into the chain context and made
// available to subsequent steps.

import type { ToolRequest, ToolResultEnvelope, ToolExecutionContext } from './types';
import { toolExecutor } from './executor';
import { logger } from '@/lib/utils/logger';

export interface ChainStep {
  request: Omit<ToolRequest, 'id'>;
  /** Map previous step outputs into this step's arguments. */
  mapArgs?: (context: Record<string, unknown>, previousResult: ToolResultEnvelope | null) => Record<string, unknown>;
  /** Skip this step if the predicate returns false. */
  skipIf?: (context: Record<string, unknown>) => boolean;
}

export interface ChainResult {
  results: ToolResultEnvelope[];
  context: Record<string, unknown>;
  success: boolean;
  failedStep: number | null;
}

export class ToolChain {
  private steps: ChainStep[] = [];
  private context: Record<string, unknown> = {};

  constructor(context?: Record<string, unknown>) {
    if (context) this.context = { ...context };
  }

  add(step: ChainStep): this {
    this.steps.push(step);
    return this;
  }

  /** Execute all steps sequentially. Stops on first failure. */
  async run(): Promise<ChainResult> {
    const results: ToolResultEnvelope[] = [];
    let previous: ToolResultEnvelope | null = null;

    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i];

      if (step.skipIf?.(this.context)) {
        logger.n8nDebug(`Chain step ${i} skipped`);
        continue;
      }

      const args = step.mapArgs
        ? step.mapArgs(this.context, previous)
        : step.request.arguments;

      const request: ToolRequest = {
        ...step.request,
        id: `chain-${Date.now()}-${i}`,
        arguments: args,
      };

      const result = await toolExecutor.execute(request);
      results.push(result);

      if (!result.ok) {
        logger.error(`Chain failed at step ${i}: ${request.toolId}`, { error: result.error });
        return { results, context: this.context, success: false, failedStep: i };
      }

      // Store output in context under the tool id
      this.context[request.toolId] = result.data;
      this.context[`step_${i}`] = result.data;
      previous = result;
    }

    return { results, context: this.context, success: true, failedStep: null };
  }

  getContext(): Record<string, unknown> {
    return this.context;
  }
}

/** Helper to build a chain fluently. */
export function createChain(context?: Record<string, unknown>): ToolChain {
  return new ToolChain(context);
}
