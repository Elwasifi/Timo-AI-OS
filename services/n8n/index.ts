// Single import surface for the n8n integration layer.
// Every Agent and feature in Temo imports from here — never from the
// individual service files. This keeps the gateway contract stable as
// internal modules evolve.
//
// Usage:
//   import { n8n, testConnection } from '@/services/n8n';
//
//   const workflows = await n8n.workflows.list();
//   const result = await n8n.executions.trigger('workflow-id', { input: 'data' });

export { workflowService } from './workflowService';
export { executionService } from './executionService';
export { credentialService } from './credentialService';
export { webhookService } from './webhookService';
export { N8nProxyError } from './n8nClient';
export type {
  N8nConfig, N8nWorkflow, N8nNode, N8nExecution, N8nExecutionList,
  N8nWebhook, N8nCredential, ConnectionTestResult, ProxyAction, ProxyRequest,
  TriggerResult, ConvertResult, WorkflowRegistryEntry, TriggerType,
} from './types';

import { proxy } from './n8nClient';
import { workflowService } from './workflowService';
import { executionService } from './executionService';
import { credentialService } from './credentialService';
import { webhookService } from './webhookService';
import type { ConnectionTestResult } from './types';

/** Test the n8n connection. Returns version, latency, and auth status. */
export async function testConnection(): Promise<ConnectionTestResult> {
  return proxy<ConnectionTestResult>({ action: 'test-connection' });
}

/** The unified n8n integration gateway. */
export const n8n = {
  testConnection,
  workflows: workflowService,
  executions: executionService,
  credentials: credentialService,
  webhooks: webhookService,
};
