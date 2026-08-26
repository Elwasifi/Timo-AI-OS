// Retrieval Service — the RAG engine. Before every AI response, this module
// retrieves relevant memories, workflows, conversations, and context to
// inject into the prompt. It only injects relevant context — never everything.

import { semanticSearch } from './semanticSearch';
import { memoryStore } from './memoryStore';
import { loadMemorySettings } from './memorySettings';
import type { RAGContext, SearchResult, SearchParams } from './types';

export interface RetrievalOptions {
  agentId?: string;
  project?: string;
  topK?: number;
  similarityThreshold?: number;
  tenantId?: string | null;
}

export const retrievalService = {
  async retrieve(query: string, opts?: RetrievalOptions): Promise<RAGContext> {
    const settings = await loadMemorySettings();
    const topK = opts?.topK ?? settings.top_k;
    const threshold = opts?.similarityThreshold ?? settings.similarity_threshold;

    const params: SearchParams = {
      query,
      mode: 'hybrid',
      topK,
      similarityThreshold: threshold,
      agent: opts?.agentId,
      project: opts?.project,
      tenantId: opts?.tenantId,
    };

    try {
      const results = await semanticSearch.search(params);
      const summary = this.buildContextSummary(results, query);
      return {
        memories: results,
        summary,
        totalFound: results.length,
        injected: results.length > 0,
      };
    } catch {
      // If semantic search fails (e.g. no embeddings), fall back to keyword
      try {
        const results = await semanticSearch.keywordSearch(params, topK);
        const summary = this.buildContextSummary(results, query);
        return {
          memories: results,
          summary,
          totalFound: results.length,
          injected: results.length > 0,
        };
      } catch {
        return { memories: [], summary: '', totalFound: 0, injected: false };
      }
    }
  },

  buildContextSummary(results: SearchResult[], query: string): string {
    if (results.length === 0) return '';

    const lines: string[] = ['--- Relevant Memory Context ---'];
    for (const r of results.slice(0, 5)) {
      const m = r.memory;
      const importance = m.importance !== 'medium' ? `[${m.importance.toUpperCase()}] ` : '';
      const tags = m.tags.length > 0 ? ` #${m.tags.join(' #')}` : '';
      lines.push(`${importance}${m.title}${tags}`);
      lines.push(m.content.slice(0, 200));
      if (m.summary) lines.push(`Summary: ${m.summary}`);
      lines.push('');
    }
    lines.push('--- End Memory Context ---');
    return lines.join('\n');
  },

  async buildSystemPromptContext(query: string, opts?: RetrievalOptions): Promise<string> {
    const context = await this.retrieve(query, opts);
    return context.injected ? context.summary : '';
  },
};
