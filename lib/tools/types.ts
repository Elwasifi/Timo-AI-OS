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
//
// M5-10: this map previously had zero entries for 9 real, active agent
// identities (vertex/forge/sentinel/cortex/ledger/orion, plus Nova's 3
// workers) — permissionEngine.validate() throws for any agent with no
// entry at all, so all 9 were structurally unable to execute any tool
// (Deep Integrity Audit, Sections B/J). Each new entry below is scoped
// to what that specific role actually needs, per its real
// AGENT_DEFINITIONS capabilities/description — not copy-pasted from a
// neighbor. M5-12 adds a build-time check so a future agent can't ship
// silently missing an entry the way these did.
export const AGENT_PERMISSIONS: Record<string, ToolPermission[]> = {
  temo: ['n8n', 'google', 'github', 'files', 'web', 'memory', 'voice', 'system'],
  flow: ['n8n', 'files', 'github', 'web'],
  nova: ['github', 'files', 'web'],
  atlas: ['google', 'web', 'memory'],
  luna: ['files', 'web'],
  echo: ['google', 'web', 'memory'],

  // ---- Corporate Office (Deep Integrity Audit Section J — the "Corporate
  // Office ring" that was fully tool-dead) ----

  // Vertex (Chief Strategy Officer): strategic_planning,
  // portfolio_prioritization, opportunity_evaluation,
  // cross_company_alignment — needs external market/competitor research
  // (web) and to recall/build on prior strategic decisions (memory).
  // DB agent_registry row has canExecuteWorkflows:false — no automation
  // access; strategy work doesn't touch code/files/n8n.
  vertex: ['web', 'memory'],

  // Forge (Chief Innovation Officer / R&D): capability_research,
  // prototyping, tool_evaluation, model_evaluation — the one Corporate
  // Office agent whose DB row has canExecuteWorkflows:true, matching its
  // real job of prototyping new automation/capabilities, so it gets n8n
  // alongside web (research candidate tools/models) and memory (track
  // what's been evaluated).
  forge: ['web', 'memory', 'n8n'],

  // Sentinel (Chief Governance & Risk Officer): policy_enforcement,
  // approval_review, compliance_monitoring, risk_assessment — reviews
  // internal state (approval_requests, policy) rather than researching
  // externally; deliberately the narrowest scope of the 5 (memory only)
  // since nothing in its role needs the open web, code, or automation.
  sentinel: ['memory'],

  // Cortex (Chief Corporate Intelligence Officer): organizational_
  // intelligence, cross_company_analysis, executive_reporting — same
  // shape as Atlas (Research Manager) minus google/workflow-adjacent
  // integrations, since Cortex's brief is explicitly org-wide synthesis
  // for Temo, not managing a research department's day-to-day tools.
  cortex: ['web', 'memory'],

  // Ledger (Chief Financial Officer): cost_analysis, budget_tracking,
  // resource_allocation, usage_reporting — its real data source is
  // internal (usage_ledger), not external research; narrowest scope
  // (memory only) since nothing in its role needs the open web, code,
  // or automation.
  ledger: ['memory'],

  // ---- Trading (dormant, but still gets a real scope) ----

  // Orion (Trading Manager, is_active:false today): market_analysis,
  // trading_strategy, risk_management, portfolio_optimization — needs
  // external market data (web) and memory of positions/strategy.
  // Scoped now, while inactive, specifically so reactivating it later
  // doesn't silently repeat this exact bug a 4th time.
  orion: ['web', 'memory'],

  // ---- Nova's workers (M5-11 makes these actually get checked — see
  // executionLayer.ts/crew-coordinator.ts) ----
  //
  // Deliberately their own entries, not an inherited/aliased copy of
  // Nova's — even though the category set happens to match Nova's today
  // (github/files/web), each worker's scope should be independently
  // reviewable and independently narrowable later without touching the
  // manager's own permissions.

  // Frontend Engineer: react/nextjs/tailwind/ui_components — reads/writes
  // code (files), commits/PRs (github), looks up framework docs (web).
  'nova-frontend': ['github', 'files', 'web'],

  // Backend Engineer: api_design/database/services/integration — same
  // category needs as the frontend worker, for the backend half of the
  // same engineering work.
  'nova-backend': ['github', 'files', 'web'],

  // QA & Debug Engineer: testing/debugging/validation/bug_fixing — reads
  // code under test (files), commits fixes for bugs it finds (github,
  // matching its "bug_fixing" capability specifically), looks up error
  // messages/docs (web).
  'nova-qa': ['github', 'files', 'web'],
};
