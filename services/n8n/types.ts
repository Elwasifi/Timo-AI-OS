// Frontend types for the n8n integration layer. Mirrors the edge function
// contract so the service layer is fully typed end-to-end.

export interface N8nConfig {
  url: string;
  apiKey: string;
  timeout: number;
  retryCount: number;
  sslVerify: boolean;
}

export interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
  nodes: N8nNode[];
  connections: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  tags?: string[];
}

export interface N8nNode {
  id: string;
  name: string;
  type: string;
  typeVersion?: number;
  position?: [number, number];
  parameters?: Record<string, unknown>;
  credentials?: Record<string, { id: string; name: string }>;
}

export interface N8nExecution {
  executionId: string;
  finished: boolean;
  mode?: string;
  startedAt?: string;
  stoppedAt?: string;
  status: 'success' | 'error' | 'running' | 'waiting' | 'unknown';
  data?: {
    resultData?: {
      runData?: Record<string, unknown>;
      error?: { message: string; stack?: string } | null;
    };
  };
}

export type TriggerType = 'webhook' | 'manual' | 'schedule' | 'chat' | 'none';

export interface TriggerResult {
  workflowId: string;
  workflowName: string;
  triggerType: TriggerType;
  webhookUrl: string | null;
  httpMethod: string;
  httpStatus: number | null;
  latencyMs: number;
  payload: unknown;
  message?: string;
}

export interface ConvertResult {
  newWorkflowId: string;
  newWorkflowName: string;
  webhookUrl: string;
  webhookTestUrl: string;
}

export interface WorkflowRegistryEntry {
  workflowId: string;
  workflowName: string;
  triggerType: TriggerType;
  webhookPath: string | null;
  webhookTestPath: string | null;
  active: boolean;
  description: string | null;
  tags: string[];
  lastUpdated: string | null;
  syncedAt: string;
}

export interface N8nExecutionList {
  data: N8nExecution[];
  nextCursor?: string;
}

export interface N8nWebhook {
  id: string;
  workflowId: string;
  path: string;
  httpMethod: string;
  isActive: boolean;
  webhookId?: string;
  testUrl?: string;
  productionUrl?: string;
}

export interface N8nCredential {
  id: string;
  name: string;
  type: string;
  typeDisplay?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ConnectionTestResult {
  connected: boolean;
  version: string | null;
  latency: number;
  authStatus: 'ok' | 'failed' | 'unknown';
  error?: string;
}

export type ProxyAction =
  | 'test-connection'
  | 'list-workflows'
  | 'get-workflow'
  | 'create-workflow'
  | 'update-workflow'
  | 'delete-workflow'
  | 'activate-workflow'
  | 'deactivate-workflow'
  | 'import-workflow'
  | 'export-workflow'
  | 'search-workflows'
  | 'trigger-workflow'
  | 'trigger-workflow-by-name'
  | 'convert-to-webhook'
  | 'sync-registry'
  | 'get-execution'
  | 'list-executions'
  | 'generate-webhook-url'
  | 'register-webhook'
  | 'remove-webhook'
  | 'trigger-webhook'
  | 'list-credentials'
  | 'get-credential';

export interface ProxyRequest {
  action: ProxyAction;
  workflowId?: string;
  workflowName?: string;
  workflow?: Partial<N8nWorkflow>;
  workflowData?: unknown;
  tag?: string;
  executionId?: string;
  limit?: number;
  cursor?: string;
  input?: Record<string, unknown>;
  webhookPath?: string;
  httpMethod?: string;
  webhookId?: string;
  credentialId?: string;
}

export interface ProxyResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}
