// Execution service — webhook-based execution engine.
// Uses triggerWorkflow() which detects the trigger type and routes to the
// appropriate webhook URL. The unsupported REST API execution is removed.

import { proxy } from './n8nClient';
import type { N8nExecution, N8nExecutionList, TriggerResult } from './types';

export const executionService = {
  async trigger(workflowId: string, input?: Record<string, unknown>): Promise<TriggerResult> {
    return proxy<TriggerResult>({ action: 'trigger-workflow', workflowId, input });
  },

  async triggerByName(workflowName: string, input?: Record<string, unknown>): Promise<TriggerResult> {
    return proxy<TriggerResult>({ action: 'trigger-workflow-by-name', workflowName, input });
  },

  async getExecution(executionId: string): Promise<N8nExecution> {
    return proxy<N8nExecution>({ action: 'get-execution', executionId });
  },

  async listExecutions(limit = 20, cursor?: string): Promise<N8nExecutionList> {
    return proxy<N8nExecutionList>({ action: 'list-executions', limit, cursor });
  },

  async triggerWebhook(
    webhookPath: string,
    input?: Record<string, unknown>,
    httpMethod = 'POST',
  ): Promise<unknown> {
    return proxy<unknown>({ action: 'trigger-webhook', webhookPath, input, httpMethod });
  },
};
