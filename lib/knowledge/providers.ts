// Provider interfaces — the internal abstraction layer.
// The Knowledge Engine orchestrates these providers. Each provider owns a
// specific storage concern. The engine never knows which database or
// technology backs a provider — only the interface contract.

import type {
  StructuredFact, FactCategory, QueryParams,
} from './types';
import type {
  SearchResult, SearchParams, MemoryRecord,
  MemoryLink, LinkType, EpisodicEvent,
} from '@/lib/memory/types';

// ---- Structured Knowledge Provider ----
export interface IStructuredProvider {
  upsert(input: {
    subject: string;
    predicate: string;
    object: string;
    category: FactCategory;
    confidence: number;
    confidenceSource: string;
    confidenceReason?: string;
    importance?: import('@/lib/memory/types').MemoryImportance;
    tags?: string[];
    semanticMemoryId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{
    action: 'created' | 'duplicate' | 'conflict';
    factId: string;
    conflict: boolean;
    oldValue: string | null;
    oldFactId: string | null;
  }>;

  replace(oldFactId: string, newValue: string, reason?: string, newConfidence?: number): Promise<{
    newFactId: string;
    newVersion: number;
  }>;

  query(params: QueryParams): Promise<StructuredFact[]>;

  getHistory(subject: string, predicate: string): Promise<StructuredFact[]>;

  update(factId: string, newValue?: string, newConfidence?: number, reason?: string): Promise<StructuredFact | null>;

  softDelete(factId: string): Promise<boolean>;
  permanentDelete(factId: string): Promise<boolean>;
}

// ---- Semantic Memory Provider ----
export interface ISemanticProvider {
  store(input: import('@/lib/memory/types').StoreMemoryInput): Promise<MemoryRecord>;
  search(params: SearchParams): Promise<SearchResult[]>;
  recall(id: string): Promise<MemoryRecord | null>;
  update(id: string, input: import('@/lib/memory/types').UpdateMemoryInput): Promise<MemoryRecord | null>;
  softDelete(id: string): Promise<boolean>;
  permanentDelete(id: string): Promise<boolean>;
  list(opts?: { type?: string; agent?: string; tags?: string[]; limit?: number }): Promise<MemoryRecord[]>;
}

// ---- Knowledge Graph Provider ----
export interface IGraphProvider {
  link(input: {
    sourceId: string;
    targetId: string;
    linkType?: LinkType;
    weight?: number;
    metadata?: Record<string, unknown>;
  }): Promise<MemoryLink>;
  unlink(sourceId: string, targetId: string): Promise<boolean>;
  getLinks(memoryId: string): Promise<MemoryLink[]>;
  getNeighbors(memoryId: string, depth?: number): Promise<string[]>;
}

// ---- Timeline Provider ----
export interface ITimelineProvider {
  timeline(opts?: { agent?: string; eventType?: string; limit?: number }): Promise<EpisodicEvent[]>;
  recordEvent(input: {
    eventType: string;
    eventTitle: string;
    eventDetail?: string;
    content?: string;
    agent?: string;
    project?: string;
    severity?: 'info' | 'warning' | 'error' | 'success';
    tags?: string[];
  }): Promise<{ memory: MemoryRecord; event: EpisodicEvent }>;
}
