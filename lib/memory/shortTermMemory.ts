// Short-Term Memory — current conversation, active tasks, temporary context.
// Automatically trimmed to max_short_term_items from settings.

import { memoryStore } from './memoryStore';
import { loadMemorySettings } from './memorySettings';
import type { MemoryRecord } from './types';

export const shortTermMemory = {
  async add(input: {
    title: string;
    content: string;
    agent?: string;
    tool?: string;
    project?: string;
    tags?: string[];
    tenantId?: string | null;
  }): Promise<MemoryRecord> {
    const settings = await loadMemorySettings();
    const record = await memoryStore.store({
      type: 'short_term',
      title: input.title,
      content: input.content,
      agent: input.agent,
      tool: input.tool,
      project: input.project,
      tags: input.tags ?? ['short-term'],
      importance: 'temporary',
      expiresAt: new Date(Date.now() + settings.memory_expiration_days * 24 * 60 * 60 * 1000).toISOString(),
      generateEmbedding: false,
      tenantId: input.tenantId,
    });
    await this.trim();
    return record;
  },

  async getCurrent(agentId?: string): Promise<MemoryRecord[]> {
    return memoryStore.list({
      type: 'short_term',
      agent: agentId,
      limit: 50,
    });
  },

  async trim(): Promise<number> {
    const settings = await loadMemorySettings();
    const all = await memoryStore.list({ type: 'short_term', limit: 200 });
    if (all.length <= settings.max_short_term_items) return 0;

    // Sort by created_at ascending, soft-delete the oldest
    const sorted = all.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const toDelete = sorted.slice(0, all.length - settings.max_short_term_items);
    for (const m of toDelete) {
      await memoryStore.softDelete(m.id);
    }
    return toDelete.length;
  },

  async clear(agentId?: string): Promise<void> {
    const items = await this.getCurrent(agentId);
    for (const m of items) {
      await memoryStore.softDelete(m.id);
    }
  },
};
