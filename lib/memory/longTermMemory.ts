// Long-Term Memory — persistent memory for user preferences, project info,
// business goals, saved workflows, API configurations, and important decisions.

import { memoryStore } from './memoryStore';
import { summarizer } from './summarizer';
import { embeddingService } from './embeddingService';
import { loadMemorySettings } from './memorySettings';
import type { MemoryRecord, MemoryImportance } from './types';

export const longTermMemory = {
  async store(input: {
    title: string;
    content: string;
    tags?: string[];
    importance?: MemoryImportance;
    source?: string;
    agent?: string;
    project?: string;
    tenantId?: string | null;
  }): Promise<MemoryRecord> {
    const settings = await loadMemorySettings();

    // Auto-assess importance if not specified
    let importance = input.importance ?? 'medium';
    if (!input.importance && settings.auto_remember) {
      const assessment = await summarizer.assessImportance(input.content, input.title);
      importance = assessment.importance;
    }

    // Auto-summarize if enabled
    let summary: string | undefined;
    if (settings.auto_summarize) {
      summary = await summarizer.summarizeMemory(input.content);
    }

    const record = await memoryStore.store({
      type: 'long_term',
      title: input.title,
      content: input.content,
      summary,
      tags: input.tags ?? [],
      importance,
      source: input.source ?? 'user',
      agent: input.agent,
      project: input.project,
      generateEmbedding: true,
      tenantId: input.tenantId,
    });

    // Generate and store embedding for semantic search
    if (settings.embedding_provider) {
      try {
        await embeddingService.storeEmbedding(record.id, `${record.title} ${record.content}`);
      } catch (err) {
        console.warn('[memory] Failed to generate embedding:', err instanceof Error ? err.message : err);
      }
    }

    return record;
  },

  async get(id: string): Promise<MemoryRecord | null> {
    return memoryStore.getById(id);
  },

  async update(id: string, input: {
    title?: string;
    content?: string;
    tags?: string[];
    importance?: MemoryImportance;
  }): Promise<MemoryRecord | null> {
    return memoryStore.update(id, input);
  },

  async forget(id: string): Promise<boolean> {
    return memoryStore.softDelete(id);
  },

  async listByProject(project: string): Promise<MemoryRecord[]> {
    return memoryStore.list({ type: 'long_term', project, limit: 100 });
  },

  async listByAgent(agent: string): Promise<MemoryRecord[]> {
    return memoryStore.list({ type: 'long_term', agent, limit: 100 });
  },

  async listByTags(tags: string[]): Promise<MemoryRecord[]> {
    return memoryStore.list({ type: 'long_term', tags, limit: 100 });
  },
};
