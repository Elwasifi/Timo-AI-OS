// Permission Engine — validates that an agent is allowed to invoke a tool
// before execution. Uses the agent-permission matrix from types.ts.

import type { ToolDefinition, ToolPermission } from './types';
import { AGENT_PERMISSIONS } from './types';
import { logger } from '@/lib/utils/logger';

export class PermissionDeniedError extends Error {
  constructor(agentId: string, toolId: string, missing: ToolPermission[]) {
    super(`Agent "${agentId}" lacks permission(s): ${missing.join(', ')} for tool "${toolId}"`);
    this.name = 'PermissionDeniedError';
  }
}

export class PermissionEngine {
  /** Get the full permission list for an agent. */
  getPermissions(agentId: string): ToolPermission[] {
    return AGENT_PERMISSIONS[agentId] ?? [];
  }

  /** Check if an agent has all required permissions for a tool. */
  canUse(agentId: string, tool: ToolDefinition): boolean {
    const agentPerms = this.getPermissions(agentId);
    return tool.permissions.every((p) => agentPerms.includes(p));
  }

  /** Validate and throw if the agent cannot use the tool. */
  validate(agentId: string, tool: ToolDefinition): void {
    const agentPerms = this.getPermissions(agentId);

    if (agentPerms.length === 0) {
      logger.n8nWarn(`Unknown agent "${agentId}" — no permissions assigned`);
      throw new PermissionDeniedError(agentId, tool.id, tool.permissions);
    }

    const missing = tool.permissions.filter((p) => !agentPerms.includes(p));
    if (missing.length > 0) {
      throw new PermissionDeniedError(agentId, tool.id, missing);
    }

    if (tool.supportedAgents.length > 0 && !tool.supportedAgents.includes(agentId)) {
      logger.n8nWarn(`Tool "${tool.id}" does not list agent "${agentId}" as supported`);
    }
  }

  /** List all permissions for an agent (for UI / debug). */
  describe(agentId: string): { permission: ToolPermission; granted: boolean }[] {
    const agentPerms = this.getPermissions(agentId);
    const all: ToolPermission[] = ['n8n', 'google', 'github', 'files', 'web', 'memory', 'voice', 'system'];
    return all.map((p) => ({ permission: p, granted: agentPerms.includes(p) }));
  }
}

export const permissionEngine = new PermissionEngine();
