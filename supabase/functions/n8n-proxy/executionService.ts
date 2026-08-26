// Execution service — webhook-based execution engine.
//
// The n8n Public REST API does NOT support executing workflows via POST
// /api/v1/executions (returns 405). The officially supported mechanism is
// webhook triggers. This module:
//   1. Looks up the workflow to detect its trigger type.
//   2. If webhook: POSTs to the production or test webhook URL.
//   3. If manual/none: returns a friendly error explaining the limitation.
//
// triggerWorkflow() is the single entry point for "Execute Workflow X".

import { n8nRequest } from "./n8nClient.ts";
import { listWorkflows } from "./workflowService.ts";
import { detectTrigger, type TriggerType } from "./triggerDetector.ts";
import type { N8nConfig, N8nExecution, N8nExecutionList, N8nWorkflow } from "./types.ts";

const EXEC_BASE = "/executions";

export interface TriggerResult {
  workflowId: string;
  workflowName: string;
  triggerType: TriggerType;
  webhookUrl: string | null;
  httpMethod: string;
  httpStatus: number | null;
  latencyMs: number;
  payload: unknown;
  message?: string;
}

export async function triggerWorkflow(
  config: N8nConfig,
  workflowId: string,
  input?: Record<string, unknown>,
): Promise<TriggerResult> {
  // The n8n list endpoint reliably includes nodes; the detail endpoint may not.
  // Use list to find the workflow, fall back to detail.
  let workflow: N8nWorkflow | undefined;
  try {
    const workflows = await listWorkflows(config);
    workflow = workflows.find((w) => w.id === workflowId);
  } catch {
    // fall through to detail
  }
  if (!workflow) {
    const wfRes = await n8nRequest<{ data: N8nWorkflow }>(config, `/workflows/${workflowId}`);
    workflow = wfRes.data.data;
  }
  if (!workflow) throw new Error(`Workflow ${workflowId} not found.`);

  const trigger = detectTrigger(workflow);
  const start = Date.now();

  if (trigger.type === "webhook" && trigger.webhookPath) {
    const useTestUrl = !workflow.active;
    const url = useTestUrl
      ? `${config.url}/webhook-test/${trigger.webhookTestPath ?? trigger.webhookPath}`
      : `${config.url}/webhook/${trigger.webhookPath}`;

    const method = trigger.webhookHttpMethod ?? "POST";
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.apiKey) headers["X-N8N-API-KEY"] = config.apiKey;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeout);

    try {
      const res = await fetch(url, {
        method,
        headers,
        body: input ? JSON.stringify(input) : undefined,
        signal: controller.signal,
        // @ts-expect-error: Deno verify option
        verify: config.sslVerify,
      });
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - start;
      const text = await res.text();

      let payload: unknown = text;
      try {
        payload = JSON.parse(text);
      } catch {
        // keep raw text
      }

      if (!res.ok) {
        return {
          workflowId,
          workflowName: workflow.name,
          triggerType: trigger.type,
          webhookUrl: url,
          httpMethod: method,
          httpStatus: res.status,
          latencyMs,
          payload,
          message: `Webhook returned HTTP ${res.status}`,
        };
      }

      return {
        workflowId,
        workflowName: workflow.name,
        triggerType: trigger.type,
        webhookUrl: url,
        httpMethod: method,
        httpStatus: res.status,
        latencyMs,
        payload,
      };
    } catch (err) {
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - start;
      return {
        workflowId,
        workflowName: workflow.name,
        triggerType: trigger.type,
        webhookUrl: url,
        httpMethod: method,
        httpStatus: null,
        latencyMs,
        payload: null,
        message: `Failed to reach webhook: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // Manual / schedule / chat / none — cannot execute via HTTP
  const latencyMs = Date.now() - start;
  const messages: Record<string, string> = {
    manual: "This workflow uses a Manual Trigger and cannot be executed programmatically. Use 'Convert to Webhook' to add a webhook trigger.",
    schedule: "This workflow uses a Schedule Trigger. It runs automatically on its schedule — no manual execution needed.",
    chat: "This workflow uses a Chat Trigger. Interact with it through the chat interface.",
    none: "This workflow has no trigger node. Add a Webhook or other trigger node in n8n, or use 'Convert to Webhook'.",
  };

  return {
    workflowId,
    workflowName: workflow.name,
    triggerType: trigger.type,
    webhookUrl: null,
    httpMethod: "N/A",
    httpStatus: null,
    latencyMs,
    payload: null,
    message: messages[trigger.type] ?? "This workflow cannot be executed programmatically.",
  };
}

export async function triggerWorkflowByName(
  config: N8nConfig,
  workflowName: string,
  input?: Record<string, unknown>,
): Promise<TriggerResult> {
  const workflows = await listWorkflows(config);
  const match = workflows.find((w) => w.name.toLowerCase() === workflowName.toLowerCase());
  if (!match) throw new Error(`Workflow "${workflowName}" not found.`);
  return triggerWorkflow(config, match.id, input);
}

// ---- Execution history (read-only, still supported by n8n API) ----

export async function getExecution(config: N8nConfig, executionId: string) {
  // Single-resource endpoint — flat response, not wrapped in { data }. Same
  // fix as workflowService.ts's single-resource functions (M1-01 addendum,
  // 2026-08-26).
  const res = await n8nRequest<N8nExecution>(config, `${EXEC_BASE}/${executionId}`);
  return res.data;
}

export async function listExecutions(
  config: N8nConfig,
  limit = 20,
  cursor?: string,
  workflowId?: string,
): Promise<N8nExecutionList> {
  const res = await n8nRequest<{ data: N8nExecution[]; nextCursor?: string }>(config, EXEC_BASE, {
    query: { limit, cursor, workflowId },
  });
  return { data: res.data.data ?? [], nextCursor: res.data.nextCursor };
}

// ---- Legacy webhook trigger (direct path, used by webhookService) ----

export async function triggerWebhook(
  config: N8nConfig,
  webhookPath: string,
  input?: Record<string, unknown>,
  method = "POST",
): Promise<unknown> {
  const url = `${config.url}/webhook/${webhookPath.replace(/^\//, "")}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) headers["X-N8N-API-KEY"] = config.apiKey;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeout);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: input ? JSON.stringify(input) : undefined,
      signal: controller.signal,
      // @ts-expect-error: Deno verify option
      verify: config.sslVerify,
    });
    clearTimeout(timeoutId);
    const text = await res.text();
    if (!res.ok) throw new Error(`Webhook trigger failed (${res.status}): ${text}`);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } finally {
    clearTimeout(timeoutId);
  }
}
