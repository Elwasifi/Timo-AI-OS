// Memory Store — the Supabase CRUD layer for memories.
// This is the ONLY module that touches the database directly. All other
// memory modules go through the public memoryService API or this store.

import { supabase } from '@/lib/supabase/client';
import type {
  MemoryRecord, StoreMemoryInput, UpdateMemoryInput,
  MemoryType, MemoryImportance,
} from './types';
import { IMPORTANCE_SCORES } from './types';

const TABLE = 'memories';

// memories.tenant_id is NOT NULL (see supabase/migrations/20260819140000).
// Callers with a real tenant in scope (e.g. the tool executor, which knows
// the mission's tenant) should pass StoreMemoryInput.tenantId explicitly —
// this is only the last-resort fallback for paths that don't have one
// threaded through yet, mirroring the same fallback constant already used
// in lib/governance/entitlements.ts and the chat/mission entry points.
const INTERNAL_TENANT_ID = '00000000-0000-0000-0000-000000000001';

function toRow(input: StoreMemoryInput): Record<string, unknown> {
  const importance = input.importance ?? 'medium';
  return {
    type: input.type ?? 'long_term',
    title: input.title,
    content: input.content,
    summary: input.summary ?? null,
    tags: input.tags ?? [],
    importance,
    importance_score: IMPORTANCE_SCORES[importance],
    source: input.source ?? null,
    agent: input.agent ?? null,
    tool: input.tool ?? null,
    project: input.project ?? null,
    metadata: input.metadata ?? {},
    expires_at: input.expiresAt ?? null,
    tenant_id: input.tenantId ?? INTERNAL_TENANT_ID,
  };
}

function mapRow(row: Record<string, unknown>): MemoryRecord {
  return {
    id: row.id as string,
    type: row.type as MemoryType,
    title: row.title as string,
    content: row.content as string,
    summary: row.summary as string | null,
    tags: (row.tags as string[]) ?? [],
    importance: row.importance as MemoryImportance,
    importanceScore: row.importance_score as number,
    source: row.source as string | null,
    agent: row.agent as string | null,
    tool: row.tool as string | null,
    project: row.project as string | null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    expiresAt: row.expires_at as string | null,
    deletedAt: row.deleted_at as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export const memoryStore = {
  async store(input: StoreMemoryInput): Promise<MemoryRecord> {
    const { data, error } = await supabase
      .from(TABLE)
      .insert(toRow(input))
      .select()
      .single();
    if (error) throw new Error(`Memory store failed: ${error.message}`);
    return mapRow(data as Record<string, unknown>);
  },

  async getById(id: string): Promise<MemoryRecord | null> {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw new Error(`Memory get failed: ${error.message}`);
    return data ? mapRow(data as Record<string, unknown>) : null;
  },

  async update(id: string, input: UpdateMemoryInput): Promise<MemoryRecord | null> {
    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.content !== undefined) patch.content = input.content;
    if (input.summary !== undefined) patch.summary = input.summary;
    if (input.tags !== undefined) patch.tags = input.tags;
    if (input.importance !== undefined) {
      patch.importance = input.importance;
      patch.importance_score = IMPORTANCE_SCORES[input.importance];
    }
    if (input.importanceScore !== undefined) patch.importance_score = input.importanceScore;
    if (input.metadata !== undefined) patch.metadata = input.metadata;
    if (input.expiresAt !== undefined) patch.expires_at = input.expiresAt;

    const { data, error } = await supabase
      .from(TABLE)
      .update(patch)
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throw new Error(`Memory update failed: ${error.message}`);
    return data ? mapRow(data as Record<string, unknown>) : null;
  },

  async softDelete(id: string): Promise<boolean> {
    const { error } = await supabase
      .from(TABLE)
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(`Memory soft delete failed: ${error.message}`);
    return true;
  },

  async permanentDelete(id: string): Promise<boolean> {
    const { error } = await supabase
      .from(TABLE)
      .delete()
      .eq('id', id);
    if (error) throw new Error(`Memory permanent delete failed: ${error.message}`);
    return true;
  },

  async list(opts?: {
    type?: MemoryType;
    agent?: string;
    project?: string;
    tags?: string[];
    includeDeleted?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<MemoryRecord[]> {
    let q = supabase.from(TABLE).select('*');
    if (opts?.type) q = q.eq('type', opts.type);
    if (opts?.agent) q = q.eq('agent', opts.agent);
    if (opts?.project) q = q.eq('project', opts.project);
    if (opts?.tags && opts.tags.length > 0) q = q.overlaps('tags', opts.tags);
    if (!opts?.includeDeleted) q = q.is('deleted_at', null);
    q = q.order('created_at', { ascending: false });
    if (opts?.limit) q = q.limit(opts.limit);
    if (opts?.offset) q = q.range(opts.offset, (opts.offset ?? 0) + (opts.limit ?? 50) - 1);
    const { data, error } = await q;
    if (error) throw new Error(`Memory list failed: ${error.message}`);
    return (data as Record<string, unknown>[]).map(mapRow);
  },

  async keywordSearch(query: string, opts?: {
    type?: MemoryType;
    agent?: string;
    limit?: number;
  }): Promise<MemoryRecord[]> {
    // Tokenize the query: split into meaningful terms, remove stopwords, and
    // search for each term individually instead of the full query as a single
    // substring. The old approach used `title.ilike.%${query}%` which never
    // matched because the entire 30-character query was never a substring of
    // the stored content.
    const stopwords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'what', 'which', 'who',
      'where', 'when', 'why', 'how', 'do', 'does', 'did', 'can', 'could',
      'would', 'will', 'my', 'your', 'our', 'i', 'you', 'we', 'me', 'us',
      'tell', 'show', 'list', 'get', 'please', 'of', 'in', 'on', 'at', 'to',
      'for', 'with', 'and', 'or', 'not', 'this', 'that', 'it', 'be',
    ]);
    const terms = query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2 && !stopwords.has(t));

    if (terms.length === 0) return [];

    // Build OR conditions for each term across both title and content
    const orParts: string[] = [];
    for (const term of terms) {
      orParts.push(`title.ilike.%${term}%`);
      orParts.push(`content.ilike.%${term}%`);
    }
    const orFilter = orParts.join(',');

    let q = supabase
      .from(TABLE)
      .select('*')
      .or(orFilter)
      .is('deleted_at', null);
    if (opts?.type) q = q.eq('type', opts.type);
    if (opts?.agent) q = q.eq('agent', opts.agent);
    q = q.order('importance_score', { ascending: false }).limit(opts?.limit ?? 10);
    const { data, error } = await q;
    if (error) throw new Error(`Keyword search failed: ${error.message}`);
    return (data as Record<string, unknown>[]).map(mapRow);
  },

  async semanticSearch(embedding: number[], opts?: {
    type?: MemoryType;
    agent?: string;
    topK?: number;
    threshold?: number;
    tenantId?: string | null;
  }): Promise<Array<{ memory: MemoryRecord; similarity: number }>> {
    // match_memories() is SECURITY DEFINER and requires an explicit tenant
    // filter — see supabase/migrations/20260820110000_fix_match_memories_tenant_leak.sql.
    // No caller may omit this; the internal-tenant fallback keeps existing
    // untenanted callers working rather than throwing.
    const { data, error } = await supabase.rpc('match_memories', {
      query_embedding: embedding,
      filter_tenant_id: opts?.tenantId ?? INTERNAL_TENANT_ID,
      match_count: opts?.topK ?? 5,
      filter_type: opts?.type ?? null,
      filter_agent: opts?.agent ?? null,
      threshold: opts?.threshold ?? 0.7,
    });
    if (error) throw new Error(`Semantic search failed: ${error.message}`);
    return ((data as Array<Record<string, unknown>>) ?? []).map((row) => ({
      memory: mapRow(row),
      similarity: row.similarity as number,
    }));
  },

  async countByType(): Promise<Record<MemoryType, number>> {
    const { data, error } = await supabase
      .from(TABLE)
      .select('type')
      .is('deleted_at', null);
    if (error) return { short_term: 0, long_term: 0, episodic: 0, semantic: 0 };
    const counts = { short_term: 0, long_term: 0, episodic: 0, semantic: 0 };
    for (const row of data as Array<{ type: MemoryType }>) {
      counts[row.type]++;
    }
    return counts;
  },

  async exportAll(): Promise<MemoryRecord[]> {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw new Error(`Memory export failed: ${error.message}`);
    return (data as Record<string, unknown>[]).map(mapRow);
  },

  async importBatch(records: StoreMemoryInput[]): Promise<number> {
    const rows = records.map(toRow);
    const { error } = await supabase.from(TABLE).insert(rows);
    if (error) throw new Error(`Memory import failed: ${error.message}`);
    return rows.length;
  },
};
