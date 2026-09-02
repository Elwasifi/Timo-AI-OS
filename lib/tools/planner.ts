// Tool Planner — lets the AI choose which tools to use for a given request,
// optionally chaining them. The planner uses the active AI provider to decide
// tool selection from the registry, then executes via the Tool Executor.
//
// This replaces hardcoded routing: the AI sees the available tools (filtered
// by agent permissions) and picks the right one(s) from the natural-language
// request.

import type { ToolDefinition, ToolRequest, ToolResultEnvelope, ToolPermission } from './types';
import { toolRegistry } from './registry';
import { toolExecutor } from './executor';
import { createChain, type ChainStep, type ChainResult } from './chain';
import { chatWithFallback, AIProviderError, type ChatMessage } from '@/lib/ai/ai-provider';
import { route, classifyTask } from '@/lib/ai/router';
import { logger } from '@/lib/utils/logger';

interface PlannerPlan {
  toolId: string;
  arguments: Record<string, unknown>;
}

interface PlannerResponse {
  tools: PlannerPlan[];
  explanation: string;
}

/**
 * M6-01: thrown (never swallowed to null) when the planner genuinely
 * failed — either every fallback AI provider was exhausted, or the AI
 * responded but its output wasn't usable (didn't parse as the expected
 * JSON shape). Distinct from a legitimate `{tools:[],...}` response,
 * which means the AI looked at the request and decided nothing fits —
 * that's not a failure and should never be reported as one.
 */
export class ToolPlanningError extends Error {
  constructor(message: string, public cause_: unknown, public provider?: string) {
    super(message);
    this.name = 'ToolPlanningError';
  }
}

export class ToolPlanner {
  /**
   * Ask the AI to choose tool(s) for a natural-language request.
   * Returns an array of tool invocations (1 for single, 2+ for a chain).
   */
  async plan(
    input: string,
    agentId: string,
    permissions: ToolPermission[]
  ): Promise<PlannerResponse | null> {
    const available = toolRegistry.listForAgent(agentId, permissions);
    if (available.length === 0) return null;

    const toolCatalog = available.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      requiredParams: t.requiredParams.map((p) => `${p.name}:${p.type}`),
      optionalParams: t.optionalParams.map((p) => `${p.name}:${p.type}`),
    }));

    const systemPrompt = `You are a tool-planning assistant for an AI agent named "${agentId}".
You have access to the following tools. Choose the best tool(s) to fulfill the user's request.

Available tools:
${JSON.stringify(toolCatalog, null, 2)}

Respond with ONLY a JSON object (no markdown, no backticks):
{"tools":[{"toolId":"...","arguments":{...}}],"explanation":"one sentence"}

Rules:
- Pick 1 tool for simple requests, multiple for chained requests (e.g. read then email).
- Only use toolIds from the list above.
- Fill in arguments from the user's request. Use empty strings for unknown values.
- If no tool fits, return {"tools":[],"explanation":"no matching tool"}`;

    try {
      // Tool selection is a small, structured-JSON task — the router's
      // STRUCTURED_OUTPUT/TOOL_EXECUTION profile favors fast, reliable
      // models over always reaching for the strongest one.
      const decision = await route({ classification: classifyTask({ text: input, needsStructuredOutput: true, needsTools: true }), tenantId: null });
      const result = await chatWithFallback(
        [{ role: 'user', content: input }] as ChatMessage[],
        {
          systemPrompt, temperature: 0.1, maxTokens: 500, candidates: decision.candidates,
          usageContext: {
            operation: 'tool_planning',
            agentId,
            tenantId: null,
            metadata: { taskType: decision.taskType, routingMode: decision.mode },
          },
        }
      );
      return this.parse(result.content, available);
    } catch (err) {
      // parse() already logged and threw its own ToolPlanningError — don't
      // double-log or re-wrap it, just let it propagate.
      if (err instanceof ToolPlanningError) throw err;

      // M6-01: this used to log-and-return-null here, and tool-decision.ts
      // wrapped the whole call in a second `.catch(() => null)` on top —
      // the AI-call failure (e.g. every fallback provider exhausted) and a
      // legitimate "no tool fits" response were indistinguishable to the
      // caller, surfacing as an unhelpful empty "Tool execution failed
      // for: " with no real reason (found live during M5-11 testing).
      // Now: log with full diagnostic context, then rethrow so the caller
      // can make an explicit decision instead of silently treating this
      // the same as "nothing matched."
      const provider = err instanceof AIProviderError ? err.providerId : undefined;
      const message = err instanceof Error ? err.message : String(err);
      logger.error('ToolPlanner AI call failed — every fallback provider likely exhausted', {
        error: message,
        provider,
        timestamp: Date.now(),
      });
      throw new ToolPlanningError(`Tool planning failed: ${message}`, err, provider);
    }
  }

  /**
   * Execute a planned set of tool invocations. Single = direct execute,
   * multiple = chained with shared context.
   */
  async executePlan(
    plan: PlannerResponse,
    agentId: string
  ): Promise<ToolResultEnvelope | ChainResult> {
    if (plan.tools.length === 0) {
      return {
        ok: false,
        toolId: 'planner',
        requestId: 'none',
        agentId,
        error: plan.explanation,
        durationMs: 0,
        retries: 0,
        streaming: false,
        timestamp: Date.now(),
      } as ToolResultEnvelope;
    }

    if (plan.tools.length === 1) {
      const t = plan.tools[0];
      const request: ToolRequest = {
        id: `plan-${Date.now()}`,
        toolId: t.toolId,
        agentId,
        arguments: t.arguments,
      };
      return toolExecutor.execute(request);
    }

    // Multiple tools = chain
    const chain = createChain();
    for (const t of plan.tools) {
      const step: ChainStep = {
        request: {
          toolId: t.toolId,
          agentId,
          arguments: t.arguments,
        },
      };
      chain.add(step);
    }
    return chain.run();
  }

  private parse(text: string, available: ToolDefinition[]): PlannerResponse {
    try {
      const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
      const data = JSON.parse(clean);
      const validIds = new Set(available.map((t) => t.id));
      const tools = (data.tools as PlannerPlan[]).filter((t) => validIds.has(t.toolId));
      return { tools, explanation: data.explanation ?? '' };
    } catch (err) {
      // M6-01: this used to swallow completely silently — zero logging, zero
      // trace — on any response that wasn't valid JSON (markdown drift,
      // truncation, a plain-language refusal). That's the actual root cause
      // this ticket traces back to: the AI call itself succeeds, so
      // plan()'s own try/catch never fires, and this was the only place the
      // failure could have been recorded. Distinct from a genuine "no tool
      // fits" answer (which parses fine, just with an empty tools array) —
      // an unparseable response is always a real planner failure.
      const message = err instanceof Error ? err.message : String(err);
      logger.error('ToolPlanner could not parse AI response as JSON', {
        error: message,
        rawResponse: text.slice(0, 500),
        timestamp: Date.now(),
      });
      throw new ToolPlanningError(`Tool planner response was not valid JSON: ${message}`, err);
    }
  }
}

export const toolPlanner = new ToolPlanner();
