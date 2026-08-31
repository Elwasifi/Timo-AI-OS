// Knowledge Engine — shared types.
// These types are the contract between the public API and all internal
// modules. No type here references a specific storage backend.

import type { MemoryImportance, LinkType } from '@/lib/memory/types';

export type FactCategory =
  | 'preference' | 'identity' | 'project' | 'configuration' | 'environment'
  | 'workflow' | 'habit' | 'decision' | 'rule' | 'goal' | 'relationship'
  | 'task' | 'fact' | 'history' | 'temporary';

export interface StructuredFact {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  category: FactCategory;
  confidence: number;
  confidenceSource: string;
  confidenceReason: string | null;
  verified: boolean;
  importance: MemoryImportance;
  tags: string[];
  semanticMemoryId: string | null;
  metadata: Record<string, unknown>;
  supersededBy: string | null;
  version: number;
  previousVersionId: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExtractedFact {
  subject: string;
  predicate: string;
  object: string;
  category: FactCategory;
  confidence: number;
  confidenceSource: string;
  confidenceReason: string;
  cleanedStatement: string;
}

export interface StoreResult {
  action: 'created' | 'updated' | 'duplicate' | 'conflict';
  facts: StructuredFact[];
  conflicts: ConflictInfo[];
  semanticMemoryId: string | null;
}

export interface ConflictInfo {
  oldFactId: string;
  subject: string;
  predicate: string;
  oldValue: string;
  newValue: string;
  category: FactCategory;
  resolutionPrompt: string;
}

export type AnswerSource =
  | 'structured' | 'cache' | 'semantic' | 'graph'
  | 'timeline' | 'rag' | 'tool' | 'llm' | 'not_found';

export interface AnswerResult {
  answer: string;
  source: AnswerSource;
  confidence: number;
  facts: StructuredFact[];
  memories: import('@/lib/memory/types').SearchResult[];
  path: string[];
  conflict?: ConflictInfo;
  explanation: AnswerExplanation;
}

export interface AnswerExplanation {
  providersQueried: string[];
  retrievalPath: string[];
  provider: string;
  queryPlan: string;
  totalResults: number;
  elapsedMs: number;
}

export interface ResolveResult {
  action: 'replaced' | 'kept_old' | 'kept_both';
  fact: StructuredFact | null;
}

export interface QueryParams {
  tenantId: string;
  subject?: string;
  predicate?: string;
  categories?: FactCategory[];
  searchText?: string;
  limit?: number;
}

export interface SearchParams {
  query: string;
  mode?: 'keyword' | 'semantic' | 'hybrid';
  agent?: string;
  topK?: number;
  tenantId?: string | null;
}

export interface StoreParams {
  text: string;
  agent?: string;
  source?: string;
  force?: boolean;
  tenantId?: string | null;
}

export interface LearnParams {
  subject: string;
  predicate: string;
  object: string;
  category: FactCategory;
  confidence: number;
  reason: string;
  tenantId?: string | null;
}

export interface UpdateParams {
  factId: string;
  newValue?: string;
  newConfidence?: number;
  reason?: string;
  tenantId?: string | null;
}

export interface DeleteParams {
  factId: string;
  permanent?: boolean;
}

export interface LinkParams {
  sourceId: string;
  targetId: string;
  linkType?: LinkType;
  metadata?: Record<string, unknown>;
}

export interface TimelineParams {
  agent?: string;
  eventType?: string;
  limit?: number;
}

// ---- Knowledge Events ----
export type KnowledgeEventType =
  | 'knowledge.stored'
  | 'knowledge.updated'
  | 'knowledge.deleted'
  | 'knowledge.conflict'
  | 'knowledge.linked';

export interface KnowledgeEvent {
  type: KnowledgeEventType;
  factId?: string;
  subject?: string;
  predicate?: string;
  object?: string;
  category?: FactCategory;
  conflict?: ConflictInfo;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export type KnowledgeEventListener = (event: KnowledgeEvent) => void;
