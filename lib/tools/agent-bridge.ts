// Agent Tool Bridge — the interface every agent uses to invoke tools.
// Agents never call external services directly; they emit ToolRequests
// through this bridge, which validates permissions and executes via the
// Tool Executor.

import type { ToolRequest, ToolResultEnvelope, ToolPermission } from './types';
import { toolExecutor } from './executor';
import { permissionEngine } from './permissions';
import { toolRegistry } from './registry';
import { logger } from '@/lib/utils/logger';

export class AgentToolBridge {
  /**
   * Execute a single tool by id. The agent specifies the tool and arguments;
   * the bridge handles permission validation, execution, retry, and logging.
   */
  async call(
    toolId: string,
    agentId: string,
    args: Record<string, unknown>,
    options?: { timeout?: number; retries?: number }
  ): Promise<ToolResultEnvelope> {
    const request: ToolRequest = {
      id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      toolId,
      agentId,
      arguments: args,
      timeout: options?.timeout,
      retries: options?.retries,
    };
    logger.n8n(`Agent "${agentId}" calling tool "${toolId}"`);
    return toolExecutor.execute(request);
  }

  /** List the tools available to an agent (filtered by permissions). */
  availableTools(agentId: string): ToolDefinition[] {
    const permissions = permissionEngine.getPermissions(agentId);
    return toolRegistry.listForAgent(agentId, permissions);
  }

  /** Get the agent's permissions (for debug / UI). */
  getPermissions(agentId: string): ToolPermission[] {
    return permissionEngine.getPermissions(agentId);
  }
}

export const agentToolBridge = new AgentToolBridge();

// Re-export for convenience
export type { ToolDefinition } from './types';
import type { ToolDefinition } from './types';
