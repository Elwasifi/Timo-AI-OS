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
import { chatWithFallback, type ChatMessage } from '@/lib/ai/ai-provider';
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
      logger.error('ToolPlanner AI call failed', { error: err instanceof Error ? err.message : 'unknown' });
      return null;
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

  private parse(text: string, available: ToolDefinition[]): PlannerResponse | null {
    try {
      const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
      const data = JSON.parse(clean);
      const validIds = new Set(available.map((t) => t.id));
      const tools = (data.tools as PlannerPlan[]).filter((t) => validIds.has(t.toolId));
      return { tools, explanation: data.explanation ?? '' };
    } catch {
      return null;
    }
  }
}

export const toolPlanner = new ToolPlanner();
