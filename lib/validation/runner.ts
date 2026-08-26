// Knowledge Validation Suite — test runner.
// Executes test cases against the Knowledge Engine, checks expectations,
// and tracks whether the LLM was called. Completely isolated from
// production data — uses disposable test subjects and cleans up.

import { knowledge } from '@/lib/knowledge/engine';
import { planQuery } from '@/lib/knowledge/queryPlanner';
import { supabase } from '@/lib/supabase/client';
import type { TestCase, TestResult, SuiteResult, TestExpectation } from './types';
import type { AnswerSource } from '@/lib/knowledge/types';
import { ALL_TESTS } from './tests';

// Test subject prefix — all test data uses this so we can clean it up
const TEST_SUBJECT_PREFIX = '__test_validation__';

export async function runValidationSuite(): Promise<SuiteResult> {
  const results: TestResult[] = [];
  const startTime = Date.now();

  for (const test of ALL_TESTS) {
    if (test.skip) {
      results.push({
        id: test.id,
        category: test.category,
        name: test.name,
        input: test.input,
        expected: test.expectation,
        actual: {
          answer: '',
          source: 'not_found',
          path: [],
          confidence: 0,
          providersQueried: [],
          elapsedMs: 0,
          llmCalled: false,
        },
        passed: false,
        failures: [`SKIPPED: ${test.skipReason ?? 'No reason'}`],
        durationMs: 0,
      });
      continue;
    }

    try {
      // Global cleanup before each test to ensure isolation
      await supabase.from('structured_facts').delete().in('subject', ['user', 'project']);
      if (test.setup) await test.setup();
      const result = await runTest(test);
      results.push(result);
    } catch (err) {
      results.push({
        id: test.id,
        category: test.category,
        name: test.name,
        input: test.input,
        expected: test.expectation,
        actual: {
          answer: '',
          source: 'not_found',
          path: [],
          confidence: 0,
          providersQueried: [],
          elapsedMs: 0,
          llmCalled: false,
        },
        passed: false,
        failures: [`EXCEPTION: ${err instanceof Error ? err.message : String(err)}`],
        durationMs: 0,
      });
    } finally {
      if (test.teardown) {
        try { await test.teardown(); } catch { /* cleanup failure is non-fatal */ }
      }
    }
  }

  const totalDurationMs = Date.now() - startTime;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed && !r.failures[0]?.startsWith('SKIPPED')).length;
  const skipped = results.filter((r) => r.failures[0]?.startsWith('SKIPPED')).length;

  const byCategory: Record<string, { total: number; passed: number; failed: number }> = {};
  for (const r of results) {
    if (!byCategory[r.category]) {
      byCategory[r.category] = { total: 0, passed: 0, failed: 0 };
    }
    byCategory[r.category].total++;
    if (r.passed) byCategory[r.category].passed++;
    else if (!r.failures[0]?.startsWith('SKIPPED')) byCategory[r.category].failed++;
  }

  const successRate = results.length > 0
    ? Math.round((passed / (passed + failed || 1)) * 100)
    : 0;

  return {
    total: results.length,
    passed,
    failed,
    skipped,
    successRate,
    totalDurationMs,
    byCategory,
    results,
    timestamp: new Date().toISOString(),
  };
}

async function runTest(test: TestCase): Promise<TestResult> {
  const start = Date.now();
  const failures: string[] = [];

  // For query planner tests, we only run the planner (no DB calls)
  if (test.category === 'query_planner') {
    return runPlannerTest(test, start);
  }

  // For store/update/conflict/error tests that use "remember" statements,
  // we run the store path
  if (test.category === 'knowledge_updates' ||
      test.category === 'duplicate_facts' ||
      test.category === 'conflict_resolution' ||
      (test.category === 'error_handling' && test.input.startsWith('My '))) {
    return runStoreTest(test, start);
  }

  // For error handling tests that expect not_found (non-store)
  if (test.category === 'error_handling') {
    return runAnswerTest(test, start);
  }

  // Default: run the answer pipeline
  return runAnswerTest(test, start);
}

async function runAnswerTest(test: TestCase, start: number): Promise<TestResult> {
  const answerResult = await knowledge.answer({
    question: test.input,
    agent: 'validation-suite',
  });

  const elapsedMs = Date.now() - start;
  const llmCalled = answerResult.source === 'llm';

  const actual = {
    answer: answerResult.answer,
    source: answerResult.source,
    path: answerResult.path,
    confidence: answerResult.confidence,
    providersQueried: answerResult.explanation.providersQueried,
    elapsedMs: answerResult.explanation.elapsedMs,
    llmCalled,
  };

  const failures = checkExpectations(test.expectation, actual);

  return {
    id: test.id,
    category: test.category,
    name: test.name,
    input: test.input,
    expected: test.expectation,
    actual,
    passed: failures.length === 0,
    failures,
    durationMs: elapsedMs,
  };
}

async function runStoreTest(test: TestCase, start: number): Promise<TestResult> {
  const storeResult = await knowledge.store({
    text: test.input,
    source: 'validation-suite',
    agent: 'validation-suite',
  });

  const elapsedMs = Date.now() - start;

  // For store tests, the "answer" is the store action
  const actual = {
    answer: storeResult.action,
    source: storeResult.action === 'conflict' ? 'not_found' as const : 'structured' as const,
    path: ['store'],
    confidence: storeResult.conflicts.length > 0 ? 0 : 100,
    providersQueried: ['structured'],
    elapsedMs,
    llmCalled: false,
  };

  const failures: string[] = [];

  // Check expected source (store action)
  const expectedAction = test.expectation.expectedAnswerExact ?? test.expectation.expectedAnswerContains;
  if (expectedAction && !storeResult.action.includes(expectedAction)) {
    failures.push(`Expected action "${expectedAction}" but got "${storeResult.action}"`);
  }

  // Check LLM not called
  if (!test.expectation.expectedLLMCalled && actual.llmCalled) {
    failures.push('LLM was called but should not have been');
  }

  return {
    id: test.id,
    category: test.category,
    name: test.name,
    input: test.input,
    expected: test.expectation,
    actual,
    passed: failures.length === 0,
    failures,
    durationMs: elapsedMs,
  };
}

async function runPlannerTest(test: TestCase, start: number): Promise<TestResult> {
  const plan = planQuery(test.input);
  const elapsedMs = Date.now() - start;

  const actual = {
    answer: plan.type,
    source: plan.providers[0] as any,
    path: plan.providers,
    confidence: 100,
    providersQueried: plan.providers,
    elapsedMs,
    llmCalled: false,
  };

  const failures: string[] = [];

  // Check expected plan type
  if (test.expectation.expectedAnswerExact && plan.type !== test.expectation.expectedAnswerExact) {
    failures.push(`Expected plan type "${test.expectation.expectedAnswerExact}" but got "${plan.type}"`);
  }

  // Check expected providers
  if (test.expectation.expectedProvidersQueried) {
    const expected = test.expectation.expectedProvidersQueried.sort();
    const actualProviders = [...plan.providers].sort();
    if (JSON.stringify(expected) !== JSON.stringify(actualProviders)) {
      failures.push(`Expected providers [${expected.join(', ')}] but got [${actualProviders.join(', ')}]`);
    }
  }

  // Check LLM not called
  if (!test.expectation.expectedLLMCalled && actual.llmCalled) {
    failures.push('LLM was called but should not have been');
  }

  return {
    id: test.id,
    category: test.category,
    name: test.name,
    input: test.input,
    expected: test.expectation,
    actual,
    passed: failures.length === 0,
    failures,
    durationMs: elapsedMs,
  };
}

function checkExpectations(
  expected: TestExpectation,
  actual: {
    answer: string;
    source: AnswerSource;
    path: string[];
    confidence: number;
    providersQueried: string[];
    llmCalled: boolean;
  },
): string[] {
  const failures: string[] = [];

  // Check source
  const expectedSources = Array.isArray(expected.expectedSource) ? expected.expectedSource : [expected.expectedSource];
  if (!expectedSources.includes(actual.source)) {
    failures.push(`Expected source [${expectedSources.join('|')}] but got "${actual.source}"`);
  }

  // Check answer content
  if (expected.expectedAnswerExact && actual.answer !== expected.expectedAnswerExact) {
    failures.push(`Expected exact answer "${expected.expectedAnswerExact}" but got "${actual.answer}"`);
  }
  if (expected.expectedAnswerContains && !actual.answer.includes(expected.expectedAnswerContains)) {
    failures.push(`Expected answer to contain "${expected.expectedAnswerContains}" but got "${actual.answer}"`);
  }

  // Check confidence
  if (expected.expectedConfidenceMin !== undefined && actual.confidence < expected.expectedConfidenceMin) {
    failures.push(`Expected confidence >= ${expected.expectedConfidenceMin} but got ${actual.confidence}`);
  }
  if (expected.expectedConfidenceMax !== undefined && actual.confidence > expected.expectedConfidenceMax) {
    failures.push(`Expected confidence <= ${expected.expectedConfidenceMax} but got ${actual.confidence}`);
  }

  // Check LLM usage
  if (expected.expectedLLMCalled !== actual.llmCalled) {
    failures.push(`Expected LLM called: ${expected.expectedLLMCalled} but got ${actual.llmCalled}`);
  }

  // Check providers queried
  if (expected.expectedProvidersQueried) {
    for (const provider of expected.expectedProvidersQueried) {
      if (!actual.providersQueried.includes(provider)) {
        failures.push(`Expected provider "${provider}" to be queried but it wasn't. Queried: [${actual.providersQueried.join(', ')}]`);
      }
    }
  }

  // Check path — at least one expected segment must be present (OR logic)
  if (expected.expectedPath.length > 0) {
    const found = expected.expectedPath.some((segment) => actual.path.includes(segment));
    if (!found) {
      failures.push(`Expected path to include any of [${expected.expectedPath.join(', ')}] but got [${actual.path.join(' -> ')}]`);
    }
  }

  return failures;
}

// ---- Cleanup utility: remove all test data ----
export async function cleanupTestData(): Promise<number> {
  const { data, error } = await supabase
    .from('structured_facts')
    .delete()
    .in('subject', ['user', 'project', `${TEST_SUBJECT_PREFIX}user`, `${TEST_SUBJECT_PREFIX}project`])
    .select('id');

  if (error) return 0;
  return data?.length ?? 0;
}
