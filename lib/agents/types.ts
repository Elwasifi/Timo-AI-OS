// Agent Registry Foundation — Type Definitions
// Phase 1: Manager Architecture
//
// These types define the persistent identity layer for agents.
// They are separate from the existing `Agent` interface in @/types
// (which carries runtime UI state) and will eventually bridge into it.

export type AgentLevel = 'chief' | 'manager' | 'worker';

export type AgentAvailability = 'available' | 'busy' | 'offline';

export interface AgentPermissions {
  canRouteTasks?: boolean;
  canAccessMemory?: boolean;
  canExecuteWorkflows?: boolean;
  canManageAgents?: boolean;
  canManageWorkers?: boolean;
  [key: string]: boolean | undefined;
}

export interface DepartmentRecord {
  id: string;
  name: string;
  description: string;
  icon: string;
  themeColor: string;
  sortOrder: number;
  /** Business unit this department belongs to (Corporate Office or an Operating Company) */
  businessUnitId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type BusinessUnitKind = 'corporate' | 'operating';

export interface BusinessUnitRecord {
  id: string;
  name: string;
  kind: BusinessUnitKind;
  description: string;
  icon: string;
  themeColor: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessUnitWithDepartments extends BusinessUnitRecord {
  departments: DepartmentWithAgents[];
  /** All agents across every department in this business unit, flattened */
  agents: AgentRecord[];
}

export interface AgentRecord {
  /** Immutable agent identity — never changes, used for runtime references */
  id: string;
  /** User-visible name — can be renamed without breaking functionality */
  displayName: string;
  /** Job title (e.g. 'Engineering Manager') */
  role: string;
  /** Organizational role metadata aliases for hierarchy-aware consumers */
  jobTitle?: string;
  hierarchyLevel?: AgentLevel;
  reportsTo?: string | null;
  /** Hierarchy level: chief (coordinator), manager (department head), worker (future) */
  level: AgentLevel;
  /** Department assignment (null for chief) */
  departmentId: string | null;
  /** Short description for prompts and UI */
  description: string;
  /** Structured capability list for capability-based task assignment */
  capabilities: string[];
  /** Permission flags controlling what this agent can do */
  permissions: AgentPermissions;
  /** Lucide icon name for avatar */
  avatar: string;
  /** Real uploaded portrait (agent-avatars Storage bucket). Null until one is uploaded via Agent Management — every render path falls back to the icon/hardcoded portrait system when unset. */
  avatarUrl: string | null;
  /** Hex color for UI theming */
  themeColor: string;
  /** Current availability status */
  status: AgentAvailability;
  /** Reference key for the system prompt builder */
  systemPromptTemplate: string;
  /** Default AI model for this agent */
  model: string;
  /** Soft activation flag — inactive agents are hidden from routing */
  isActive: boolean;
  /** Display ordering within department */
  sortOrder: number;
  /** Parent agent ID in the hierarchy (null for chief/root) */
  parentId: string | null;
  /** Child agent IDs (empty array until workers are created) */
  childrenIds: string[];
  /** Routing priority — lower = higher priority */
  priority: number;
  /** Tool IDs this agent can execute */
  tools: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DepartmentWithAgents extends DepartmentRecord {
  manager: AgentRecord | null;
  agents: AgentRecord[];
}

export interface AgentRegistrySnapshot {
  agents: AgentRecord[];
  departments: DepartmentRecord[];
  fetchedAt: number;
}
