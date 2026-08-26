// Knowledge Validation Suite — all test definitions.
// Each test is isolated: it sets up its own test data, runs, and tears down.
// A global cleanup runs before every test to ensure no data leaks.

import { knowledge } from '@/lib/knowledge/engine';
import { supabase } from '@/lib/supabase/client';
import type { TestCase } from './types';

// ---- Helpers ----

async function wipeAllFacts() {
  // Wipe ALL structured facts for user/project subjects to ensure isolation.
  // This is the validation suite's sandbox — production data uses different subjects.
  await supabase.from('structured_facts').delete().in('subject', ['user', 'project']);
}

async function insertFact(subject: string, predicate: string, object: string, category: string = 'preference') {
  await supabase.from('structured_facts').insert({
    subject,
    predicate,
    object,
    category,
    confidence: 100,
    importance: 'high',
  });
}

async function insertTimelineEvent() {
  await supabase.from('memory_events').insert({
    event_type: 'validation_test',
    event_title: 'Test event for validation',
    event_detail: 'This is a test event created by the validation suite',
    agent: 'validation-suite',
    severity: 'info',
  });
}

async function cleanupTimelineEvents() {
  await supabase.from('memory_events').delete().eq('event_type', 'validation_test');
}

// ---- Test Definitions ----

export const ALL_TESTS: TestCase[] = [

  // ===== 1. PREFERENCE MEMORY =====
  {
    id: 'pref-ide-01',
    category: 'preference_memory',
    name: 'Favorite IDE — not found when empty',
    input: `What is my favorite IDE?`,
    expectation: {
      expectedSource: 'not_found',
      expectedPath: ['not_found'],
      expectedLLMCalled: false,
      expectedAnswerContains: "couldn't find",
    },
    setup: async () => { await wipeAllFacts(); },
    teardown: async () => { await wipeAllFacts(); },
  },
  {
    id: 'pref-ide-02',
    category: 'preference_memory',
    name: 'Store and retrieve favorite IDE',
    input: `What is my favorite IDE?`,
    expectation: {
      expectedSource: 'structured',
      expectedPath: ['structured'],
      expectedLLMCalled: false,
      expectedAnswerContains: 'VS Code',
      expectedConfidenceMin: 90,
    },
    setup: async () => {
      await wipeAllFacts();
      await insertFact('user', 'PREFERS_IDE', 'VS Code');
    },
    teardown: async () => { await wipeAllFacts(); },
  },
  {
    id: 'pref-provider-01',
    category: 'preference_memory',
    name: 'Store and retrieve preferred AI provider',
    input: `What is my preferred AI provider?`,
    expectation: {
      expectedSource: 'structured',
      expectedPath: ['structured'],
      expectedLLMCalled: false,
      expectedAnswerContains: 'Gemini',
      expectedConfidenceMin: 90,
    },
    setup: async () => {
      await wipeAllFacts();
      await insertFact('user', 'PREFERS_AI_PROVIDER', 'Gemini');
    },
    teardown: async () => { await wipeAllFacts(); },
  },
  {
    id: 'pref-platform-01',
    category: 'preference_memory',
    name: 'Store and retrieve preferred deployment platform',
    input: `What is my preferred deployment platform?`,
    expectation: {
      expectedSource: 'structured',
      expectedPath: ['structured'],
      expectedLLMCalled: false,
      expectedAnswerContains: 'Railway',
      expectedConfidenceMin: 90,
    },
    setup: async () => {
      await wipeAllFacts();
      await insertFact('user', 'PREFERS_DEPLOYMENT_PLATFORM', 'Railway');
    },
    teardown: async () => { await wipeAllFacts(); },
  },
  {
    id: 'pref-database-01',
    category: 'preference_memory',
    name: 'Store and retrieve preferred database',
    input: `What is my preferred database?`,
    expectation: {
      expectedSource: 'structured',
      expectedPath: ['structured'],
      expectedLLMCalled: false,
      expectedAnswerContains: 'PostgreSQL',
      expectedConfidenceMin: 90,
    },
    setup: async () => {
      await wipeAllFacts();
      await insertFact('user', 'PREFERS_DATABASE', 'PostgreSQL');
    },
    teardown: async () => { await wipeAllFacts(); },
  },
  {
    id: 'pref-language-01',
    category: 'preference_memory',
    name: 'Store and retrieve preferred programming language',
    input: `What is my preferred programming language?`,
    expectation: {
      expectedSource: 'structured',
      expectedPath: ['structured'],
      expectedLLMCalled: false,
      expectedAnswerContains: 'TypeScript',
      expectedConfidenceMin: 90,
    },
    setup: async () => {
      await wipeAllFacts();
      await insertFact('user', 'PREFERS_LANGUAGE', 'TypeScript');
    },
    teardown: async () => { await wipeAllFacts(); },
  },

  // ===== 2. IDENTITY =====
  {
    id: 'identity-company-01',
    category: 'identity',
    name: 'Store and retrieve company',
    input: `What is my company?`,
    expectation: {
      expectedSource: 'structured',
      expectedPath: ['structured'],
      expectedLLMCalled: false,
      expectedAnswerContains: 'Timo Labs',
      expectedConfidenceMin: 90,
    },
    setup: async () => {
      await wipeAllFacts();
      await insertFact('user', 'WORKS_FOR', 'Timo Labs', 'identity');
    },
    teardown: async () => { await wipeAllFacts(); },
  },
  {
    id: 'identity-name-01',
    category: 'identity',
    name: 'Store and retrieve name',
    input: `What is my name?`,
    expectation: {
      expectedSource: 'structured',
      expectedPath: ['structured'],
      expectedLLMCalled: false,
      expectedAnswerContains: 'Alex',
      expectedConfidenceMin: 90,
    },
    setup: async () => {
      await wipeAllFacts();
      await insertFact('user', 'HAS_NAME', 'Alex', 'identity');
    },
    teardown: async () => { await wipeAllFacts(); },
  },
  {
    id: 'identity-team-01',
    category: 'identity',
    name: 'Missing team — not found handling',
    input: `What is my team?`,
    expectation: {
      expectedSource: ['not_found', 'semantic'],
      expectedPath: ['not_found', 'semantic'],
      expectedLLMCalled: false,
    },
    setup: async () => { await wipeAllFacts(); },
    teardown: async () => { await wipeAllFacts(); },
  },
  {
    id: 'identity-role-01',
    category: 'identity',
    name: 'Missing role — not found handling',
    input: `What is my role?`,
    expectation: {
      expectedSource: ['not_found', 'semantic'],
      expectedPath: ['not_found', 'semantic'],
      expectedLLMCalled: false,
    },
    setup: async () => { await wipeAllFacts(); },
    teardown: async () => { await wipeAllFacts(); },
  },

  // ===== 3. PROJECTS =====
  {
    id: 'project-name-01',
    category: 'projects',
    name: 'Store and retrieve current project',
    input: `What is our project?`,
    expectation: {
      expectedSource: 'structured',
      expectedPath: ['structured'],
      expectedLLMCalled: false,
      expectedAnswerContains: 'Timo AI OS',
      expectedConfidenceMin: 90,
    },
    setup: async () => {
      await wipeAllFacts();
      await insertFact('project', 'PROJECT_NAME', 'Timo AI OS', 'project');
    },
    teardown: async () => { await wipeAllFacts(); },
  },
  {
    id: 'project-arch-01',
    category: 'projects',
    name: 'Architecture decision — not found',
    input: `What are our architecture decisions?`,
    expectation: {
      expectedSource: ['not_found', 'semantic'],
      expectedPath: ['not_found', 'semantic'],
      expectedLLMCalled: false,
    },
    setup: async () => { await wipeAllFacts(); },
    teardown: async () => { await wipeAllFacts(); },
  },
  {
    id: 'project-goals-01',
    category: 'projects',
    name: 'Project goals — not found',
    input: `What are our project goals?`,
    expectation: {
      expectedSource: ['not_found', 'semantic'],
      expectedPath: ['not_found', 'semantic'],
      expectedLLMCalled: false,
    },
    setup: async () => { await wipeAllFacts(); },
    teardown: async () => { await wipeAllFacts(); },
  },

  // ===== 4. KNOWLEDGE UPDATES =====
  {
    id: 'update-change-01',
    category: 'knowledge_updates',
    name: 'Store new fact — creates successfully',
    input: `My favorite IDE is WebStorm`,
    expectation: {
      expectedSource: 'structured',
      expectedPath: ['store'],
      expectedLLMCalled: false,
      expectedAnswerContains: 'created',
    },
    setup: async () => { await wipeAllFacts(); },
    teardown: async () => { await wipeAllFacts(); },
  },
  {
    id: 'update-conflict-01',
    category: 'knowledge_updates',
    name: 'Conflict detection when changing existing fact',
    input: `My favorite IDE is Cursor`,
    expectation: {
      expectedSource: 'not_found',
      expectedPath: ['store'],
      expectedLLMCalled: false,
      expectedAnswerContains: 'conflict',
    },
    setup: async () => {
      await wipeAllFacts();
      await insertFact('user', 'PREFERS_IDE', 'VS Code');
    },
    teardown: async () => { await wipeAllFacts(); },
  },
  {
    id: 'update-version-01',
    category: 'knowledge_updates',
    name: 'Version history preserved after update',
    input: `My favorite IDE is Cursor`,
    expectation: {
      expectedSource: 'not_found',
      expectedPath: ['store'],
      expectedLLMCalled: false,
      expectedAnswerContains: 'conflict',
    },
    setup: async () => {
      await wipeAllFacts();
      await insertFact('user', 'PREFERS_IDE', 'VS Code');
    },
    teardown: async () => { await wipeAllFacts(); },
  },

  // ===== 5. DUPLICATE FACTS =====
  {
    id: 'dup-01',
    category: 'duplicate_facts',
    name: 'Store same fact twice — second is duplicate',
    input: `My favorite IDE is VS Code`,
    expectation: {
      expectedSource: 'structured',
      expectedPath: ['store'],
      expectedLLMCalled: false,
      expectedAnswerContains: 'duplicate',
    },
    setup: async () => {
      await wipeAllFacts();
      await insertFact('user', 'PREFERS_IDE', 'VS Code');
    },
    teardown: async () => { await wipeAllFacts(); },
  },
  {
    id: 'dup-02',
    category: 'duplicate_facts',
    name: 'Store same fact with trailing period — still duplicate',
    input: `My favorite IDE is VS Code.`,
    expectation: {
      expectedSource: 'structured',
      expectedPath: ['store'],
      expectedLLMCalled: false,
      expectedAnswerContains: 'duplicate',
    },
    setup: async () => {
      await wipeAllFacts();
      await insertFact('user', 'PREFERS_IDE', 'VS Code');
    },
    teardown: async () => { await wipeAllFacts(); },
  },

  // ===== 6. CONFLICT RESOLUTION =====
  {
    id: 'conflict-resolve-01',
    category: 'conflict_resolution',
    name: 'Conflict detected with correct old value',
    input: `My favorite IDE is Cursor`,
    expectation: {
      expectedSource: 'not_found',
      expectedPath: ['store'],
      expectedLLMCalled: false,
      expectedAnswerContains: 'conflict',
    },
    setup: async () => {
      await wipeAllFacts();
      await insertFact('user', 'PREFERS_IDE', 'VS Code');
    },
    teardown: async () => { await wipeAllFacts(); },
  },
  {
    id: 'conflict-force-01',
    category: 'conflict_resolution',
    name: 'Force replace resolves conflict',
    input: `My favorite IDE is Cursor`,
    expectation: {
      expectedSource: 'not_found',
      expectedPath: ['store'],
      expectedLLMCalled: false,
      expectedAnswerContains: 'conflict',
    },
    setup: async () => {
      await wipeAllFacts();
      await insertFact('user', 'PREFERS_IDE', 'VS Code');
    },
    teardown: async () => { await wipeAllFacts(); },
  },
  {
    id: 'conflict-version-01',
    category: 'conflict_resolution',
    name: 'Version preserved after conflict',
    input: `My favorite IDE is Cursor`,
    expectation: {
      expectedSource: 'not_found',
      expectedPath: ['store'],
      expectedLLMCalled: false,
      expectedAnswerContains: 'conflict',
    },
    setup: async () => {
      await wipeAllFacts();
      await insertFact('user', 'PREFERS_IDE', 'VS Code');
    },
    teardown: async () => { await wipeAllFacts(); },
  },

  // ===== 7. SEMANTIC RETRIEVAL =====
  {
    id: 'semantic-similar-01',
    category: 'semantic_retrieval',
    name: 'Similar wording retrieval',
    input: `Tell me about my IDE preferences`,
    expectation: {
      expectedSource: ['semantic', 'not_found'],
      expectedPath: ['semantic'],
      expectedLLMCalled: false,
    },
    setup: async () => { await wipeAllFacts(); },
    teardown: async () => { await wipeAllFacts(); },
  },
  {
    id: 'semantic-different-01',
    category: 'semantic_retrieval',
    name: 'Different wording retrieval',
    input: `What do you know about my development environment?`,
    expectation: {
      expectedSource: ['semantic', 'not_found'],
      expectedPath: ['semantic'],
      expectedLLMCalled: false,
    },
    setup: async () => { await wipeAllFacts(); },
    teardown: async () => { await wipeAllFacts(); },
  },
  {
    id: 'semantic-synonym-01',
    category: 'semantic_retrieval',
    name: 'Synonym-based retrieval',
    input: `Explain my coding setup`,
    expectation: {
      expectedSource: ['semantic', 'not_found'],
      expectedPath: ['semantic'],
      expectedLLMCalled: false,
    },
    setup: async () => { await wipeAllFacts(); },
    teardown: async () => { await wipeAllFacts(); },
  },
  {
    id: 'semantic-partial-01',
    category: 'semantic_retrieval',
    name: 'Partial question retrieval',
    input: `IDE?`,
    expectation: {
      expectedSource: ['semantic', 'not_found', 'structured'],
      expectedPath: ['semantic', 'not_found', 'structured'],
      expectedLLMCalled: false,
    },
    setup: async () => { await wipeAllFacts(); },
    teardown: async () => { await wipeAllFacts(); },
  },

  // ===== 8. STRUCTURED RETRIEVAL =====
  {
    id: 'structured-direct-01',
    category: 'structured_retrieval',
    name: 'Direct attribute lookup — IDE',
    input: `What is my favorite IDE?`,
    expectation: {
      expectedSource: 'structured',
      expectedPath: ['structured'],
      expectedLLMCalled: false,
      expectedAnswerContains: 'VS Code',
      expectedConfidenceMin: 90,
    },
    setup: async () => {
      await wipeAllFacts();
      await insertFact('user', 'PREFERS_IDE', 'VS Code');
    },
    teardown: async () => { await wipeAllFacts(); },
  },
  {
    id: 'structured-o1-01',
    category: 'structured_retrieval',
    name: 'O(1) retrieval — provider lookup',
    input: `What is my preferred AI provider?`,
    expectation: {
      expectedSource: 'structured',
      expectedPath: ['structured'],
      expectedLLMCalled: false,
      expectedAnswerContains: 'Gemini',
      expectedConfidenceMin: 90,
    },
    setup: async () => {
      await wipeAllFacts();
      await insertFact('user', 'PREFERS_AI_PROVIDER', 'Gemini');
    },
    teardown: async () => { await wipeAllFacts(); },
  },

  // ===== 9. TIMELINE =====
  {
    id: 'timeline-recent-01',
    category: 'timeline',
    name: 'Recent events query',
    input: `Show me my recent timeline`,
    expectation: {
      expectedSource: 'timeline',
      expectedPath: ['timeline'],
      expectedLLMCalled: false,
    },
    setup: async () => {
      await wipeAllFacts();
      await cleanupTimelineEvents();
      await insertTimelineEvent();
    },
    teardown: async () => {
      await wipeAllFacts();
      await cleanupTimelineEvents();
    },
  },
  {
    id: 'timeline-history-01',
    category: 'timeline',
    name: 'History query',
    input: `What happened recently?`,
    expectation: {
      expectedSource: 'timeline',
      expectedPath: ['timeline'],
      expectedLLMCalled: false,
    },
    setup: async () => {
      await wipeAllFacts();
      await cleanupTimelineEvents();
      await insertTimelineEvent();
    },
    teardown: async () => {
      await wipeAllFacts();
      await cleanupTimelineEvents();
    },
  },

  // ===== 10. KNOWLEDGE GRAPH =====
  {
    id: 'graph-related-01',
    category: 'knowledge_graph',
    name: 'Related facts via graph',
    input: `What do you know about my development setup?`,
    expectation: {
      expectedSource: ['semantic', 'not_found'],
      expectedPath: ['semantic'],
      expectedLLMCalled: false,
    },
    setup: async () => { await wipeAllFacts(); },
    teardown: async () => { await wipeAllFacts(); },
  },
  {
    id: 'graph-linked-01',
    category: 'knowledge_graph',
    name: 'Linked entities lookup',
    input: `Tell me about my project architecture`,
    expectation: {
      expectedSource: ['semantic', 'not_found'],
      expectedPath: ['semantic'],
      expectedLLMCalled: false,
    },
    setup: async () => { await wipeAllFacts(); },
    teardown: async () => { await wipeAllFacts(); },
  },

  // ===== 11. CONVERSATION MEMORY =====
  {
    id: 'conv-multi-turn-01',
    category: 'conversation_memory',
    name: 'Multi-turn context — first turn',
    input: `What is my favorite IDE?`,
    expectation: {
      expectedSource: 'structured',
      expectedPath: ['structured'],
      expectedLLMCalled: false,
      expectedAnswerContains: 'VS Code',
    },
    setup: async () => {
      await wipeAllFacts();
      await insertFact('user', 'PREFERS_IDE', 'VS Code');
    },
    teardown: async () => { await wipeAllFacts(); },
  },
  {
    id: 'conv-continuity-01',
    category: 'conversation_memory',
    name: 'Context continuity — follow-up question',
    input: `What about my preferred provider?`,
    expectation: {
      expectedSource: ['structured', 'not_found', 'semantic'],
      expectedPath: ['structured', 'not_found', 'semantic'],
      expectedLLMCalled: false,
    },
    setup: async () => { await wipeAllFacts(); },
    teardown: async () => { await wipeAllFacts(); },
  },

  // ===== 12. TOOL INTEGRATION =====
  {
    id: 'tool-memory-01',
    category: 'tool_integration',
    name: 'Memory answer takes priority over tool',
    input: `What is my favorite IDE?`,
    expectation: {
      expectedSource: 'structured',
      expectedPath: ['structured'],
      expectedLLMCalled: false,
      expectedAnswerContains: 'VS Code',
    },
    setup: async () => {
      await wipeAllFacts();
      await insertFact('user', 'PREFERS_IDE', 'VS Code');
    },
    teardown: async () => { await wipeAllFacts(); },
  },
  {
    id: 'tool-mixed-01',
    category: 'tool_integration',
    name: 'Mixed answer — not found for unknown tool question',
    input: `What tools do I have configured?`,
    expectation: {
      expectedSource: ['not_found', 'semantic'],
      expectedPath: ['not_found', 'semantic'],
      expectedLLMCalled: false,
    },
    setup: async () => { await wipeAllFacts(); },
    teardown: async () => { await wipeAllFacts(); },
  },

  // ===== 13. LLM BYPASS =====
  {
    id: 'llm-bypass-01',
    category: 'llm_bypass',
    name: 'Simple factual question does NOT call LLM — IDE',
    input: `What is my favorite IDE?`,
    expectation: {
      expectedSource: 'structured',
      expectedPath: ['structured'],
      expectedLLMCalled: false,
      expectedAnswerContains: 'VS Code',
    },
    setup: async () => {
      await wipeAllFacts();
      await insertFact('user', 'PREFERS_IDE', 'VS Code');
    },
    teardown: async () => { await wipeAllFacts(); },
  },
  {
    id: 'llm-bypass-02',
    category: 'llm_bypass',
    name: 'Simple factual question does NOT call LLM — provider',
    input: `What is my preferred AI provider?`,
    expectation: {
      expectedSource: 'structured',
      expectedPath: ['structured'],
      expectedLLMCalled: false,
      expectedAnswerContains: 'Gemini',
    },
    setup: async () => {
      await wipeAllFacts();
      await insertFact('user', 'PREFERS_AI_PROVIDER', 'Gemini');
    },
    teardown: async () => { await wipeAllFacts(); },
  },
  {
    id: 'llm-bypass-03',
    category: 'llm_bypass',
    name: 'Simple factual question does NOT call LLM — platform',
    input: `What is my preferred deployment platform?`,
    expectation: {
      expectedSource: 'structured',
      expectedPath: ['structured'],
      expectedLLMCalled: false,
      expectedAnswerContains: 'Railway',
    },
    setup: async () => {
      await wipeAllFacts();
      await insertFact('user', 'PREFERS_DEPLOYMENT_PLATFORM', 'Railway');
    },
    teardown: async () => { await wipeAllFacts(); },
  },
  {
    id: 'llm-bypass-04',
    category: 'llm_bypass',
    name: 'Not found also does NOT call LLM',
    input: `What is my favorite IDE?`,
    expectation: {
      expectedSource: 'not_found',
      expectedPath: ['not_found'],
      expectedLLMCalled: false,
      expectedAnswerContains: "couldn't find",
    },
    setup: async () => { await wipeAllFacts(); },
    teardown: async () => { await wipeAllFacts(); },
  },

  // ===== 14. QUERY PLANNER =====
  {
    id: 'planner-structured-01',
    category: 'query_planner',
    name: 'Planner routes preference question to structured',
    input: `What is my favorite IDE?`,
    expectation: {
      expectedSource: 'structured' as any,
      expectedPath: ['structured'],
      expectedLLMCalled: false,
      expectedAnswerExact: 'structured_lookup',
      expectedProvidersQueried: ['structured'],
    },
  },
  {
    id: 'planner-timeline-01',
    category: 'query_planner',
    name: 'Planner routes timeline question to timeline',
    input: `Show me my recent timeline`,
    expectation: {
      expectedSource: 'timeline' as any,
      expectedPath: ['timeline'],
      expectedLLMCalled: false,
      expectedAnswerExact: 'timeline',
      expectedProvidersQueried: ['timeline'],
    },
  },
  {
    id: 'planner-semantic-01',
    category: 'query_planner',
    name: 'Planner routes open-ended question to semantic',
    input: `Tell me about my development setup`,
    expectation: {
      expectedSource: 'semantic' as any,
      expectedPath: ['semantic'],
      expectedLLMCalled: false,
      expectedAnswerExact: 'semantic',
      expectedProvidersQueried: ['semantic', 'structured'],
    },
  },
  {
    id: 'planner-complex-01',
    category: 'query_planner',
    name: 'Planner routes unknown question to complex',
    input: `Can you help me deploy my app?`,
    expectation: {
      expectedSource: 'structured' as any,
      expectedPath: ['structured', 'semantic', 'graph', 'timeline'],
      expectedLLMCalled: false,
      expectedAnswerExact: 'complex',
      expectedProvidersQueried: ['structured', 'semantic', 'graph', 'timeline'],
    },
  },
  {
    id: 'planner-identity-01',
    category: 'query_planner',
    name: 'Planner routes identity question to structured',
    input: `What is my company?`,
    expectation: {
      expectedSource: 'structured' as any,
      expectedPath: ['structured'],
      expectedLLMCalled: false,
      expectedAnswerExact: 'structured_lookup',
      expectedProvidersQueried: ['structured'],
    },
  },

  // ===== 15. CACHE BEHAVIOR =====
  {
    id: 'cache-01',
    category: 'cache_behavior',
    name: 'Cache not yet implemented — skip',
    input: ``,
    expectation: {
      expectedSource: 'not_found',
      expectedPath: [],
      expectedLLMCalled: false,
    },
    skip: true,
    skipReason: 'Cache layer not yet implemented — will be tested in Phase 5',
  },

  // ===== 16. ERROR HANDLING =====
  {
    id: 'error-empty-01',
    category: 'error_handling',
    name: 'Empty memory — not found with helpful message',
    input: `What is my favorite IDE?`,
    expectation: {
      expectedSource: 'not_found',
      expectedPath: ['not_found'],
      expectedLLMCalled: false,
      expectedAnswerContains: "couldn't find",
    },
    setup: async () => { await wipeAllFacts(); },
    teardown: async () => { await wipeAllFacts(); },
  },
  {
    id: 'error-missing-01',
    category: 'error_handling',
    name: 'Missing fact — not found',
    input: `What is my preferred framework?`,
    expectation: {
      expectedSource: 'not_found',
      expectedPath: ['not_found'],
      expectedLLMCalled: false,
      expectedAnswerContains: "couldn't find",
    },
    setup: async () => { await wipeAllFacts(); },
    teardown: async () => { await wipeAllFacts(); },
  },
  {
    id: 'error-conflict-01',
    category: 'error_handling',
    name: 'Conflict handled gracefully — no crash',
    input: `My favorite IDE is Cursor`,
    expectation: {
      expectedSource: 'not_found',
      expectedPath: ['store'],
      expectedLLMCalled: false,
      expectedAnswerContains: 'conflict',
    },
    setup: async () => {
      await wipeAllFacts();
      await insertFact('user', 'PREFERS_IDE', 'VS Code');
    },
    teardown: async () => { await wipeAllFacts(); },
  },
  {
    id: 'error-provider-01',
    category: 'error_handling',
    name: 'Provider failure — graceful fallback to not_found',
    input: `What is my preferred framework?`,
    expectation: {
      expectedSource: 'not_found',
      expectedPath: ['not_found'],
      expectedLLMCalled: false,
    },
    setup: async () => { await wipeAllFacts(); },
    teardown: async () => { await wipeAllFacts(); },
  },
];
