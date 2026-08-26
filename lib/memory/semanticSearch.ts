// Semantic Search — hybrid search combining keyword and vector similarity.
// Uses the embedding service for semantic queries and falls back to keyword
// search when embeddings are unavailable.

import { memoryStore } from './memoryStore';
import { embeddingService } from './embeddingService';
import { loadMemorySettings } from './memorySettings';
import type { SearchParams, SearchResult, MemoryRecord } from './types';

export const semanticSearch = {
  async search(params: SearchParams): Promise<SearchResult[]> {
    const settings = await loadMemorySettings();
    const mode = params.mode ?? 'hybrid';
    const topK = params.topK ?? settings.top_k;
    const threshold = params.similarityThreshold ?? settings.similarity_threshold;

    if (mode === 'keyword' || mode === 'tag' || mode === 'timeline') {
      return this.keywordSearch(params, topK);
    }

    if (mode === 'semantic') {
      return this.semanticOnly(params, topK, threshold);
    }

    // Hybrid: combine keyword + semantic, deduplicate, re-rank
    const [keywordResults, semanticResults] = await Promise.all([
      this.keywordSearch(params, topK).catch(() => [] as SearchResult[]),
      this.semanticOnly(params, topK, threshold).catch(() => [] as SearchResult[]),
    ]);

    return this.mergeResults(keywordResults, semanticResults, topK);
  },

  async keywordSearch(params: SearchParams, topK: number): Promise<SearchResult[]> {
    const records = await memoryStore.keywordSearch(params.query, {
      type: params.type,
      agent: params.agent,
      limit: topK,
    });
    return records.map((memory) => ({
      memory,
      score: this.keywordScore(memory, params.query),
      matchType: 'keyword' as const,
    }));
  },

  async semanticOnly(params: SearchParams, topK: number, threshold: number): Promise<SearchResult[]> {
    const embeddingResult = await embeddingService.embed(params.query);
    const results = await memoryStore.semanticSearch(embeddingResult.vector, {
      type: params.type,
      agent: params.agent,
      topK,
      threshold,
      tenantId: params.tenantId,
    });
    return results.map((r) => ({
      memory: r.memory,
      score: r.similarity,
      matchType: 'semantic' as const,
    }));
  },

  mergeResults(keyword: SearchResult[], semantic: SearchResult[], topK: number): SearchResult[] {
    const map = new Map<string, SearchResult>();
    for (const r of keyword) {
      map.set(r.memory.id, { ...r, matchType: 'keyword' });
    }
    for (const r of semantic) {
      const existing = map.get(r.memory.id);
      if (existing) {
        // Boost score for memories found by both methods
        map.set(r.memory.id, {
          ...r,
          score: Math.min(1, existing.score + r.score * 0.5),
          matchType: 'hybrid',
        });
      } else {
        map.set(r.memory.id, r);
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  },

  keywordScore(memory: MemoryRecord, query: string): number {
    const lower = query.toLowerCase();
    const terms = lower.split(/\s+/).filter(Boolean);
    const titleMatch = terms.filter((t) => memory.title.toLowerCase().includes(t)).length;
    const contentMatch = terms.filter((t) => memory.content.toLowerCase().includes(t)).length;
    const totalTerms = terms.length || 1;
    const score = (titleMatch * 2 + contentMatch) / (totalTerms * 3);
    return Math.min(1, score * (memory.importanceScore / 100));
  },
};
