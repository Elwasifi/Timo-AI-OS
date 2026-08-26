import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { resolveCredentials, saveConnectionStatus } from "./credentialService.ts";
import { n8nRequest, N8nApiError } from "./n8nClient.ts";
import * as workflowService from "./workflowService.ts";
import * as executionService from "./executionService.ts";
import * as webhookService from "./webhookService.ts";
import { detectTrigger } from "./triggerDetector.ts";
import { n8nLog } from "./logger.ts";
import type { ProxyRequest, ConnectionTestResult, N8nCredential, TriggerResult, ConvertResult, WorkflowRegistryEntry, N8nWorkflow } from "./types.ts";

declare global {
  const Deno: {
    serve(handler: (req: Request) => Response | Promise<Response>): void;
  };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as ProxyRequest;
    const config = await resolveCredentials();
    const start = Date.now();
    n8nLog.info(body.action, `Started ${body.action}`, { action: body.action });

    const result = await dispatch(config, body);
    const duration = Date.now() - start;
    n8nLog.info(body.action, `Completed ${body.action}`, {
      action: body.action, durationMs: duration, status: "ok",
    });

    return new Response(JSON.stringify({ ok: true, data: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = err instanceof N8nApiError ? err.status : 500;
    n8nLog.error("dispatch", message, { error: message, status: String(status) });
    return new Response(JSON.stringify({ ok: false, error: friendlyError(err) }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function dispatch(config: Parameters<typeof resolveCredentials> extends never ? never : Awaited<ReturnType<typeof resolveCredentials>>, body: ProxyRequest): Promise<unknown> {
  switch (body.action) {
    case "test-connection":
      return testConnection(config);

    case "list-workflows":
      return workflowService.listWorkflows(config);
    case "get-workflow":
      require(body.workflowId, "workflowId");
      return workflowService.getWorkflow(config, body.workflowId!);
    case "create-workflow":
      require(body.workflow, "workflow");
      return workflowService.createWorkflow(config, body.workflow!);
    case "update-workflow":
      require(body.workflowId, "workflowId");
      require(body.workflow, "workflow");
      return workflowService.updateWorkflow(config, body.workflowId!, body.workflow!);
    case "delete-workflow":
      require(body.workflowId, "workflowId");
      return workflowService.deleteWorkflow(config, body.workflowId!);
    case "activate-workflow":
      require(body.workflowId, "workflowId");
      return workflowService.activateWorkflow(config, body.workflowId!);
    case "deactivate-workflow":
      require(body.workflowId, "workflowId");
      return workflowService.deactivateWorkflow(config, body.workflowId!);
    case "import-workflow":
      require(body.workflow, "workflow");
      return workflowService.importWorkflow(config, body.workflow!);
    case "export-workflow":
      require(body.workflowId, "workflowId");
      return workflowService.exportWorkflow(config, body.workflowId!);
    case "search-workflows":
      require(body.tag, "tag");
      return workflowService.searchWorkflows(config, body.tag!);

    case "trigger-workflow":
      require(body.workflowId, "workflowId");
      return executionService.triggerWorkflow(config, body.workflowId!, body.input) as Promise<TriggerResult>;
    case "trigger-workflow-by-name":
      require(body.workflowName, "workflowName");
      return executionService.triggerWorkflowByName(config, body.workflowName!, body.input) as Promise<TriggerResult>;
    case "convert-to-webhook":
      require(body.workflowId, "workflowId");
      return workflowService.convertToWebhook(config, body.workflowId!) as Promise<ConvertResult>;
    case "sync-registry":
      return syncRegistry(config) as Promise<WorkflowRegistryEntry[]>;
    case "get-execution":
      require(body.executionId, "executionId");
      return executionService.getExecution(config, body.executionId!);
    case "list-executions":
      return executionService.listExecutions(config, body.limit, body.cursor);

    case "generate-webhook-url":
      require(body.webhookPath, "webhookPath");
      return { url: webhookService.generateWebhookUrl(config, body.webhookPath!) };
    case "register-webhook":
      require(body.workflowId, "workflowId");
      require(body.webhookPath, "webhookPath");
      return webhookService.registerWebhook(config, body.workflowId!, body.webhookPath!, body.httpMethod);
    case "remove-webhook":
      require(body.webhookId, "webhookId");
      await webhookService.removeWebhook(config, body.webhookId!);
      return { removed: true };
    case "trigger-webhook":
      require(body.webhookPath, "webhookPath");
      return executionService.triggerWebhook(config, body.webhookPath!, body.input, body.httpMethod);

    case "list-credentials":
      return listCredentials(config);
    case "get-credential":
      require(body.credentialId, "credentialId");
      return getCredential(config, body.credentialId!);

    default:
      throw new Error(`Unknown action: ${(body as ProxyRequest).action}`);
  }
}

async function testConnection(config: Awaited<ReturnType<typeof resolveCredentials>>): Promise<ConnectionTestResult> {
  const start = Date.now();
  try {
    const res = await n8nRequest<{ version?: string; data?: { version?: string } }>(config, "/workflows", {
      query: { limit: 1 },
    });
    const latency = Date.now() - start;
    const version = res.data?.version ?? res.data?.data?.version ?? "unknown";
    const result: ConnectionTestResult = {
      connected: true,
      version: String(version),
      latency,
      authStatus: config.apiKey ? "ok" : "unknown",
    };
    await saveConnectionStatus(JSON.stringify(result));
    return result;
  } catch (err) {
    const latency = Date.now() - start;
    const status = err instanceof N8nApiError ? err.status : 0;
    const result: ConnectionTestResult = {
      connected: false,
      version: null,
      latency,
      authStatus: status === 401 || status === 403 ? "failed" : "unknown",
      error: err instanceof Error ? err.message : "Connection failed",
    };
    await saveConnectionStatus(JSON.stringify(result));
    return result;
  }
}

async function listCredentials(config: Awaited<ReturnType<typeof resolveCredentials>>): Promise<N8nCredential[]> {
  const res = await n8nRequest<{ data: N8nCredential[] }>(config, "/credentials");
  // Strip any sensitive fields — return metadata only.
  return (res.data.data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    typeDisplay: c.typeDisplay,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }));
}

async function getCredential(config: Awaited<ReturnType<typeof resolveCredentials>>, id: string): Promise<N8nCredential> {
  const res = await n8nRequest<{ data: N8nCredential }>(config, `/credentials/${id}`);
  const c = res.data.data;
  return { id: c.id, name: c.name, type: c.type, typeDisplay: c.typeDisplay, createdAt: c.createdAt, updatedAt: c.updatedAt };
}

function require(value: unknown, name: string): void {
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required field: ${name}`);
  }
}

function friendlyError(err: unknown): string {
  if (err instanceof N8nApiError) {
    if (err.status === 401 || err.status === 403) return "n8n rejected the API key. Check the key in Settings.";
    if (err.status === 404) return "n8n returned not found. Check the workflow ID or webhook path.";
    if (err.status === 0) return `Could not reach n8n at the configured URL. ${err.message}`;
    return `n8n error: ${err.message}`;
  }
  return err instanceof Error ? err.message : "Unknown error";
}

async function syncRegistry(config: Awaited<ReturnType<typeof resolveCredentials>>): Promise<WorkflowRegistryEntry[]> {
  const workflows = await workflowService.listWorkflows(config);
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) throw new Error("Missing Supabase service role credentials.");
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const entries: WorkflowRegistryEntry[] = [];
  for (const wf of workflows) {
    // The list endpoint includes nodes; use it directly for trigger detection
    const trigger = detectTrigger(wf as unknown as { nodes: Array<Record<string, unknown>> });
    const entry: WorkflowRegistryEntry = {
      workflowId: wf.id,
      workflowName: wf.name,
      triggerType: trigger.type,
      webhookPath: trigger.webhookPath,
      webhookTestPath: trigger.webhookTestPath,
      active: wf.active,
      description: null,
      tags: [],
      lastUpdated: wf.updatedAt ?? null,
      syncedAt: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("workflow_registry")
      .upsert({
        workflow_id: entry.workflowId,
        workflow_name: entry.workflowName,
        trigger_type: entry.triggerType,
        webhook_path: entry.webhookPath,
        webhook_test_path: entry.webhookTestPath,
        active: entry.active,
        description: entry.description,
        tags: entry.tags,
        last_updated: entry.lastUpdated,
        synced_at: entry.syncedAt,
      }, { onConflict: "workflow_id" });
    if (error) n8nLog.warn("sync-registry", `Failed to upsert ${wf.id}`, { error: error.message });
    entries.push(entry);
  }
  return entries;
}
