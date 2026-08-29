// Agent Registry Foundation — Database Service
// Sprint 1: Unified Agent Registry
//
// This service is the canonical, single source of truth for agent and
// department records. lib/crew/agent-registry.ts (the in-memory routing
// cache) may still be populated by callers, but it must no longer be
// treated as authoritative — it should be hydrated from this service via
// AgentRegistry.mergeFromRegistry() wherever it is wired up.
//
// Design:
// - loadAgents() fetches from `agent_registry`, falls back to AGENT_DEFINITIONS
// - loadDepartments() fetches from `agent_departments`, falls back to DEPARTMENTS
// - loadRegistry() fetches both in parallel and returns a snapshot
// - createAgent/updateAgent/createDepartment/updateDepartment perform the
//   minimum safe write operations against the existing schema (additive
//   only — no new tables/columns required, RLS already permits writes)
// - AGENT_DEFINITIONS/DEPARTMENTS remain as fallback/seed data only, used
//   when the database is unreachable or empty — they are not authoritative

import { supabase } from '@/lib/supabase/client';
import { AGENT_DEFINITIONS, getAgentDefinitionById } from './definitions';
import { DEPARTMENTS, getDepartmentById } from './departments';
import type {
  AgentRecord,
  DepartmentRecord,
  AgentRegistrySnapshot,
  AgentPermissions,
  AgentLevel,
  AgentAvailability,
  DepartmentWithAgents,
  BusinessUnitRecord,
  BusinessUnitKind,
  BusinessUnitWithDepartments,
} from './types';
import type { Agent } from '@/types';

// ---- DB Row Mappers ----

interface AgentRegistryRow {
  id: string;
  role_id: string | null;
  display_name: string;
  role: string;
  level: string;
  department_id: string | null;
  description: string;
  capabilities: unknown;
  permissions: unknown;
  avatar: string;
  avatar_url: string | null;
  theme_color: string;
  status: string;
  system_prompt_template: string;
  model: string;
  is_active: boolean;
  sort_order: number;
  parent_id: string | null;
  children_ids: unknown;
  priority: number;
  tools: unknown;
  created_at: string;
  updated_at: string;
}

interface DepartmentRow {
  id: string;
  name: string;
  description: string;
  icon: string;
  theme_color: string;
  sort_order: number;
  business_unit_id: string | null;
  created_at: string;
  updated_at: string;
}

interface BusinessUnitRow {
  id: string;
  name: string;
  kind: string;
  description: string;
  icon: string;
  theme_color: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function mapAgentRow(row: AgentRegistryRow): AgentRecord {
  return {
    id: row.id,
    roleId: row.role_id ?? row.id,
    displayName: row.display_name,
    role: row.role,
    jobTitle: row.role,
    level: row.level as AgentLevel,
    hierarchyLevel: row.level as AgentLevel,
    departmentId: row.department_id,
    reportsTo: row.parent_id ?? null,
    description: row.description,
    capabilities: Array.isArray(row.capabilities)
      ? (row.capabilities as string[])
      : [],
    permissions: (row.permissions ?? {}) as AgentPermissions,
    avatar: row.avatar,
    avatarUrl: row.avatar_url ?? null,
    themeColor: row.theme_color,
    status: row.status as AgentAvailability,
    systemPromptTemplate: row.system_prompt_template,
    model: row.model,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    parentId: row.parent_id ?? null,
    childrenIds: Array.isArray(row.children_ids)
      ? (row.children_ids as string[])
      : [],
    priority: row.priority ?? 0,
    tools: Array.isArray(row.tools) ? (row.tools as string[]) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDepartmentRow(row: DepartmentRow): DepartmentRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    themeColor: row.theme_color,
    sortOrder: row.sort_order,
    businessUnitId: row.business_unit_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBusinessUnitRow(row: BusinessUnitRow): BusinessUnitRecord {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as BusinessUnitKind,
    description: row.description,
    icon: row.icon,
    themeColor: row.theme_color,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---- Public API ----

export async function loadAgents(): Promise<AgentRecord[]> {
  try {
    const { data, error } = await supabase
      .from('agent_registry')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) throw error;
    if (!data || data.length === 0) return [...AGENT_DEFINITIONS];

    return (data as AgentRegistryRow[]).map(mapAgentRow);
  } catch {
    return [...AGENT_DEFINITIONS];
  }
}

/**
 * Same query as loadAgents(), but throws on a real query failure instead
 * of silently falling back to AGENT_DEFINITIONS. M5-07: loadAgents()'s
 * "swallow and fall back" contract is relied on by several existing
 * callers (org-chart.tsx, crew-coordinator.ts, manager-delegation.ts,
 * capabilityMatcher.ts, etc.) that intentionally want an agent list no
 * matter what — this variant exists for the one caller that needs to
 * tell "the DB is genuinely empty/unreachable" apart from "loaded fine,"
 * mirroring M4-06's listMissionsOrThrow() pattern for the same reason.
 */
export async function loadAgentsOrThrow(): Promise<AgentRecord[]> {
  const { data, error } = await supabase
    .from('agent_registry')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return [...AGENT_DEFINITIONS];

  return (data as AgentRegistryRow[]).map(mapAgentRow);
}

export async function loadDepartments(): Promise<DepartmentRecord[]> {
  try {
    const { data, error } = await supabase
      .from('agent_departments')
      .select('*')
      .order('sort_order', { ascending: true });

    if (error) throw error;
    if (!data || data.length === 0) return [...DEPARTMENTS];

    return (data as DepartmentRow[]).map(mapDepartmentRow);
  } catch {
    return [...DEPARTMENTS];
  }
}

export async function loadRegistry(): Promise<AgentRegistrySnapshot> {
  const [agents, departments] = await Promise.all([
    loadAgents(),
    loadDepartments(),
  ]);

  return {
    agents,
    departments,
    fetchedAt: Date.now(),
  };
}

export async function loadDepartmentsWithAgents(): Promise<
  DepartmentWithAgents[]
> {
  const [agents, departments] = await Promise.all([
    loadAgents(),
    loadDepartments(),
  ]);

  return departments.map((dept) => {
    const deptAgents = agents.filter((a) => a.departmentId === dept.id);
    const manager = deptAgents.find((a) => a.level === 'manager') ?? null;
    return {
      ...dept,
      manager,
      agents: deptAgents,
    };
  });
}

export async function loadBusinessUnits(): Promise<BusinessUnitRecord[]> {
  try {
    const { data, error } = await supabase
      .from('business_units')
      .select('*')
      .order('sort_order', { ascending: true });

    if (error) throw error;
    if (!data) return [];

    return (data as BusinessUnitRow[]).map(mapBusinessUnitRow);
  } catch {
    return [];
  }
}

/**
 * Full Corporate Office / Operating Company hierarchy: every business unit
 * with its departments (each carrying its manager + agents) nested inside.
 * Falls back to an empty array if `business_units` isn't reachable — callers
 * (G-Brain, Command Deck) already render correctly with zero business units
 * (flat manager row, same as before this feature existed).
 */
export async function loadBusinessUnitsWithDepartments(): Promise<
  BusinessUnitWithDepartments[]
> {
  const [units, departmentsWithAgents] = await Promise.all([
    loadBusinessUnits(),
    loadDepartmentsWithAgents(),
  ]);

  return units.map((unit) => {
    const depts = departmentsWithAgents.filter((d) => d.businessUnitId === unit.id);
    return {
      ...unit,
      departments: depts,
      agents: depts.flatMap((d) => d.agents),
    };
  });
}

export async function getAgentById(id: string): Promise<AgentRecord | null> {
  try {
    const { data, error } = await supabase
      .from('agent_registry')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      const fallback = getAgentDefinitionById(id);
      return fallback ?? null;
    }

    return mapAgentRow(data as AgentRegistryRow);
  } catch {
    const fallback = getAgentDefinitionById(id);
    return fallback ?? null;
  }
}

export async function getAgentsByDepartment(
  departmentId: string,
): Promise<AgentRecord[]> {
  const agents = await loadAgents();
  return agents.filter((a) => a.departmentId === departmentId);
}

export async function getManagers(): Promise<AgentRecord[]> {
  const agents = await loadAgents();
  return agents.filter((a) => a.level === 'manager');
}

export async function getChief(): Promise<AgentRecord | null> {
  const agents = await loadAgents();
  return agents.find((a) => a.level === 'chief') ?? null;
}

export async function getAgentsByCapability(
  capability: string,
): Promise<AgentRecord[]> {
  const agents = await loadAgents();
  return agents.filter((a) => a.capabilities.includes(capability));
}

// ---- Write Operations ----
// Minimum safe writes needed to make this service the canonical registry.
// All fields are optional except the identifiers required by NOT NULL
// columns without defaults (id/displayName/role for agents; id/name for
// departments) — every other column already has a DB-level default.

export interface CreateAgentInput {
  id: string;
  displayName: string;
  role: string;
  level?: AgentLevel;
  departmentId?: string | null;
  description?: string;
  capabilities?: string[];
  permissions?: AgentPermissions;
  avatar?: string;
  avatarUrl?: string | null;
  themeColor?: string;
  status?: AgentAvailability;
  systemPromptTemplate?: string;
  model?: string;
  isActive?: boolean;
  sortOrder?: number;
  parentId?: string | null;
  childrenIds?: string[];
  priority?: number;
  tools?: string[];
}

export type UpdateAgentInput = Partial<Omit<CreateAgentInput, 'id'>>;

export interface CreateDepartmentInput {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  themeColor?: string;
  sortOrder?: number;
  businessUnitId?: string | null;
}

export type UpdateDepartmentInput = Partial<Omit<CreateDepartmentInput, 'id'>>;

function agentInputToRow(
  input: CreateAgentInput | UpdateAgentInput,
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if ('id' in input && input.id !== undefined) row.id = input.id;
  if (input.displayName !== undefined) row.display_name = input.displayName;
  if (input.role !== undefined) row.role = input.role;
  if (input.level !== undefined) row.level = input.level;
  if (input.departmentId !== undefined) row.department_id = input.departmentId;
  if (input.description !== undefined) row.description = input.description;
  if (input.capabilities !== undefined) row.capabilities = input.capabilities;
  if (input.permissions !== undefined) row.permissions = input.permissions;
  if (input.avatar !== undefined) row.avatar = input.avatar;
  if (input.avatarUrl !== undefined) row.avatar_url = input.avatarUrl;
  if (input.themeColor !== undefined) row.theme_color = input.themeColor;
  if (input.status !== undefined) row.status = input.status;
  if (input.systemPromptTemplate !== undefined)
    row.system_prompt_template = input.systemPromptTemplate;
  if (input.model !== undefined) row.model = input.model;
  if (input.isActive !== undefined) row.is_active = input.isActive;
  if (input.sortOrder !== undefined) row.sort_order = input.sortOrder;
  if (input.parentId !== undefined) row.parent_id = input.parentId;
  if (input.childrenIds !== undefined) row.children_ids = input.childrenIds;
  if (input.priority !== undefined) row.priority = input.priority;
  if (input.tools !== undefined) row.tools = input.tools;
  return row;
}

function departmentInputToRow(
  input: CreateDepartmentInput | UpdateDepartmentInput,
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if ('id' in input && input.id !== undefined) row.id = input.id;
  if (input.name !== undefined) row.name = input.name;
  if (input.description !== undefined) row.description = input.description;
  if (input.icon !== undefined) row.icon = input.icon;
  if (input.themeColor !== undefined) row.theme_color = input.themeColor;
  if (input.sortOrder !== undefined) row.sort_order = input.sortOrder;
  if (input.businessUnitId !== undefined) row.business_unit_id = input.businessUnitId;
  return row;
}

export async function createAgent(input: CreateAgentInput): Promise<AgentRecord> {
  const { data, error } = await supabase
    .from('agent_registry')
    .insert(agentInputToRow(input))
    .select()
    .single();

  if (error) throw error;
  return mapAgentRow(data as AgentRegistryRow);
}

export async function updateAgent(
  id: string,
  patch: UpdateAgentInput,
): Promise<AgentRecord> {
  const { data, error } = await supabase
    .from('agent_registry')
    .update(agentInputToRow(patch))
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return mapAgentRow(data as AgentRegistryRow);
}

export interface DeleteAgentResult {
  success: boolean;
  error?: string;
}

/**
 * Delete an agent from the registry.
 *
 * Guards (Agent Management, UI reconciliation mission):
 * - The chief agent ('temo') can never be deleted.
 * - An agent with active children (childrenIds non-empty) cannot be deleted
 *   until its workers are reassigned or removed first — prevents orphaned
 *   worker rows and broken parentId references.
 * - On success, the parent's childrenIds is updated to drop the deleted id,
 *   keeping the hierarchy metadata consistent.
 */
export async function deleteAgent(id: string): Promise<DeleteAgentResult> {
  if (id === 'temo') {
    return { success: false, error: 'The chief agent (Temo) cannot be deleted.' };
  }

  const agent = await getAgentById(id);
  if (!agent) {
    return { success: false, error: 'Agent not found.' };
  }
  if (agent.childrenIds.length > 0) {
    return {
      success: false,
      error: 'Cannot delete an agent that has workers assigned. Reassign or delete its workers first.',
    };
  }

  const { error } = await supabase.from('agent_registry').delete().eq('id', id);
  if (error) {
    return { success: false, error: error.message };
  }

  if (agent.parentId) {
    const parent = await getAgentById(agent.parentId);
    if (parent && parent.childrenIds.includes(id)) {
      await updateAgent(parent.id, {
        childrenIds: parent.childrenIds.filter((cid) => cid !== id),
      });
    }
  }

  return { success: true };
}

export async function createDepartment(
  input: CreateDepartmentInput,
): Promise<DepartmentRecord> {
  const { data, error } = await supabase
    .from('agent_departments')
    .insert(departmentInputToRow(input))
    .select()
    .single();

  if (error) throw error;
  return mapDepartmentRow(data as DepartmentRow);
}

export async function updateDepartment(
  id: string,
  patch: UpdateDepartmentInput,
): Promise<DepartmentRecord> {
  const { data, error } = await supabase
    .from('agent_departments')
    .update(departmentInputToRow(patch))
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return mapDepartmentRow(data as DepartmentRow);
}

export function getDepartmentSync(id: string): DepartmentRecord | undefined {
  return getDepartmentById(id);
}

export function getAgentSync(id: string): AgentRecord | undefined {
  return getAgentDefinitionById(id);
}

// ---- Registry → Runtime Bridge ----
// Converts an AgentRecord (canonical registry definition) into a partial
// runtime Agent object, carrying hierarchy metadata so the runtime store
// and G-Brain graph can use it without duplicating identity.
export function registryRecordToRuntime(
  rec: AgentRecord,
): Pick<Agent, 'id' | 'roleId' | 'jobTitle' | 'hierarchyLevel' | 'reportsTo' | 'level' | 'parentId' | 'childrenIds' | 'departmentId' | 'priority' | 'tools' | 'isActive'> {
  return {
    id: rec.id,
    roleId: rec.roleId,
    jobTitle: rec.jobTitle ?? rec.role,
    hierarchyLevel: rec.hierarchyLevel ?? rec.level,
    reportsTo: rec.reportsTo ?? rec.parentId,
    level: rec.level,
    parentId: rec.parentId,
    childrenIds: rec.childrenIds,
    departmentId: rec.departmentId,
    priority: rec.priority,
    tools: rec.tools,
    isActive: rec.isActive,
  };
}

// Full AgentRecord -> runtime Agent conversion, usable for agents that
// don't already exist in a hardcoded runtime list (unlike
// mergeRegistryIntoAgents below, which can only enrich pre-existing
// entries). This is what lets a brand-new agent — created through Agent
// Management, never hardcoded anywhere — render correctly on /agents and
// /chat, which consume the full `Agent` shape (unlike org-chart.tsx/
// command-deck.tsx, which use the leaner AgentUI from frontendBridge.ts).
//
// The registry has no columns for personality/voice/memory (those were
// never persisted — they were flavor text baked into the old mock
// dataset), so those fields are filled from real registry data where a
// real mapping exists (description -> bio, capabilities -> skills/traits)
// and with honest "not configured" defaults elsewhere (voice a neutral
// default, workflow disabled, memory zeroed) rather than fabricated
// numbers.
export function agentRecordToRuntimeAgent(record: AgentRecord): Agent {
  return {
    id: record.id,
    name: record.displayName,
    role: record.role,
    icon: record.avatar,
    avatarUrl: record.avatarUrl,
    color: record.themeColor,
    status: record.status,
    description: record.description,
    personality: {
      traits: record.capabilities.slice(0, 5),
      tone: record.description,
      greeting: `Hi, I'm ${record.displayName}. ${record.description}`,
      bio: record.description,
    },
    skills: record.capabilities,
    capabilities: record.capabilities,
    model: record.model,
    voice: { voiceName: 'Default', rate: 1.0, pitch: 1.0, lang: 'en-US', accent: 'Neutral' },
    workflow: { workflowId: '', workflowEndpoint: '', workflowStatus: 'disabled', enabled: false },
    memory: { conversationCount: 0, lastInteraction: 'N/A', topics: [], summary: '' },
    isFavorite: false,
    currentActivity: record.description,
    roleId: record.roleId,
    jobTitle: record.jobTitle ?? record.role,
    hierarchyLevel: record.hierarchyLevel ?? record.level,
    reportsTo: record.reportsTo ?? record.parentId,
    level: record.level,
    parentId: record.parentId,
    childrenIds: record.childrenIds,
    departmentId: record.departmentId,
    priority: record.priority,
    tools: record.tools,
    isActive: record.isActive,
  };
}

// Merge hierarchy metadata from the registry into runtime Agent objects.
// Runtime agents from dashboardStore carry personality/voice/memory that
// the registry doesn't have; the registry carries hierarchy that the
// runtime store doesn't have. This bridges them.
export function mergeRegistryIntoAgents(
  runtimeAgents: Agent[],
  registryRecords: AgentRecord[],
): Agent[] {
  const registryMap = new Map(registryRecords.map((r) => [r.id, r]));
  return runtimeAgents.map((agent) => {
    const rec = registryMap.get(agent.id);
    if (!rec) return agent;
    return {
      ...agent,
      roleId: rec.roleId,
      jobTitle: rec.jobTitle ?? rec.role,
      hierarchyLevel: rec.hierarchyLevel ?? rec.level,
      reportsTo: rec.reportsTo ?? rec.parentId,
      level: rec.level,
      parentId: rec.parentId,
      childrenIds: rec.childrenIds,
      departmentId: rec.departmentId ?? undefined,
      priority: rec.priority,
      tools: rec.tools,
      isActive: rec.isActive,
    };
  });
}
