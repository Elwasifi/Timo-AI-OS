// Supabase Provider Implementations — concrete implementations of the
// provider interfaces backed by Supabase. These are the ONLY modules that
// import the Supabase client. The Knowledge Engine imports only the
// interfaces, never these directly.

import { supabase } from '@/lib/supabase/client';
import type {
  IStructuredProvider, ISemanticProvider, IGraphProvider, ITimelineProvider,
} from './providers';
import type { StructuredFact, FactCategory, QueryParams } from './types';
import type {
  MemoryRecord, StoreMemoryInput, UpdateMemoryInput, SearchResult,
  SearchParams, MemoryLink, LinkType, EpisodicEvent, MemoryImportance,
} from '@/lib/memory/types';
import { memoryStore } from '@/lib/memory/memoryStore';
import { semanticSearch } from '@/lib/memory/semanticSearch';
import { episodicMemory } from '@/lib/memory/episodicMemory';
import { knowledgeGraph } from '@/lib/memory/knowledgeGraph';
import { embeddingService } from '@/lib/memory/embeddingService';
import { loadMemorySettings } from '@/lib/memory/memorySettings';

// ---- Structured Provider (Supabase) ----
export const supabaseStructuredProvider: IStructuredProvider = {
  async upsert(input) {
    const { data, error } = await supabase.rpc('upsert_structured_fact', {
      p_subject: input.subject,
      p_predicate: input.predicate,
      p_object: input.object,
      p_category: input.category,
      p_confidence: input.confidence,
      p_confidence_source: input.confidenceSource,
      p_confidence_reason: input.confidenceReason ?? null,
      p_importance: input.importance ?? 'high',
      p_tags: input.tags ?? [],
      p_semantic_memory_id: input.semanticMemoryId ?? null,
      p_metadata: input.metadata ?? {},
    });
    if (error) throw new Error(`Structured upsert failed: ${error.message}`);
    const row = Array.isArray(data) ? data[0] : data;
    return {
      action: row.action as 'created' | 'duplicate' | 'conflict',
      factId: row.fact_id as string,
      conflict: row.conflict as boolean,
      oldValue: row.old_value as string | null,
      oldFactId: row.old_fact_id as string | null,
    };
  },

  async replace(oldFactId, newValue, reason, newConfidence) {
    const { data, error } = await supabase.rpc('replace_structured_fact', {
      p_old_fact_id: oldFactId,
      p_new_object: newValue,
      p_reason: reason ?? null,
      p_new_confidence: newConfidence ?? null,
    });
    if (error) throw new Error(`Fact replacement failed: ${error.message}`);
    const row = Array.isArray(data) ? data[0] : data;
    return {
      newFactId: row.new_fact_id as string,
      newVersion: row.new_version as number,
    };
  },

  async query(params: QueryParams): Promise<StructuredFact[]> {
    const { data, error } = await supabase.rpc('match_structured_facts', {
      p_subject: params.subject ?? null,
      p_predicate: params.predicate ?? null,
      p_categories: params.categories ?? null,
      p_search_text: params.searchText ?? null,
      p_limit: params.limit ?? 20,
    });
    if (error) throw new Error(`Structured query failed: ${error.message}`);
    return (data as Record<string, unknown>[]).map(mapStructuredFactRow);
  },

  async getHistory(subject, predicate): Promise<StructuredFact[]> {
    const { data, error } = await supabase.rpc('get_fact_history', {
      p_subject: subject,
      p_predicate: predicate,
    });
    if (error) throw new Error(`Fact history failed: ${error.message}`);
    return (data as Record<string, unknown>[]).map(mapStructuredFactRow);
  },

  async update(factId, newValue, newConfidence, reason): Promise<StructuredFact | null> {
    // Use replace if we have a new value, otherwise just update confidence
    if (newValue !== undefined) {
      const result = await this.replace(factId, newValue, reason, newConfidence);
      const facts = await this.query({ searchText: result.newFactId, limit: 1 });
      return facts[0] ?? null;
    }
    if (newConfidence !== undefined) {
      const { data, error } = await supabase
        .from('structured_facts')
        .update({ confidence: newConfidence })
        .eq('id', factId)
        .select('*')
        .maybeSingle();
      if (error) throw new Error(`Fact update failed: ${error.message}`);
      return data ? mapStructuredFactRow(data as Record<string, unknown>) : null;
    }
    return null;
  },

  async softDelete(factId): Promise<boolean> {
    const { error } = await supabase
      .from('structured_facts')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', factId);
    if (error) throw new Error(`Fact soft delete failed: ${error.message}`);
    return true;
  },

  async permanentDelete(factId): Promise<boolean> {
    const { error } = await supabase
      .from('structured_facts')
      .delete()
      .eq('id', factId);
    if (error) throw new Error(`Fact permanent delete failed: ${error.message}`);
    return true;
  },
};

// ---- Semantic Provider (delegates to existing memory modules) ----
export const supabaseSemanticProvider: ISemanticProvider = {
  async store(input: StoreMemoryInput): Promise<MemoryRecord> {
    const record = await memoryStore.store(input);
    // Live E2E verification (2026-08-20) found "remember" requests — the
    // primary entry point into this provider, via lib/context/memory-decision.ts
    // → knowledge.store() — created a real memory row but never generated
    // an embedding, unlike lib/memory/longTermMemory.ts's direct store path.
    // No vector meant semantic search could never surface these memories.
    // Mirrors longTermMemory.store()'s exact pattern: settings-gated,
    // non-fatal on failure.
    try {
      const settings = await loadMemorySettings();
      if (settings.embedding_provider) {
        await embeddingService.storeEmbedding(record.id, `${record.title} ${record.content}`);
      }
    } catch (err) {
      console.warn('[knowledge] Failed to generate embedding:', err instanceof Error ? err.message : err);
    }
    return record;
  },
  async search(params: SearchParams): Promise<SearchResult[]> {
    return semanticSearch.search(params);
  },
  async recall(id: string): Promise<MemoryRecord | null> {
    return memoryStore.getById(id);
  },
  async update(id: string, input: UpdateMemoryInput): Promise<MemoryRecord | null> {
    return memoryStore.update(id, input);
  },
  async softDelete(id: string): Promise<boolean> {
    return memoryStore.softDelete(id);
  },
  async permanentDelete(id: string): Promise<boolean> {
    return memoryStore.permanentDelete(id);
  },
  async list(opts): Promise<MemoryRecord[]> {
    return memoryStore.list({
      type: opts?.type as 'short_term' | 'long_term' | 'episodic' | 'semantic' | undefined,
      agent: opts?.agent,
      tags: opts?.tags,
      limit: opts?.limit,
    });
  },
};

// ---- Graph Provider (delegates to existing knowledgeGraph) ----
export const supabaseGraphProvider: IGraphProvider = {
  async link(input) {
    return knowledgeGraph.link(input);
  },
  async unlink(sourceId, targetId) {
    return knowledgeGraph.unlink(sourceId, targetId);
  },
  async getLinks(memoryId) {
    return knowledgeGraph.getLinks(memoryId);
  },
  async getNeighbors(memoryId, depth) {
    return knowledgeGraph.getNeighbors(memoryId, depth);
  },
};

// ---- Timeline Provider (delegates to existing episodicMemory) ----
export const supabaseTimelineProvider: ITimelineProvider = {
  async timeline(opts) {
    return episodicMemory.timeline(opts);
  },
  async recordEvent(input) {
    return episodicMemory.recordWithMemory(input);
  },
};

// ---- Row mapper ----
function mapStructuredFactRow(row: Record<string, unknown>): StructuredFact {
  return {
    id: row.id as string,
    subject: row.subject as string,
    predicate: row.predicate as string,
    object: row.object as string,
    category: row.category as FactCategory,
    confidence: row.confidence as number,
    confidenceSource: row.confidence_source as string,
    confidenceReason: row.confidence_reason as string | null,
    verified: row.verified as boolean,
    importance: row.importance as MemoryImportance,
    tags: row.tags as string[],
    semanticMemoryId: row.semantic_memory_id as string | null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    supersededBy: row.superseded_by as string | null,
    version: row.version as number,
    previousVersionId: row.previous_version_id as string | null,
    deletedAt: row.deleted_at as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
