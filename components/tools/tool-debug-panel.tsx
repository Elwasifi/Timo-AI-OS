'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bug, X, ChevronDown, ChevronRight, Activity, CheckCircle2, XCircle, Clock, Loader2, Brain, Database, Link2, Clock3, Network, Zap, FileText, Gauge } from 'lucide-react';
import { useToolStore } from '@/stores/toolStore';
import { useContextManagerStore } from '@/stores/contextManagerStore';
import { toolRegistry } from '@/lib/tools/registry';
import { toolExecutor } from '@/lib/tools/executor';
import { memory } from '@/lib/memory/memoryService';
import type { MemoryRecord } from '@/lib/memory/types';
import { cn } from '@/lib/utils';

export function ToolDebugPanel() {
  const { executions, debugPanelOpen, toggleDebugPanel } = useToolStore();
  const ctxManager = useContextManagerStore();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [memoryStats, setMemoryStats] = useState<{ total: number; byType: Record<string, number>; embeddings: number; links: number; events: number } | null>(null);
  const [memoryTab, setMemoryTab] = useState<'recent' | 'stats' | 'timeline'>('recent');

  useEffect(() => {
    if (!debugPanelOpen) return;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [debugPanelOpen]);

  useEffect(() => {
    if (!debugPanelOpen) return;
    memory.list({ limit: 20 }).then(setMemories).catch(() => {});
    memory.stats().then(setMemoryStats).catch(() => {});
  }, [debugPanelOpen, tick]);

  void tick;

  const registeredTools = toolRegistry.list();
  const activeCount = executions.filter((e) => e.status === 'running').length;

  return (
    <AnimatePresence>
      {debugPanelOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={toggleDebugPanel}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          />

          {/* Slide-over panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 32 }}
            className="fixed right-0 top-0 z-50 flex h-full w-[420px] max-w-[90vw] flex-col border-l border-border/40 bg-background/95 shadow-2xl backdrop-blur-xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
              <div className="flex items-center gap-2">
                <Bug className="h-4 w-4 text-primary" />
                <span className="font-grotesk text-sm font-semibold">Developer Tools</span>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                  {registeredTools.length} tools
                </span>
                {activeCount > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-background">
                    {activeCount}
                  </span>
                )}
              </div>
              <button onClick={toggleDebugPanel} className="text-muted-foreground transition-colors hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-3">
              {/* Context Manager Section */}
              <ContextManagerSection result={ctxManager.lastResult} isRunning={ctxManager.isRunning} />

              {/* Memory Engine Section */}
              <div className="mb-3">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <Brain className="h-3 w-3" /> Memory Engine
                  </h4>
                  {memoryStats && (
                    <span className="text-[10px] text-muted-foreground">
                      {memoryStats.total} memories · {memoryStats.embeddings} embeddings
                    </span>
                  )}
                </div>
                <div className="flex gap-1 mb-2">
                  {(['recent', 'stats', 'timeline'] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setMemoryTab(tab)}
                      className={cn(
                        'rounded px-2 py-0.5 text-[10px] capitalize transition-colors',
                        memoryTab === tab ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
                {memoryTab === 'recent' && (
                  <div className="space-y-1">
                    {memories.length === 0 && <p className="py-2 text-center text-[10px] text-muted-foreground">No memories stored yet</p>}
                    {memories.map((m) => (
                      <div key={m.id} className="rounded-lg border border-border/30 bg-white/[0.02] px-2 py-1.5">
                        <div className="flex items-center justify-between">
                          <span className="truncate text-[11px] font-medium">{m.title}</span>
                          <span className={cn(
                            'rounded px-1 text-[9px] font-mono',
                            m.importance === 'critical' ? 'bg-destructive/10 text-destructive' :
                            m.importance === 'high' ? 'bg-warning/10 text-warning' :
                            m.importance === 'temporary' ? 'bg-muted text-muted-foreground' :
                            'bg-primary/10 text-primary',
                          )}>{m.importance}</span>
                        </div>
                        <div className="text-[9px] text-muted-foreground">
                          {m.type} · {m.tags.join(', ') || 'no tags'} · {new Date(m.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {memoryTab === 'stats' && memoryStats && (
                  <div className="space-y-1 text-[10px]">
                    <div className="flex justify-between"><span className="text-muted-foreground">Total Memories</span><span className="font-mono text-foreground">{memoryStats.total}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Embeddings</span><span className="font-mono text-foreground">{memoryStats.embeddings}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Knowledge Links</span><span className="font-mono text-foreground">{memoryStats.links}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Timeline Events</span><span className="font-mono text-foreground">{memoryStats.events}</span></div>
                    <div className="pt-1 border-t border-border/20">
                      <div className="text-muted-foreground mb-1">By Type:</div>
                      {Object.entries(memoryStats.byType).map(([type, count]) => (
                        <div key={type} className="flex justify-between"><span className="text-muted-foreground">{type}</span><span className="font-mono text-foreground">{count}</span></div>
                      ))}
                    </div>
                  </div>
                )}
                {memoryTab === 'timeline' && (
                  <TimelineTab />
                )}
              </div>

              {/* Registered tools */}
              <div className="mb-3">
                <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Registered Tools</h4>
                <div className="space-y-1">
                  {registeredTools.map((t) => (
                    <div key={t.id} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-xs hover:bg-white/5">
                      <div className="flex items-center gap-2">
                        <span className={cn('h-1.5 w-1.5 rounded-full', t.status === 'active' ? 'bg-success' : t.status === 'beta' ? 'bg-warning' : 'bg-muted-foreground')} />
                        <span className="font-mono text-[11px]">{t.id}</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground">{t.category}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Active + recent executions */}
              <div>
                <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Executions ({executions.length})
                </h4>
                {executions.length === 0 && (
                  <p className="py-4 text-center text-xs text-muted-foreground">No tool executions yet</p>
                )}
                <div className="space-y-1">
                  {executions.slice(0, 20).map((ex) => (
                    <div key={ex.requestId} className="rounded-lg border border-border/30 bg-white/[0.02]">
                      <button
                        onClick={() => setExpanded(expanded === ex.requestId ? null : ex.requestId)}
                        className="flex w-full items-center justify-between px-2 py-2 text-xs"
                      >
                        <div className="flex items-center gap-2">
                          {expanded === ex.requestId ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                          <StatusIcon status={ex.status} />
                          <span className="font-mono text-[11px]">{ex.toolId}</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground">
                          {ex.durationMs ? `${ex.durationMs}ms` : '...'}
                        </span>
                      </button>
                      <AnimatePresence>
                        {expanded === ex.requestId && (
                          <motion.div
                            initial={{ height: 0 }}
                            animate={{ height: 'auto' }}
                            exit={{ height: 0 }}
                            className="overflow-hidden border-t border-border/20 px-2 py-2"
                          >
                            <div className="space-y-1 text-[10px] text-muted-foreground">
                              <div>Agent: <span className="text-foreground">{ex.agentId}</span></div>
                              <div>Request: <span className="font-mono text-foreground">{ex.requestId}</span></div>
                              <div>Status: <span className={cn('font-medium', ex.status === 'success' ? 'text-success' : ex.status === 'error' ? 'text-destructive' : 'text-primary')}>{ex.status}</span></div>
                              {ex.result?.error && <div className="text-destructive">Error: {ex.result.error}</div>}
                              {ex.result?.retries !== undefined && ex.result.retries > 0 && <div>Retries: {ex.result.retries}</div>}
                              <div className="mt-1">
                                <span className="text-muted-foreground">Events:</span>
                                <div className="mt-1 space-y-0.5">
                                  {ex.events.map((ev, i) => (
                                    <div key={i} className="flex gap-2">
                                      <span className="text-muted-foreground/60">{new Date(ev.timestamp).toLocaleTimeString()}</span>
                                      <span className="text-foreground/80">{ev.type}:</span>
                                      <span className="text-muted-foreground">{ev.detail}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="border-t border-border/40 px-4 py-2 text-[10px] text-muted-foreground">
              {activeCount} running · {executions.length} total · {toolExecutor.getActive().length} active handles
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'running': return <Loader2 className="h-3 w-3 animate-spin text-primary" />;
    case 'success': return <CheckCircle2 className="h-3 w-3 text-success" />;
    case 'error': return <XCircle className="h-3 w-3 text-destructive" />;
    case 'cancelled': return <Clock className="h-3 w-3 text-warning" />;
    default: return <Activity className="h-3 w-3 text-muted-foreground" />;
  }
}

function TimelineTab() {
  const [events, setEvents] = useState<Array<{ id: string; eventType: string; eventTitle: string; createdAt: string; severity: string }>>([]);

  useEffect(() => {
    memory.timeline({ limit: 15 }).then((e) => setEvents(e as Array<{ id: string; eventType: string; eventTitle: string; createdAt: string; severity: string }>)).catch(() => {});
  }, []);

  if (events.length === 0) return <p className="py-2 text-center text-[10px] text-muted-foreground">No events yet</p>;

  return (
    <div className="space-y-1">
      {events.map((e) => (
        <div key={e.id} className="flex items-start gap-1.5">
          <Clock3 className="h-2.5 w-2.5 mt-0.5 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <div className="truncate text-[10px] font-medium">{e.eventTitle}</div>
            <div className="text-[9px] text-muted-foreground">{e.eventType} · {new Date(e.createdAt).toLocaleString()}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ContextManagerSection({ result, isRunning }: { result: import('@/lib/context/types').ContextManagerResult | null; isRunning: boolean }) {
  if (isRunning) {
    return (
      <div className="mb-3">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1 mb-2">
          <Network className="h-3 w-3" /> Context Manager
        </h4>
        <div className="flex items-center gap-2 py-2">
          <Loader2 className="h-3 w-3 animate-spin text-primary" />
          <span className="text-[10px] text-muted-foreground">Running reasoning pipeline...</span>
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="mb-3">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1 mb-2">
          <Network className="h-3 w-3" /> Context Manager
        </h4>
        <p className="py-2 text-center text-[10px] text-muted-foreground">No requests processed yet</p>
      </div>
    );
  }

  const m = result.context.metadata;

  return (
    <div className="mb-3">
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1 mb-2">
        <Network className="h-3 w-3" /> Context Manager
      </h4>

      {/* Source badge */}
      <div className="flex items-center gap-1 mb-2">
        <span className={cn(
          'rounded px-1.5 py-0.5 text-[9px] font-mono uppercase',
          m.source === 'memory' ? 'bg-success/10 text-success' :
          m.source === 'tool' ? 'bg-primary/10 text-primary' :
          m.source === 'rag' ? 'bg-warning/10 text-warning' :
          m.source === 'hybrid' ? 'bg-accent/10 text-accent' :
          'bg-muted text-muted-foreground',
        )}>
          {m.source}
        </span>
        {!result.shouldCallLLM && (
          <span className="rounded bg-success/10 px-1.5 py-0.5 text-[9px] font-mono text-success">
            NO LLM CALL
          </span>
        )}
      </div>

      {/* Intent */}
      <div className="rounded-lg border border-border/30 bg-white/[0.02] px-2 py-1.5 mb-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium flex items-center gap-1"><Zap className="h-2.5 w-2.5" /> Intent</span>
          <span className="text-[9px] font-mono text-muted-foreground">{m.intent}</span>
        </div>
      </div>

      {/* Memory Search */}
      <div className="rounded-lg border border-border/30 bg-white/[0.02] px-2 py-1.5 mb-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium flex items-center gap-1"><Brain className="h-2.5 w-2.5" /> Memory Search</span>
          <span className={cn('text-[9px] font-mono', m.memorySearch ? 'text-primary' : 'text-muted-foreground')}>
            {m.memorySearch ? `${m.retrievedMemories} found` : 'skipped'}
          </span>
        </div>
      </div>

      {/* Memory Classification */}
      {m.memoryClassification && (
        <div className="rounded-lg border border-border/30 bg-white/[0.02] px-2 py-1.5 mb-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium flex items-center gap-1"><Database className="h-2.5 w-2.5" /> Memory Classification</span>
            <span className="text-[9px] font-mono text-primary">{m.memoryClassification}</span>
          </div>
        </div>
      )}

      {/* Memory Match Score */}
      {m.memorySearch && (
        <div className="rounded-lg border border-border/30 bg-white/[0.02] px-2 py-1.5 mb-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium">Memory Match Score</span>
            <span className={cn(
              'text-[9px] font-mono',
              m.confidenceScore >= 0.75 ? 'text-success' :
              m.confidenceScore >= 0.55 ? 'text-warning' :
              'text-destructive',
            )}>{(m.confidenceScore * 100).toFixed(0)}%</span>
          </div>
        </div>
      )}

      {/* Memory Decision Reason */}
      {m.memoryDecisionReason && (
        <div className="rounded-lg border border-border/30 bg-white/[0.02] px-2 py-1.5 mb-1">
          <span className="text-[10px] font-medium block mb-0.5">Memory Decision</span>
          <span className="text-[9px] text-muted-foreground">{m.memoryDecisionReason}</span>
        </div>
      )}

      {/* Tool Decision Reason */}
      {m.toolDecisionReason && (
        <div className="rounded-lg border border-border/30 bg-white/[0.02] px-2 py-1.5 mb-1">
          <span className="text-[10px] font-medium block mb-0.5">Tool Decision</span>
          <span className="text-[9px] text-muted-foreground">{m.toolDecisionReason}</span>
        </div>
      )}

      {/* LLM Skip Reason */}
      {!result.shouldCallLLM && m.llmSkipReason && (
        <div className="rounded-lg border border-success/20 bg-success/5 px-2 py-1.5 mb-1">
          <span className="text-[10px] font-medium block mb-0.5 text-success">LLM Skipped</span>
          <span className="text-[9px] text-success/80">{m.llmSkipReason}</span>
        </div>
      )}

      {/* Tools Executed */}
      {m.toolsExecuted.length > 0 && (
        <div className="rounded-lg border border-border/30 bg-white/[0.02] px-2 py-1.5 mb-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium flex items-center gap-1"><Zap className="h-2.5 w-2.5" /> Tools Executed</span>
            <span className="text-[9px] font-mono text-primary">{m.toolResults}/{m.toolsExecuted.length} ok</span>
          </div>
          <div className="mt-1 space-y-0.5">
            {m.toolsExecuted.map((t, i) => (
              <div key={i} className="text-[9px] font-mono text-muted-foreground truncate">{t}</div>
            ))}
          </div>
        </div>
      )}

      {/* RAG Documents */}
      {m.ragDocuments > 0 && (
        <div className="rounded-lg border border-border/30 bg-white/[0.02] px-2 py-1.5 mb-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium flex items-center gap-1"><FileText className="h-2.5 w-2.5" /> RAG Documents</span>
            <span className="text-[9px] font-mono text-primary">{m.ragDocuments}</span>
          </div>
        </div>
      )}

      {/* Workflow */}
      {m.workflowSelected && (
        <div className="rounded-lg border border-border/30 bg-white/[0.02] px-2 py-1.5 mb-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium flex items-center gap-1"><Clock3 className="h-2.5 w-2.5" /> Workflow</span>
            <span className="text-[9px] font-mono text-primary">used</span>
          </div>
        </div>
      )}

      {/* Prompt Size */}
      <div className="rounded-lg border border-border/30 bg-white/[0.02] px-2 py-1.5 mb-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium flex items-center gap-1"><Gauge className="h-2.5 w-2.5" /> Prompt Size</span>
          <span className="text-[9px] font-mono text-muted-foreground">{m.promptSize} chars</span>
        </div>
      </div>

      {/* Confidence */}
      <div className="rounded-lg border border-border/30 bg-white/[0.02] px-2 py-1.5 mb-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium">Confidence</span>
          <span className={cn(
            'text-[9px] font-mono',
            m.confidenceScore >= 0.75 ? 'text-success' :
            m.confidenceScore >= 0.5 ? 'text-warning' :
            'text-muted-foreground',
          )}>{(m.confidenceScore * 100).toFixed(0)}%</span>
        </div>
      </div>

      {/* Final Agent */}
      <div className="rounded-lg border border-border/30 bg-white/[0.02] px-2 py-1.5 mb-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium">Final Agent</span>
          <span className="text-[9px] font-mono text-primary">{m.finalAgent}</span>
        </div>
      </div>

      {/* Reasoning Path */}
      <div className="rounded-lg border border-border/30 bg-white/[0.02] px-2 py-1.5 mb-1">
        <span className="text-[10px] font-medium block mb-0.5">Reasoning Path</span>
        <span className="text-[9px] font-mono text-muted-foreground">{m.reasoningPath}</span>
      </div>

      {/* Reasoning Timeline */}
      <div className="mt-2">
        <span className="text-[10px] font-medium block mb-1">Reasoning Timeline</span>
        <div className="space-y-0.5">
          {m.reasoningTimeline.map((step) => (
            <div key={step.id} className="flex items-start gap-1.5">
              {step.status === 'completed' && <CheckCircle2 className="h-2.5 w-2.5 mt-0.5 text-success shrink-0" />}
              {step.status === 'active' && <Loader2 className="h-2.5 w-2.5 mt-0.5 animate-spin text-primary shrink-0" />}
              {step.status === 'skipped' && <XCircle className="h-2.5 w-2.5 mt-0.5 text-muted-foreground shrink-0" />}
              {step.status === 'error' && <XCircle className="h-2.5 w-2.5 mt-0.5 text-destructive shrink-0" />}
              {step.status === 'pending' && <Clock className="h-2.5 w-2.5 mt-0.5 text-muted-foreground shrink-0" />}
              <div className="min-w-0">
                <div className="truncate text-[10px] font-medium">{step.label}</div>
                <div className="text-[9px] text-muted-foreground">{step.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
