// Tool Registry — centralized, dynamic registration of all tools.
// No hardcoded tool lists: tools register themselves at runtime, and the
// registry is the single source of truth for what the engine can execute.

import type { RegisteredTool, ToolDefinition, ToolHandler, ToolPermission } from './types';
import { logger } from '@/lib/utils/logger';
import { AGENT_DEFINITIONS } from '@/lib/agents/definitions';

// ---- M7-13c-2a: workers use their manager's tool grants ----
//
// Every built-in tool lists MANAGER ids in `supportedAgents` ('nova', 'echo', ...). Mission
// tasks, however, run under the WORKER the manager delegates to ('nova-frontend', ...), so
// listForAgent() returned nothing for them and every worker task failed with "No matching tool".
// A worker now also matches the tools its manager supports. Permissions are NOT inherited —
// callers still pass the worker's own AGENT_PERMISSIONS, so a worker never gets a tool its
// own scope does not allow. Only worker -> manager (one level); a manager's parent (the chief)
// is deliberately NOT added, or every manager would inherit the chief's tool list.
//
// Source of the worker -> manager link: agent_registry.parent_id as loaded by
// agentRegistryService (rememberAgentParents), falling back to the static seed in
// lib/agents/definitions.ts. Synchronous and memory-only: no DB call on the hot path. A worker
// that exists in neither is treated as having no parent (exactly the pre-existing behaviour).
const STATIC_WORKER_PARENTS = new Map<string, string>(
  AGENT_DEFINITIONS.filter((a) => a.level === 'worker' && !!a.parentId).map((a) => [a.id, a.parentId as string]),
);
const loadedWorkerParents = new Map<string, string>();

/** Remember worker -> manager links from loaded agent_registry rows (called by agentRegistryService). */
export function rememberAgentParents(agents: ReadonlyArray<{ id: string; level?: string; parentId?: string | null }>): void {
  for (const a of agents) {
    if (a.level === 'worker' && a.parentId && a.parentId !== a.id) loadedWorkerParents.set(a.id, a.parentId);
  }
}

/** Ids whose `supportedAgents` entries apply to this agent: itself, plus its manager when it is a worker. */
export function resolveToolOwnerIds(agentId: string): string[] {
  const parent = loadedWorkerParents.get(agentId) ?? STATIC_WORKER_PARENTS.get(agentId);
  return parent && parent !== agentId ? [agentId, parent] : [agentId];
}

class ToolRegistryImpl {
  private tools = new Map<string, RegisteredTool>();

  register(definition: ToolDefinition, handler: ToolHandler): void {
    if (this.tools.has(definition.id)) {
      logger.n8nWarn(`Tool "${definition.id}" re-registered`, { version: definition.version });
    }
    this.tools.set(definition.id, { definition, handler });
    logger.n8nDebug(`Tool registered: ${definition.id} v${definition.version}`);
  }

  unregister(toolId: string): boolean {
    return this.tools.delete(toolId);
  }

  get(toolId: string): RegisteredTool | undefined {
    return this.tools.get(toolId);
  }

  has(toolId: string): boolean {
    return this.tools.has(toolId);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  listByCategory(category: string): ToolDefinition[] {
    return this.list().filter((t) => t.category === category);
  }

  listForAgent(agentId: string, permissions: ToolPermission[]): ToolDefinition[] {
    const owners = resolveToolOwnerIds(agentId);
    return this.list().filter((t) => {
      const hasPermission = t.permissions.some((p) => permissions.includes(p));
      const agentSupported = t.supportedAgents.length === 0 || owners.some((id) => t.supportedAgents.includes(id));
      return hasPermission && agentSupported && t.status !== 'disabled';
    });
  }

  listByPermission(permissions: ToolPermission[]): ToolDefinition[] {
    return this.list().filter((t) =>
      t.permissions.some((p) => permissions.includes(p)) && t.status !== 'disabled'
    );
  }

  count(): number {
    return this.tools.size;
  }

  clear(): void {
    this.tools.clear();
  }
}

export const toolRegistry = new ToolRegistryImpl();
