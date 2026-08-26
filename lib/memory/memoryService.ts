// Memory Service — backward-compatible adapter.
// All existing imports of `memory` continue to work. Internally, store and
// search now delegate to the Knowledge Engine, which orchestrates structured
// knowledge, semantic memory, graph, and timeline providers.
//
// This file is the bridge between the old `memory` API and the new
// `knowledge` API. It exists so that existing modules (crew-coordinator,
// memory-decision, context-manager, tools) don't need to change their
// imports. New modules should import `knowledge` directly.

import { knowledge } from '@/lib/knowledge/engine';
import { memoryStore } from './memoryStore';
import { semanticSearch } from './semanticSearch';
import { retrievalService } from './retrievalService';
import { summarizer } from './summarizer';
import { shortTermMemory } from './shortTermMemory';
import { longTermMemory } from './longTermMemory';
import { episodicMemory } from './episodicMemory';
import { embeddingService } from './embeddingService';
import { loadMemorySettings } from './memorySettings';
import type {
  MemoryRecord, StoreMemoryInput, UpdateMemoryInput,
  SearchParams, SearchResult, RAGContext, MemoryLink,
  EpisodicEvent, LinkType,
} from './types';

export const memory = {
  // ---- Core CRUD ----
  // store() now delegates to the Knowledge Engine, which extracts structured
  // facts and stores both structured + semantic. Short-term and episodic
  // memories still go through their original handlers.
  async store(input: StoreMemoryInput): Promise<MemoryRecord> {
    if (input.type === 'short_term') {
      return shortTermMemory.add({
        title: input.title,
        content: input.content,
        agent: input.agent,
        tool: input.tool,
        project: input.project,
        tags: input.tags,
        tenantId: input.tenantId,
      });
    }

    // For long_term and default: delegate to Knowledge Engine
    if (input.type === 'long_term' || !input.type) {
      try {
        const result = await knowledge.store({
          text: input.content,
          source: input.source ?? 'user',
          agent: input.agent,
          tenantId: input.tenantId,
        });

        // If the Knowledge Engine created a semantic memory, return it
        if (result.semanticMemoryId) {
          const mem = await knowledge.recall(result.semanticMemoryId);
          if (mem) return mem;
        }
      } catch {
        // Fall through to direct long-term store if Knowledge Engine fails
      }

      // Fallback: direct long-term store (preserves original behavior)
      return longTermMemory.store({
        title: input.title,
        content: input.content,
        tags: input.tags,
        importance: input.importance,
        source: input.source,
        agent: input.agent,
        project: input.project,
        tenantId: input.tenantId,
      });
    }

    // Episodic and semantic go through the base store
    return memoryStore.store(input);
  },

  async recall(id: string): Promise<MemoryRecord | null> {
    return knowledge.recall(id);
  },

  async search(params: SearchParams): Promise<SearchResult[]> {
    // Knowledge Engine search supports keyword/semantic/hybrid modes.
    // Timeline and tag modes fall back to the semantic provider directly.
    if (params.mode === 'timeline' || params.mode === 'tag') {
      return semanticSearch.search(params);
    }
    return knowledge.search({
      query: params.query,
      mode: params.mode === 'keyword' ? 'keyword' : params.mode === 'semantic' ? 'semantic' : 'hybrid',
      agent: params.agent,
      topK: params.topK,
      tenantId: params.tenantId,
    });
  },

  async update(id: string, input: UpdateMemoryInput): Promise<MemoryRecord | null> {
    return memoryStore.update(id, input);
  },

  async forget(id: string, permanent = false): Promise<boolean> {
    return permanent ? memoryStore.permanentDelete(id) : memoryStore.softDelete(id);
  },

  // ---- Summarization ----
  async summarize(id: string): Promise<MemoryRecord | null> {
    const record = await memoryStore.getById(id);
    if (!record) return null;
    const summary = await summarizer.summarizeMemory(record.content);
    return memoryStore.update(id, { summary });
  },

  async summarizeAll(): Promise<number> {
    const all = await memoryStore.list({ limit: 200 });
    let count = 0;
    for (const m of all) {
      if (!m.summary) {
        const summary = await summarizer.summarizeMemory(m.content);
        if (summary) {
          await memoryStore.update(m.id, { summary });
          count++;
        }
      }
    }
    return count;
  },

  // ---- Knowledge Graph ----
  async link(sourceId: string, targetId: string, linkType?: LinkType): Promise<MemoryLink> {
    return knowledge.link({ sourceId, targetId, linkType });
  },

  async unlink(sourceId: string, targetId: string): Promise<boolean> {
    const { knowledgeGraph } = await import('./knowledgeGraph');
    return knowledgeGraph.unlink(sourceId, targetId);
  },

  async similar(id: string, topK?: number): Promise<SearchResult[]> {
    const record = await memoryStore.getById(id);
    if (!record) return [];
    return semanticSearch.search({
      query: `${record.title} ${record.content}`,
      mode: 'semantic',
      topK: topK ?? 5,
    });
  },

  // ---- Timeline ----
  async list(opts?: { type?: string; agent?: string; project?: string; tags?: string[]; limit?: number }): Promise<MemoryRecord[]> {
    return memoryStore.list({
      type: opts?.type as 'short_term' | 'long_term' | 'episodic' | 'semantic' | undefined,
      agent: opts?.agent,
      project: opts?.project,
      tags: opts?.tags,
      limit: opts?.limit,
    });
  },

  async timeline(opts?: { agent?: string; project?: string; eventType?: string; limit?: number }): Promise<EpisodicEvent[]> {
    return knowledge.timeline(opts);
  },

  async recordEvent(input: {
    eventType: string;
    eventTitle: string;
    eventDetail?: string;
    content?: string;
    agent?: string;
    project?: string;
    severity?: 'info' | 'warning' | 'error' | 'success';
    tags?: string[];
    tenantId?: string | null;
  }): Promise<{ memory: MemoryRecord; event: EpisodicEvent }> {
    return episodicMemory.recordWithMemory(input);
  },

  // ---- RAG ----
  async retrieveContext(query: string, opts?: { agentId?: string; project?: string; tenantId?: string | null }): Promise<RAGContext> {
    return retrievalService.retrieve(query, opts);
  },

  async buildRagPrompt(query: string, opts?: { agentId?: string; project?: string; tenantId?: string | null }): Promise<string> {
    return retrievalService.buildSystemPromptContext(query, opts);
  },

  // ---- Auto Memory ----
  async autoRemember(input: {
    title: string;
    content: string;
    agent?: string;
    project?: string;
    source?: string;
    tags?: string[];
    tenantId?: string | null;
  }): Promise<MemoryRecord | null> {
    const settings = await loadMemorySettings();
    if (!settings.auto_remember) return null;

    const should = await summarizer.shouldRemember(input.content, input.title);
    if (!should) return null;

    return longTermMemory.store({
      title: input.title,
      content: input.content,
      tags: input.tags,
      source: input.source ?? 'auto',
      agent: input.agent,
      project: input.project,
      tenantId: input.tenantId,
    });
  },

  // ---- Import / Export ----
  async exportMemories(): Promise<MemoryRecord[]> {
    return memoryStore.exportAll();
  },

  async importMemories(records: StoreMemoryInput[]): Promise<number> {
    return memoryStore.importBatch(records);
  },

  // ---- Settings ----
  async getSettings() {
    return loadMemorySettings();
  },

  // ---- Embeddings ----
  async embed(text: string) {
    return embeddingService.embed(text);
  },

  // ---- Stats ----
  // M2-01: total/byType are now real per-tenant numbers when tenantId is
  // passed (memoryStore.list()/countByType() filter on memories.tenant_id).
  // embeddings/links/events remain global raw counts — those tables have no
  // tenant_id of their own (they key off memory_id, not memories directly),
  // and a fully correct per-tenant count would need a join through
  // memories; left as a known, documented partial limitation rather than
  // silently claimed as scoped.
  async stats(tenantId?: string | null): Promise<{
    total: number;
    byType: Record<string, number>;
    embeddings: number;
    links: number;
    events: number;
  }> {
    const [memories, byType, embeddings, links, events] = await Promise.all([
      memoryStore.list({ limit: 10000, tenantId }),
      memoryStore.countByType(tenantId),
      supabaseCount('memory_embeddings'),
      supabaseCount('memory_links'),
      supabaseCount('memory_events'),
    ]);
    return {
      total: memories.length,
      byType,
      embeddings,
      links,
      events,
    };
  },
};

async function supabaseCount(table: string): Promise<number> {
  const { supabase } = await import('@/lib/supabase/client');
  const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
  if (error) return 0;
  return count ?? 0;
}
