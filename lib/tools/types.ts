// Tool Calling Engine — Core Types
// Provider-independent definitions for the universal execution layer.

export type ToolCategory =
  | 'n8n'
  | 'google'
  | 'github'
  | 'files'
  | 'web'
  | 'memory'
  | 'voice'
  | 'system'
  // Internal Operator Mode tools (M1-09) — capabilities TEMO uses on its
  // own operator's behalf, never a client tenant's. See
  // lib/tools/operator-tools.ts and lib/governance/internalTenant.ts.
  | 'operator';

export type ToolStatus = 'active' | 'disabled' | 'error' | 'beta';

export type ToolPermission =
  | 'n8n'
  | 'google'
  | 'github'
  | 'files'
  | 'web'
  | 'memory'
  | 'voice'
  | 'system';

export interface ToolParamSchema {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'file';
  description: string;
  required: boolean;
  default?: unknown;
  enum?: string[];
}

export interface ToolResponseSchema {
  type: 'object' | 'array' | 'string' | 'boolean' | 'void';
  fields?: Record<string, string>;
}

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  permissions: ToolPermission[];
  requiredParams: ToolParamSchema[];
  optionalParams: ToolParamSchema[];
  responseSchema: ToolResponseSchema;
  status: ToolStatus;
  version: string;
  supportedAgents: string[];
  streaming?: boolean;
  /** V1 (Section 8): destructive/costly/irreversible tools must be approved before execution. */
  requiresApproval?: boolean;
}

export interface ToolRequest {
  id: string;
  toolId: string;
  agentId: string;
  arguments: Record<string, unknown>;
  timeout?: number;
  retries?: number;
  /** V1: attribution + simulation context threaded into ToolExecutionContext. */
  tenantId?: string | null;
  missionId?: string | null;
  taskId?: string | null;
  isSimulation?: boolean;
  approvedApprovalId?: string;
}

export interface ToolResultEnvelope {
  ok: boolean;
  toolId: string;
  requestId: string;
  agentId: string;
  data?: unknown;
  error?: string;
  durationMs: number;
  retries: number;
  streaming: boolean;
  timestamp: number;
  /** V1: set when the tool was gated and is now awaiting human approval instead of having run. `ok` is false in this case. */
  pendingApprovalId?: string;
  /** V1: set when this call ran in a simulation mission — no real external side effect occurred. */
  simulated?: boolean;
}

export interface ToolExecutionEvent {
  type: 'start' | 'progress' | 'success' | 'error' | 'retry' | 'cancel';
  toolId: string;
  requestId: string;
  agentId: string;
  detail: string;
  timestamp: number;
  data?: unknown;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolExecutionContext
) => Promise<unknown>;

export interface ToolExecutionContext {
  agentId: string;
  requestId: string;
  signal: AbortSignal;
  onProgress?: (detail: string, data?: unknown) => void;
  chainContext?: Record<string, unknown>;
  /** V1: tenant/mission attribution, and simulation mode (blocks real external side effects). */
  tenantId?: string | null;
  missionId?: string | null;
  taskId?: string | null;
  isSimulation?: boolean;
  /** V1: set once a gated tool's pending approval has actually been approved, to bypass the gate on retry. */
  approvedApprovalId?: string;
}

export interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

// Agent permission matrix — which agents can use which permission scopes.
// Temo (chief) has universal access; specialists are scoped to their domain.
export const AGENT_PERMISSIONS: Record<string, ToolPermission[]> = {
  temo: ['n8n', 'google', 'github', 'files', 'web', 'memory', 'voice', 'system'],
  flow: ['n8n', 'files', 'github', 'web'],
  nova: ['github', 'files', 'web'],
  atlas: ['google', 'web', 'memory'],
  luna: ['files', 'web'],
  echo: ['google', 'web', 'memory'],
};
