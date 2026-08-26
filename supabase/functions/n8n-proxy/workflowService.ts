// Workflow service — CRUD + search + activate/deactivate for n8n workflows.
// All methods go through n8nClient, which handles auth, retry, and timeout.

import { n8nRequest } from "./n8nClient.ts";
import { detectTrigger } from "./triggerDetector.ts";
import type { N8nConfig, N8nNode, N8nWorkflow } from "./types.ts";

const BASE = "/workflows";

export async function listWorkflows(config: N8nConfig) {
  const res = await n8nRequest<{ data: N8nWorkflow[] }>(config, BASE);
  return res.data.data ?? [];
}

// Single-resource endpoints (GET/POST/PATCH one workflow) return the
// workflow object directly — only the list endpoint wraps results in
// `{ data: [...] }`. Confirmed live (M1-01 addendum, 2026-08-26) against a
// real n8n instance; every one of these had assumed the list-shaped
// envelope and never actually round-tripped through a live n8n API before.

export async function getWorkflow(config: N8nConfig, id: string) {
  const res = await n8nRequest<N8nWorkflow>(config, `${BASE}/${id}`);
  return res.data;
}

export async function createWorkflow(config: N8nConfig, workflow: Partial<N8nWorkflow>) {
  // n8n's create-workflow endpoint also requires a `settings` object even
  // when empty.
  const body = { settings: {}, ...workflow };
  const res = await n8nRequest<N8nWorkflow>(config, BASE, {
    method: "POST",
    body,
  });
  return res.data;
}

export async function updateWorkflow(config: N8nConfig, id: string, workflow: Partial<N8nWorkflow>) {
  const res = await n8nRequest<N8nWorkflow>(config, `${BASE}/${id}`, {
    method: "PATCH",
    body: workflow,
  });
  return res.data;
}

export async function deleteWorkflow(config: N8nConfig, id: string) {
  await n8nRequest(config, `${BASE}/${id}`, { method: "DELETE" });
  return { id, deleted: true };
}

export async function activateWorkflow(config: N8nConfig, id: string) {
  const res = await n8nRequest<N8nWorkflow>(config, `${BASE}/${id}/activate`, {
    method: "POST",
  });
  return res.data;
}

export async function deactivateWorkflow(config: N8nConfig, id: string) {
  const res = await n8nRequest<N8nWorkflow>(config, `${BASE}/${id}/deactivate`, {
    method: "POST",
  });
  return res.data;
}

export async function importWorkflow(config: N8nConfig, workflow: Partial<N8nWorkflow>) {
  return createWorkflow(config, workflow);
}

export async function exportWorkflow(config: N8nConfig, id: string) {
  return getWorkflow(config, id);
}

export async function searchWorkflows(config: N8nConfig, tag: string) {
  const res = await n8nRequest<{ data: N8nWorkflow[] }>(config, BASE, {
    query: { tag },
  });
  return res.data.data ?? [];
}

export interface ConvertResult {
  newWorkflowId: string;
  newWorkflowName: string;
  webhookUrl: string;
  webhookTestUrl: string;
}

export async function convertToWebhook(config: N8nConfig, workflowId: string): Promise<ConvertResult> {
  // Use list endpoint to get the workflow with nodes (detail endpoint may not include them)
  let original = await getWorkflow(config, workflowId);
  if (!original || !original.nodes) {
    const workflows = await listWorkflows(config);
    original = workflows.find((w) => w.id === workflowId) ?? original;
  }
  if (!original) throw new Error(`Workflow ${workflowId} not found.`);
  const trigger = detectTrigger(original);

  if (trigger.type === "webhook") {
    throw new Error("Workflow already has a webhook trigger — no conversion needed.");
  }

  const oldNodes = (original.nodes ?? []) as N8nNode[];
  const oldConnections = (original.connections ?? {}) as Record<string, unknown>;

  // Replace manual trigger nodes with webhook nodes, preserving position and id
  const webhookPath = `temo-${workflowId.toLowerCase().slice(0, 8)}`;
  const newNodes: N8nNode[] = oldNodes.map((node) => {
    const type = String(node.type ?? "");
    if (
      type === "n8n-nodes-base.manualTrigger" ||
      type === "n8n-nodes-base.scheduleTrigger" ||
      type === "n8n-nodes-base.cronTrigger" ||
      type === "n8n-nodes-base.cron"
    ) {
      return {
        ...node,
        type: "n8n-nodes-base.webhook",
        typeVersion: 2,
        parameters: {
          ...node.parameters,
          httpMethod: "POST",
          path: webhookPath,
          responseMode: "onReceived",
          options: {},
        },
        webhookId: crypto.randomUUID(),
      } satisfies N8nNode;
    }
    return node;
  });

  // If no trigger node was found, prepend a webhook trigger
  if (!newNodes.some((n) => n.type === "n8n-nodes-base.webhook")) {
    const webhookNode: N8nNode = {
      id: crypto.randomUUID(),
      name: "Webhook",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [0, 0],
      parameters: {
        httpMethod: "POST",
        path: webhookPath,
        responseMode: "onReceived",
        options: {},
      },
      webhookId: crypto.randomUUID(),
    };
    newNodes.unshift(webhookNode);
  }

  const newName = `${original.name} (Webhook)`;
  const newWorkflow = await createWorkflow(config, {
    name: newName,
    nodes: newNodes,
    connections: oldConnections,
  });

  // n8n only registers a webhook's listener route for an ACTIVE workflow —
  // a newly created workflow defaults to inactive, so the webhookUrl this
  // function returns would 404 until activated. Discovered live (M1-01
  // addendum, 2026-08-26): activating is the natural completion of "convert
  // to webhook," not a separate manual step the caller should have to know
  // about.
  await activateWorkflow(config, newWorkflow.id);

  return {
    newWorkflowId: newWorkflow.id,
    newWorkflowName: newName,
    webhookUrl: `${config.url}/webhook/${webhookPath}`,
    webhookTestUrl: `${config.url}/webhook-test/${webhookPath}`,
  };
}
