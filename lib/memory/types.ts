// Memory Engine — shared types.
// Provider-agnostic, plugin-ready. No dependencies on n8n, specific AI
// providers, or agent implementations. Everything communicates through
// interfaces defined here.

export type MemoryType = 'short_term' | 'long_term' | 'episodic' | 'semantic';

export type MemoryImportance = 'critical' | 'high' | 'medium' | 'low' | 'temporary';

export type LinkType = 'relates_to' | 'caused_by' | 'part_of' | 'derived_from' | 'replaced_by' | 'supports' | 'contradicts';

export type SearchMode = 'keyword' | 'semantic' | 'hybrid' | 'tag' | 'timeline';

export type EmbeddingProvider = 'gemini' | 'openrouter' | 'nvidia' | 'ollama' | 'openai';

export interface MemoryRecord {
  id: string;
  type: MemoryType;
  title: string;
  content: string;
  summary: string | null;
  tags: string[];
  importance: MemoryImportance;
  importanceScore: number;
  source: string | null;
  agent: string | null;
  tool: string | null;
  project: string | null;
  metadata: Record<string, unknown>;
  expiresAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoreMemoryInput {
  type?: MemoryType;
  title: string;
  content: string;
  summary?: string;
  tags?: string[];
  importance?: MemoryImportance;
  source?: string;
  agent?: string;
  tool?: string;
  project?: string;
  metadata?: Record<string, unknown>;
  expiresAt?: string | null;
  generateEmbedding?: boolean;
  /** Falls back to the internal tenant (see lib/memory/memoryStore.ts) when omitted — memories.tenant_id is NOT NULL. */
  tenantId?: string | null;
}

export interface UpdateMemoryInput {
  title?: string;
  content?: string;
  summary?: string;
  tags?: string[];
  importance?: MemoryImportance;
  importanceScore?: number;
  metadata?: Record<string, unknown>;
  expiresAt?: string | null;
  regenerateEmbedding?: boolean;
}

export interface SearchResult {
  memory: MemoryRecord;
  score: number;
  matchType: 'keyword' | 'semantic' | 'tag' | 'hybrid';
  highlightedContent?: string;
}

export interface SearchParams {
  query: string;
  mode?: SearchMode;
  type?: MemoryType;
  agent?: string;
  project?: string;
  tags?: string[];
  topK?: number;
  similarityThreshold?: number;
  includeExpired?: boolean;
  /** Falls back to the internal tenant (see lib/memory/memoryStore.ts) when omitted. */
  tenantId?: string | null;
}

export interface MemoryLink {
  id: string;
  sourceId: string;
  targetId: string;
  linkType: LinkType;
  weight: number;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface EpisodicEvent {
  id: string;
  memoryId: string | null;
  eventType: string;
  eventTitle: string;
  eventDetail: string | null;
  agent: string | null;
  project: string | null;
  severity: 'info' | 'warning' | 'error' | 'success';
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface MemorySettings {
  id: number;
  embedding_provider: string;
  embedding_model: string;
  chunk_size: number;
  chunk_overlap: number;
  top_k: number;
  similarity_threshold: number;
  auto_remember: boolean;
  auto_summarize: boolean;
  memory_expiration_days: number;
  max_short_term_items: number;
}

export interface RAGContext {
  memories: SearchResult[];
  summary: string;
  totalFound: number;
  injected: boolean;
}

export interface EmbeddingResult {
  vector: number[];
  provider: string;
  model: string;
  dimensions: number;
}

export interface EmbeddingProviderAdapter {
  id: EmbeddingProvider;
  embed(texts: string[]): Promise<number[][]>;
  dimensions: number;
  model: string;
}

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
  id: 1,
  embedding_provider: 'gemini',
  embedding_model: 'gemini-embedding-001',
  chunk_size: 512,
  chunk_overlap: 50,
  top_k: 5,
  similarity_threshold: 0.7,
  auto_remember: true,
  auto_summarize: true,
  memory_expiration_days: 30,
  max_short_term_items: 20,
};

export const IMPORTANCE_SCORES: Record<MemoryImportance, number> = {
  critical: 100,
  high: 80,
  medium: 50,
  low: 25,
  temporary: 10,
};

export const IMPORTANCE_FROM_SCORE = (score: number): MemoryImportance => {
  if (score >= 90) return 'critical';
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  if (score >= 20) return 'low';
  return 'temporary';
};
