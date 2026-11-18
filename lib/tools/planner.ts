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
import { isMemoryWriteTool } from './memoryWriteGuard';
import { chatWithFallback, AIProviderError, type ChatMessage } from '@/lib/ai/ai-provider';
import { route, classifyTask } from '@/lib/ai/router';
import type { ProviderId } from '@/lib/settings/settings-service';
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
  constructor(message: string, public cause_: unknown, public provider?: string, public code?: 'no_tenant' | 'planner_unavailable') {
    super(message);
    this.name = 'ToolPlanningError';
  }
}

/** M7-13c-2c-b: planner options. Memory WRITE tools are offered only when the caller says the user asked to remember. */
export interface ToolPlanOptions {
  /** true only when the detected intent says the user asked to remember/save something (DetectedIntent.asksToRemember). Default false = fail closed. */
  allowMemoryWrite?: boolean;
}

export class ToolPlanner {
  /**
   * Ask the AI to choose tool(s) for a natural-language request.
   * Returns an array of tool invocations (1 for single, 2+ for a chain).
   */
  async plan(
    input: string,
    agentId: string,
    permissions: ToolPermission[],
    tenantId?: string | null,
    options?: ToolPlanOptions,
  ): Promise<PlannerResponse | null> {
    // M7-13c-2c-b: memory write tools are not even OFFERED to the model unless the user asked to remember
    // (a code-level control — the planner cannot choose a tool it was never shown, and parse() only accepts offered ids).
    const available = toolRegistry
      .listForAgent(agentId, permissions)
      .filter((t) => options?.allowMemoryWrite === true || !isMemoryWriteTool(t));
    if (available.length === 0) return null;

    // M7-13e: this used to pass tenantId: null, which the ai-chat edge function
    // resolves as the INTERNAL tenant — a client tenant's tool planning ran on
    // (and was billed to) the internal tenant's provider keys. Fail closed:
    // with no resolved tenant there is nobody's key to use, so no provider call
    // is made (reported as a planning failure, not as "no tool fits").
    if (!tenantId) {
      throw new ToolPlanningError('Tool planning needs a resolved tenant; none was available, so no AI call was made.', null, undefined, 'no_tenant');
    }

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
- Fill in arguments only with values stated in, or directly implied by, the user's request. If a required value is not available, OMIT that argument — never guess and never use an empty string; the system reports the missing parameter.
- If no tool fits, return {"tools":[],"explanation":"no matching tool"}`;

    try {
      // Tool selection is a small, structured-JSON task — the router's
      // STRUCTURED_OUTPUT/TOOL_EXECUTION profile favors fast, reliable
      // models over always reaching for the strongest one.
      //
      // M7-13c-2c-b: planning BLOCKS the whole turn (the reply waits for it), so it is routed as latency-sensitive: the router then
      // weighs MEASURED latency in its task-fit term (scoring.ts scoreTaskMatch: <= 1.5 s -> 0.9, >= 4 s -> 0.2) instead of the neutral
      // 0.5 every candidate got for a normal-sensitivity tool task. Live, the planner ran on a Gemini model averaging ~7 s (10 s that day)
      // while Groq gpt-oss-120b averages ~1.8 s. No model is hardcoded; the router still picks from its proven trusted pool.
      const baseClassification = classifyTask({ text: input, needsStructuredOutput: true, needsTools: true });
      const decision = await route({ classification: { ...baseClassification, latencySensitivity: 'high' }, tenantId });
      const attempt = (candidates: { provider: ProviderId; model: string }[], plannerRouting: 'fast' | 'previous') => chatWithFallback(
        [{ role: 'user', content: input }] as ChatMessage[],
        {
          // M7-13c-1: was 500 — too small for a reasoning model's hidden tokens plus the JSON plan.
          systemPrompt, temperature: 0.1, maxTokens: 1200, candidates,
          usageContext: {
            operation: 'tool_planning',
            agentId,
            tenantId,
            metadata: { taskType: decision.taskType, routingMode: decision.mode, plannerRouting },
          },
        }
      );
      // A call that fails or times out is already handled by chatWithFallback: it walks to the next candidate (12 s per attempt, 20 s overall).
      const result = await attempt(decision.candidates, 'fast');
      try {
        return this.parse(result.content, available);
      } catch (parseErr) {
        if (!(parseErr instanceof ToolPlanningError)) throw parseErr;
        // M7-13c-2c-b: the fast model answered but its output was not a usable plan (not valid JSON / unknown tool ids). Fall back to the
        // router's PREVIOUS choice (the order the planner used before this change), skipping the model that just failed.
        const previous = await route({ classification: baseClassification, tenantId });
        const alternates = previous.candidates.filter((c) => !(c.provider === result.provider && c.model === result.model));
        if (alternates.length === 0) throw parseErr;
        logger.error('ToolPlanner: the fast planner model returned an unusable plan — retrying with the previous routing choice', {
          failedProvider: result.provider, failedModel: result.model, timestamp: Date.now(),
        });
        const second = await attempt(alternates, 'previous');
        return this.parse(second.content, available);
      }
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
      // M7-13c-1: the AI call itself failed (every candidate errored, timed out or the planner's own
      // deadline ran out) — distinct from "the AI answered and no tool fits". Carried as a code so
      // tool-decision.ts can say the planner was UNAVAILABLE instead of "no matching tool".
      throw new ToolPlanningError(`Tool planning failed: ${message}`, err, provider, 'planner_unavailable');
    }
  }

  /**
   * M7-13e: like plan(), but a "no tenant resolved" failure is returned as
   * `failure` instead of thrown, so a caller whose job is to answer the user
   * can DEGRADE to a plain chat reply rather than surface a planner error as
   * the answer. Deliberately narrow: every OTHER planner failure (providers
   * exhausted, unparseable response) still throws exactly as plan() does, so
   * existing behavior for those is unchanged.
   */
  async planSafely(
    input: string,
    agentId: string,
    permissions: ToolPermission[],
    tenantId?: string | null,
    options?: ToolPlanOptions,
  ): Promise<{ plan: PlannerResponse | null; failure: ToolPlanningError | null }> {
    try {
      return { plan: await this.plan(input, agentId, permissions, tenantId, options), failure: null };
    } catch (err) {
      if (err instanceof ToolPlanningError && err.code === 'no_tenant') return { plan: null, failure: err };
      throw err;
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
