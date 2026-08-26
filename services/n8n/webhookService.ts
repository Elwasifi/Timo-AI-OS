// Webhook service — generate webhook URLs, register/remove webhooks, and
// trigger them. URL generation is done client-side from the configured n8n
// base URL (read from settings) so callers can display URLs without a round
// trip; registration and removal go through the proxy.

import { proxy } from './n8nClient';
import { loadSettings } from '@/lib/settings/settings-service';
import type { N8nWebhook } from './types';

export const webhookService = {
  async generateUrl(path: string, test = false): Promise<string> {
    const settings = await loadSettings();
    const base = (settings.n8n_url ?? '').replace(/\/$/, '');
    const clean = path.replace(/^\//, '');
    return test ? `${base}/webhook-test/${clean}` : `${base}/webhook/${clean}`;
  },

  async register(workflowId: string, path: string, httpMethod = 'POST'): Promise<N8nWebhook> {
    return proxy<N8nWebhook>({ action: 'register-webhook', workflowId, webhookPath: path, httpMethod });
  },

  async remove(webhookId: string): Promise<{ removed: boolean }> {
    await proxy<void>({ action: 'remove-webhook', webhookId });
    return { removed: true };
  },

  async trigger(path: string, input?: Record<string, unknown>, httpMethod = 'POST'): Promise<unknown> {
    return proxy<unknown>({ action: 'trigger-webhook', webhookPath: path, input, httpMethod });
  },
};
