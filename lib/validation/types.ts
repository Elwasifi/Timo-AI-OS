// Knowledge Validation Suite — types.
// Internal testing framework for the Knowledge Engine. Not for end users.

import type { AnswerSource } from '@/lib/knowledge/types';

export type TestCategory =
  | 'preference_memory'
  | 'identity'
  | 'projects'
  | 'knowledge_updates'
  | 'duplicate_facts'
  | 'conflict_resolution'
  | 'semantic_retrieval'
  | 'structured_retrieval'
  | 'timeline'
  | 'knowledge_graph'
  | 'conversation_memory'
  | 'tool_integration'
  | 'llm_bypass'
  | 'query_planner'
  | 'cache_behavior'
  | 'error_handling';

export interface TestExpectation {
  expectedSource: AnswerSource | AnswerSource[];
  expectedPath: string[];
  expectedAnswerContains?: string;
  expectedAnswerExact?: string;
  expectedConfidenceMin?: number;
  expectedConfidenceMax?: number;
  expectedLLMCalled: boolean;
  expectedProvidersQueried?: string[];
}

export interface TestResult {
  id: string;
  category: TestCategory;
  name: string;
  input: string;
  expected: TestExpectation;
  actual: {
    answer: string;
    source: AnswerSource;
    path: string[];
    confidence: number;
    providersQueried: string[];
    elapsedMs: number;
    llmCalled: boolean;
  };
  passed: boolean;
  failures: string[];
  durationMs: number;
}

export interface SuiteResult {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  successRate: number;
  totalDurationMs: number;
  byCategory: Record<string, { total: number; passed: number; failed: number }>;
  results: TestResult[];
  timestamp: string;
}

export interface TestCase {
  id: string;
  category: TestCategory;
  name: string;
  input: string;
  expectation: TestExpectation;
  setup?: () => Promise<void>;
  teardown?: () => Promise<void>;
  skip?: boolean;
  skipReason?: string;
}
