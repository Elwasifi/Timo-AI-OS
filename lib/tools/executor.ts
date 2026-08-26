// Tool Executor — the universal execution layer.
//
// Responsibilities:
//   - Validate parameters against the tool's schema
//   - Validate permissions via the PermissionEngine
//   - Execute the tool handler with timeout + retry + cancellation
//   - Support streaming progress events
//   - Emit structured logs
//   - Return a standard ToolResultEnvelope
//
// No provider-specific logic lives here — the executor is agnostic to
// whether the tool calls n8n, Google, GitHub, or a future MCP server.

import type {
  ToolRequest, ToolResultEnvelope, ToolExecutionEvent, ToolExecutionContext,
  ToolParamSchema, RegisteredTool,
} from './types';
import { toolRegistry } from './registry';
import { permissionEngine } from './permissions';
import { logger } from '@/lib/utils/logger';
import { requestApproval } from '@/lib/governance/approvals';

export class ToolValidationError extends Error {
  constructor(toolId: string, param: string, message: string) {
    super(`Validation failed for "${toolId}": param "${param}" — ${message}`);
    this.name = 'ToolValidationError';
  }
}

type ExecutionListener = (event: ToolExecutionEvent) => void;

class ToolExecutorImpl {
  private listeners = new Set<ExecutionListener>();
  private activeExecutions = new Map<string, AbortController>();

  /** Subscribe to execution events (for the timeline / debug panel). */
  onEvent(listener: ExecutionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Execute a single tool request. */
  async execute(request: ToolRequest): Promise<ToolResultEnvelope> {
    const start = Date.now();
    const { toolId, agentId, arguments: args, timeout = 30000, retries = 0 } = request;

    const registered = toolRegistry.get(toolId);
    if (!registered) {
      return this.fail(request, start, 0, false, `Tool "${toolId}" not found in registry`);
    }

    // Permission check
    try {
      permissionEngine.validate(agentId, registered.definition);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Permission denied';
      logger.error(`Tool permission denied: ${toolId}`, { agentId, error: msg });
      return this.fail(request, start, 0, false, msg);
    }

    // Parameter validation
    const validationError = this.validateParams(registered, args);
    if (validationError) {
      return this.fail(request, start, 0, false, validationError.message);
    }

    // V1 approval gate (Section 8): a tool flagged requiresApproval stops
    // here and creates a pending request instead of running, UNLESS the
    // caller already has an approved approval id for this exact action.
    if (registered.definition.requiresApproval && !request.approvedApprovalId) {
      const approval = await requestApproval({
        tenantId: request.tenantId ?? null,
        type: 'tool_execution',
        title: `Approve: ${registered.definition.name}`,
        detail: `${agentId} requested "${toolId}" with arguments: ${JSON.stringify(args).slice(0, 300)}`,
        payload: { toolId, agentId, arguments: args },
        requestedBy: agentId,
        missionId: request.missionId ?? null,
        taskId: request.taskId ?? null,
      });
      const envelope: ToolResultEnvelope = {
        ok: false,
        toolId,
        requestId: request.id,
        agentId,
        error: 'This action requires approval before it can run.',
        durationMs: Date.now() - start,
        retries: 0,
        streaming: false,
        timestamp: Date.now(),
        pendingApprovalId: approval?.id,
      };
      this.emit({ type: 'error', toolId, requestId: request.id, agentId, detail: 'Pending approval', timestamp: Date.now() });
      logger.n8nWarn(`Tool gated pending approval: ${toolId}`, { approvalId: approval?.id });
      return envelope;
    }

    // V1 simulation mode (Section 12): missions marked isSimulation never
    // trigger real external side effects. The handler is skipped entirely
    // and a clearly-labeled simulated result is returned instead, so R&D
    // missions can exercise the full pipeline without touching production
    // systems (n8n workflows, memory writes with real consequences, etc).
    if (request.isSimulation) {
      const envelope: ToolResultEnvelope = {
        ok: true,
        toolId,
        requestId: request.id,
        agentId,
        data: { simulated: true, note: `Simulated execution of "${toolId}" — no real external action was taken.`, wouldHaveCalledWith: args },
        durationMs: Date.now() - start,
        retries: 0,
        streaming: false,
        timestamp: Date.now(),
        simulated: true,
      };
      this.emit({ type: 'success', toolId, requestId: request.id, agentId, detail: 'Simulated (no real side effect)', timestamp: Date.now() });
      return envelope;
    }

    // Set up cancellation + timeout
    const controller = new AbortController();
    this.activeExecutions.set(request.id, controller);
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const context: ToolExecutionContext = {
      agentId,
      requestId: request.id,
      signal: controller.signal,
      tenantId: request.tenantId ?? null,
      missionId: request.missionId ?? null,
      taskId: request.taskId ?? null,
      isSimulation: request.isSimulation ?? false,
      onProgress: (detail, data) => {
        this.emit({ type: 'progress', toolId, requestId: request.id, agentId, detail, timestamp: Date.now(), data });
      },
    };

    let attempt = 0;
    const maxAttempts = retries + 1;
    let lastError = '';

    while (attempt < maxAttempts) {
      try {
        this.emit({ type: 'start', toolId, requestId: request.id, agentId, detail: `Attempt ${attempt + 1}/${maxAttempts}`, timestamp: Date.now() });
        logger.n8n(`Tool executing: ${toolId}`, { agentId, attempt });

        const data = await registered.handler(args, context);
        clearTimeout(timeoutId);
        this.activeExecutions.delete(request.id);

        const envelope: ToolResultEnvelope = {
          ok: true,
          toolId,
          requestId: request.id,
          agentId,
          data,
          durationMs: Date.now() - start,
          retries: attempt,
          streaming: registered.definition.streaming ?? false,
          timestamp: Date.now(),
        };

        this.emit({ type: 'success', toolId, requestId: request.id, agentId, detail: `Completed in ${envelope.durationMs}ms`, timestamp: Date.now(), data });
        logger.n8n(`Tool succeeded: ${toolId}`, { durationMs: envelope.durationMs, retries: attempt });
        return envelope;

      } catch (err) {
        attempt++;
        lastError = err instanceof Error ? err.message : String(err);

        if (controller.signal.aborted) {
          this.emit({ type: 'cancel', toolId, requestId: request.id, agentId, detail: 'Cancelled (timeout)', timestamp: Date.now() });
          logger.n8nWarn(`Tool timed out: ${toolId}`, { agentId, timeout });
          break;
        }

        if (attempt < maxAttempts) {
          this.emit({ type: 'retry', toolId, requestId: request.id, agentId, detail: `Retry ${attempt + 1}/${maxAttempts}: ${lastError}`, timestamp: Date.now() });
          logger.n8nWarn(`Tool retrying: ${toolId}`, { attempt, error: lastError });
          await this.backoff(attempt);
        }
      }
    }

    clearTimeout(timeoutId);
    this.activeExecutions.delete(request.id);
    return this.fail(request, start, attempt, false, lastError || 'Execution failed');
  }

  /** Cancel a running execution. */
  cancel(requestId: string): boolean {
    const controller = this.activeExecutions.get(requestId);
    if (!controller) return false;
    controller.abort();
    this.activeExecutions.delete(requestId);
    logger.n8nWarn(`Tool cancelled by request: ${requestId}`);
    return true;
  }

  /** List currently running executions (for debug panel). */
  getActive(): { requestId: string; toolId: string }[] {
    return Array.from(this.activeExecutions.keys()).map((id) => ({ requestId: id, toolId: 'unknown' }));
  }

  // ---- internals ----

  private validateParams(tool: RegisteredTool, args: Record<string, unknown>): ToolValidationError | null {
    const check = (schema: ToolParamSchema, isRequired: boolean) => {
      const value = args[schema.name];
      if (value === undefined || value === null) {
        if (isRequired && schema.required) {
          return new ToolValidationError(tool.definition.id, schema.name, 'required parameter missing');
        }
        return null;
      }
      if (!this.matchesType(value, schema.type)) {
        return new ToolValidationError(tool.definition.id, schema.name, `expected ${schema.type}, got ${typeof value}`);
      }
      if (schema.enum && !schema.enum.includes(String(value))) {
        return new ToolValidationError(tool.definition.id, schema.name, `must be one of: ${schema.enum.join(', ')}`);
      }
      return null;
    };

    for (const schema of tool.definition.requiredParams) {
      const err = check(schema, true);
      if (err) return err;
    }
    for (const schema of tool.definition.optionalParams) {
      const err = check(schema, false);
      if (err) return err;
    }
    return null;
  }

  private matchesType(value: unknown, expected: string): boolean {
    if (expected === 'array') return Array.isArray(value);
    if (expected === 'file') return value instanceof File || typeof value === 'string';
    if (expected === 'object') return typeof value === 'object' && !Array.isArray(value);
    return typeof value === expected;
  }

  private async backoff(attempt: number): Promise<void> {
    const delay = Math.min(1000 * 2 ** attempt, 8000);
    await new Promise((r) => setTimeout(r, delay));
  }

  private emit(event: ToolExecutionEvent): void {
    this.listeners.forEach((l) => l(event));
  }

  private fail(
    request: ToolRequest,
    start: number,
    retries: number,
    streaming: boolean,
    error: string
  ): ToolResultEnvelope {
    const envelope: ToolResultEnvelope = {
      ok: false,
      toolId: request.toolId,
      requestId: request.id,
      agentId: request.agentId,
      error,
      durationMs: Date.now() - start,
      retries,
      streaming,
      timestamp: Date.now(),
    };
    this.emit({ type: 'error', toolId: request.toolId, requestId: request.id, agentId: request.agentId, detail: error, timestamp: Date.now() });
    logger.error(`Tool failed: ${request.toolId}`, { error, retries, durationMs: envelope.durationMs });
    return envelope;
  }
}

export const toolExecutor = new ToolExecutorImpl();
