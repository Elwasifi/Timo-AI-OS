// Webhook service — generate URLs, register test webhooks, remove them.
// n8n webhooks are defined as nodes inside a workflow; this service provides
// helpers to compute webhook URLs and to register/remove test webhooks via
// the /webhooks endpoint.

import { n8nRequest } from "./n8nClient.ts";
import type { N8nConfig, N8nWebhook } from "./types.ts";

export function generateWebhookUrl(config: N8nConfig, path: string, test = false): string {
  const clean = path.replace(/^\//, "");
  return test
    ? `${config.url}/webhook-test/${clean}`
    : `${config.url}/webhook/${clean}`;
}

export async function registerWebhook(
  config: N8nConfig,
  workflowId: string,
  path: string,
  httpMethod = "POST",
): Promise<N8nWebhook> {
  const res = await n8nRequest<{ data: N8nWebhook }>(config, `/workflows/${workflowId}/webhooks`, {
    method: "POST",
    body: { path, httpMethod },
  });
  return res.data.data;
}

export async function removeWebhook(config: N8nConfig, webhookId: string): Promise<void> {
  await n8nRequest(config, `/webhooks/${webhookId}`, { method: "DELETE" });
}

export async function listWebhooks(config: N8nConfig): Promise<N8nWebhook[]> {
  const res = await n8nRequest<{ data: N8nWebhook[] }>(config, "/webhooks");
  return res.data.data ?? [];
}
