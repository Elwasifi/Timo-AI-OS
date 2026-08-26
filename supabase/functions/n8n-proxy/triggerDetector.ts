// Trigger detection — inspects workflow nodes to determine the trigger type
// and extract webhook paths. Used by the registry sync and execution engine.

import type { N8nWorkflow } from "./types.ts";

export type TriggerType = "webhook" | "manual" | "schedule" | "chat" | "none";

export interface TriggerInfo {
  type: TriggerType;
  webhookPath: string | null;
  webhookTestPath: string | null;
  webhookHttpMethod: string | null;
}

const TRIGGER_NODE_TYPES: Record<string, TriggerType> = {
  "n8n-nodes-base.webhook": "webhook",
  "n8n-nodes-base.manualTrigger": "manual",
  "n8n-nodes-base.scheduleTrigger": "schedule",
  "n8n-nodes-base.cronTrigger": "schedule",
  "n8n-nodes-base.cron": "schedule",
  "n8n-nodes-base.chatTrigger": "chat",
  "n8n-nodes-base.formTrigger": "webhook",
};

export function detectTrigger(workflow: { nodes?: Array<Record<string, unknown>> }): TriggerInfo {
  const nodes = workflow.nodes ?? [];

  for (const node of nodes) {
    const type = String(node.type ?? "");
    const mapped = TRIGGER_NODE_TYPES[type];
    if (!mapped) continue;

    if (mapped === "webhook") {
      const params = (node.parameters ?? {}) as Record<string, unknown>;
      const path = params.path ? String(params.path) : null;
      const httpMethod = params.httpMethod ? String(params.httpMethod) : "POST";
      const webhookId = node.webhookId ? String(node.webhookId) : null;
      return {
        type: "webhook",
        webhookPath: path,
        webhookTestPath: webhookId,
        webhookHttpMethod: httpMethod,
      };
    }

    return {
      type: mapped,
      webhookPath: null,
      webhookTestPath: null,
      webhookHttpMethod: null,
    };
  }

  return {
    type: "none",
    webhookPath: null,
    webhookTestPath: null,
    webhookHttpMethod: null,
  };
}

export function isTriggerNode(nodeType: string): boolean {
  return nodeType in TRIGGER_NODE_TYPES;
}

export function hasTriggerNode(workflow: N8nWorkflow): boolean {
  const nodes = workflow.nodes ?? [];
  return nodes.some((n) => isTriggerNode(String(n.type ?? "")));
}
