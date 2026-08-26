'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, CheckCircle2, XCircle, Clock, Database, AlertTriangle,
  RefreshCw, ChevronDown, ChevronRight, Activity, FlaskConical,
  CircleSlash,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { SuiteResult, TestResult } from '@/lib/validation/types';

const CATEGORY_LABELS: Record<string, string> = {
  preference_memory: 'Preference Memory',
  identity: 'Identity',
  projects: 'Projects',
  knowledge_updates: 'Knowledge Updates',
  duplicate_facts: 'Duplicate Facts',
  conflict_resolution: 'Conflict Resolution',
  semantic_retrieval: 'Semantic Retrieval',
  structured_retrieval: 'Structured Retrieval',
  timeline: 'Timeline',
  knowledge_graph: 'Knowledge Graph',
  conversation_memory: 'Conversation Memory',
  tool_integration: 'Tool Integration',
  llm_bypass: 'LLM Bypass',
  query_planner: 'Query Planner',
  cache_behavior: 'Cache Behavior',
  error_handling: 'Error Handling',
};

export default function ValidationPage() {
  const [result, setResult] = useState<SuiteResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedTests, setExpandedTests] = useState<Set<string>>(new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const runSuite = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch('/api/validation/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResult(data as SuiteResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run validation');
    } finally {
      setRunning(false);
    }
  }, []);

  const toggleTest = (id: string) => {
    setExpandedTests((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const passedCount = result?.passed ?? 0;
  const failedCount = result?.failed ?? 0;
  const skippedCount = result?.skipped ?? 0;
  const totalCount = result?.total ?? 0;
  const successRate = result?.successRate ?? 0;

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <FlaskConical className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Knowledge Validation Suite</h1>
            <p className="text-xs text-muted-foreground">
              Automated verification of the Knowledge Engine — {totalCount} tests across 16 categories
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {running && (
            <Badge variant="outline" className="gap-1.5 border-primary/30 text-primary">
              <RefreshCw className="h-3 w-3 animate-spin" />
              Running...
            </Badge>
          )}
          <Button onClick={runSuite} disabled={running} size="sm" className="gap-2">
            <Play className="h-4 w-4" />
            {running ? 'Running...' : 'Run Validation Suite'}
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <Card className="border-error/30 bg-error/5 p-4">
          <div className="flex items-center gap-2 text-error">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm font-medium">Validation failed to run</span>
          </div>
          <p className="mt-1 text-xs text-error/80">{error}</p>
        </Card>
      )}

      {/* Stats Dashboard */}
      {result && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
          <StatCard label="Total Tests" value={totalCount} icon={Activity} color="text-primary" />
          <StatCard label="Passed" value={passedCount} icon={CheckCircle2} color="text-success" />
          <StatCard label="Failed" value={failedCount} icon={XCircle} color="text-error" />
          <StatCard label="Skipped" value={skippedCount} icon={CircleSlash} color="text-muted-foreground" />
          <StatCard
            label="Success Rate"
            value={`${successRate}%`}
            icon={CheckCircle2}
            color={successRate >= 95 ? 'text-success' : successRate >= 80 ? 'text-warning' : 'text-error'}
          />
          <StatCard
            label="Execution Time"
            value={`${(result.totalDurationMs / 1000).toFixed(2)}s`}
            icon={Clock}
            color="text-secondary"
          />
        </div>
      )}

      {/* Success Rate Progress Bar */}
      {result && (
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Overall Success Rate</span>
            <span className={cn(
              'text-sm font-bold',
              successRate >= 95 ? 'text-success' : successRate >= 80 ? 'text-warning' : 'text-error',
            )}>
              {successRate}%
              {successRate >= 95 && ' (Target Met)'}
            </span>
          </div>
          <div
            className={cn(
              'h-2 w-full overflow-hidden rounded-full bg-muted',
            )}
          >
            <div
              className={cn(
                'h-full rounded-full transition-all',
                successRate >= 95 ? 'bg-success' : successRate >= 80 ? 'bg-warning' : 'bg-error',
              )}
              style={{ width: `${successRate}%` }}
            />
          </div>
          <div className="mt-2 flex items-center gap-4 text-[10px] text-muted-foreground">
            <span>Target: 95%+</span>
            <span>Passed: {passedCount}</span>
            <span>Failed: {failedCount}</span>
            {skippedCount > 0 && <span>Skipped: {skippedCount}</span>}
          </div>
        </Card>
      )}

      {/* Category Breakdown */}
      {result && (
        <div className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Category Breakdown
          </h2>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-4">
            {Object.entries(result.byCategory).map(([cat, stats]) => {
              const rate = stats.total > 0 ? Math.round((stats.passed / stats.total) * 100) : 0;
              const isExpanded = expandedCategories.has(cat);
              return (
                <Card
                  key={cat}
                  className="cursor-pointer p-3 transition-colors hover:bg-white/5"
                  onClick={() => toggleCategory(cat)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {isExpanded ? (
                        <ChevronDown className="h-3 w-3 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      )}
                      <span className="text-xs font-medium text-foreground">
                        {CATEGORY_LABELS[cat] ?? cat}
                      </span>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[10px]',
                        rate === 100 ? 'border-success/30 text-success' :
                        rate >= 50 ? 'border-warning/30 text-warning' :
                        'border-error/30 text-error',
                      )}
                    >
                      {stats.passed}/{stats.total}
                    </Badge>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          rate === 100 ? 'bg-success' :
                          rate >= 50 ? 'bg-warning' : 'bg-error',
                        )}
                        style={{ width: `${rate}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground">{rate}%</span>
                  </div>

                  {/* Expanded tests for this category */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-2 space-y-1">
                          {result.results
                            .filter((r) => r.category === cat)
                            .map((test) => (
                              <TestRow
                                key={test.id}
                                test={test}
                                expanded={expandedTests.has(test.id)}
                                onToggle={() => toggleTest(test.id)}
                              />
                            ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Detailed Results */}
      {result && (
        <Card className="flex-1 overflow-hidden">
          <div className="flex items-center justify-between border-b border-border/30 p-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Detailed Results
            </h2>
            <span className="text-[10px] text-muted-foreground">
              {result.timestamp && new Date(result.timestamp).toLocaleString()}
            </span>
          </div>
          <ScrollArea className="h-[calc(100%-44px)]">
            <div className="space-y-1 p-2">
              {result.results.map((test) => (
                <TestRow
                  key={test.id}
                  test={test}
                  expanded={expandedTests.has(test.id)}
                  onToggle={() => toggleTest(test.id)}
                />
              ))}
            </div>
          </ScrollArea>
        </Card>
      )}

      {/* Empty State */}
      {!result && !running && !error && (
        <Card className="flex flex-1 items-center justify-center p-12">
          <div className="text-center">
            <FlaskConical className="mx-auto h-12 w-12 text-muted-foreground/30" />
            <p className="mt-3 text-sm text-muted-foreground">
              Run the validation suite to verify the Knowledge Engine
            </p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              Tests run against the live database with disposable test data
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}

function StatCard({
  label, value, icon: Icon, color,
}: { label: string; value: string | number; icon: typeof Activity; color: string }) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-2">
        <Icon className={cn('h-4 w-4', color)} />
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      <div className={cn('mt-1.5 text-xl font-bold', color)}>
        {value}
      </div>
    </Card>
  );
}

function TestRow({
  test, expanded, onToggle,
}: { test: TestResult; expanded: boolean; onToggle: () => void }) {
  const isSkipped = test.failures[0]?.startsWith('SKIPPED');
  const statusIcon = isSkipped ? (
    <CircleSlash className="h-3.5 w-3.5 text-muted-foreground" />
  ) : test.passed ? (
    <CheckCircle2 className="h-3.5 w-3.5 text-success" />
  ) : (
    <XCircle className="h-3.5 w-3.5 text-error" />
  );

  return (
    <div className="rounded-lg border border-border/20 bg-background/30">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 p-2 text-left transition-colors hover:bg-white/5"
      >
        {statusIcon}
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
        <span className="flex-1 truncate text-xs font-medium text-foreground">
          {test.name}
        </span>
        <Badge variant="outline" className="text-[9px] text-muted-foreground">
          {test.category}
        </Badge>
        <span className="text-[9px] text-muted-foreground">
          {test.durationMs}ms
        </span>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="space-y-2 p-3 pt-0">
              {/* Input */}
              <div>
                <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Input</span>
                <p className="mt-0.5 rounded bg-background/50 p-1.5 font-mono text-[10px] text-foreground">
                  &quot;{test.input}&quot;
                </p>
              </div>

              {/* Expected vs Actual */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Expected</span>
                  <div className="mt-0.5 space-y-0.5 text-[10px] text-muted-foreground">
                    <div>Source: <span className="text-foreground">{formatSource(test.expected.expectedSource)}</span></div>
                    <div>Path: <span className="text-foreground">{test.expected.expectedPath.join(' → ') || '—'}</span></div>
                    <div>LLM: <span className={test.expected.expectedLLMCalled ? 'text-warning' : 'text-success'}>
                      {test.expected.expectedLLMCalled ? 'Called' : 'Not Called'}
                    </span></div>
                    {test.expected.expectedAnswerContains && (
                      <div>Contains: <span className="text-foreground">{test.expected.expectedAnswerContains}</span></div>
                    )}
                    {test.expected.expectedAnswerExact && (
                      <div>Exact: <span className="text-foreground">{test.expected.expectedAnswerExact}</span></div>
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Actual</span>
                  <div className="mt-0.5 space-y-0.5 text-[10px] text-muted-foreground">
                    <div>Source: <span className="text-foreground">{test.actual.source}</span></div>
                    <div>Path: <span className="text-foreground">{test.actual.path.join(' → ') || '—'}</span></div>
                    <div>LLM: <span className={test.actual.llmCalled ? 'text-warning' : 'text-success'}>
                      {test.actual.llmCalled ? 'Called' : 'Not Called'}
                    </span></div>
                    <div>Confidence: <span className="text-foreground">{test.actual.confidence}%</span></div>
                    <div>Providers: <span className="text-foreground">{test.actual.providersQueried.join(', ') || '—'}</span></div>
                    <div>Time: <span className="text-foreground">{test.actual.elapsedMs}ms</span></div>
                  </div>
                </div>
              </div>

              {/* Actual Answer */}
              <div>
                <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Actual Answer</span>
                <p className="mt-0.5 rounded bg-background/50 p-1.5 text-[10px] text-foreground">
                  {test.actual.answer || '—'}
                </p>
              </div>

              {/* Failures */}
              {test.failures.length > 0 && (
                <div>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-error">Failures</span>
                  <div className="mt-0.5 space-y-0.5">
                    {test.failures.map((f, i) => (
                      <div key={i} className="flex items-start gap-1.5 rounded bg-error/5 p-1.5 text-[10px] text-error">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>{f}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function formatSource(source: string | string[]): string {
  if (Array.isArray(source)) return source.join(' | ');
  return source;
}
