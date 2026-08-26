// Tool Registry — centralized, dynamic registration of all tools.
// No hardcoded tool lists: tools register themselves at runtime, and the
// registry is the single source of truth for what the engine can execute.

import type { RegisteredTool, ToolDefinition, ToolHandler, ToolPermission } from './types';
import { logger } from '@/lib/utils/logger';

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
    return this.list().filter((t) => {
      const hasPermission = t.permissions.some((p) => permissions.includes(p));
      const agentSupported = t.supportedAgents.length === 0 || t.supportedAgents.includes(agentId);
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
