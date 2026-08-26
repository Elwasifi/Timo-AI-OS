'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Play, Pause, Plus, Clock, Layers, AlertCircle, Trash2, Download,
  Loader2, RefreshCw, FileCode, CheckCircle2, XCircle, Activity, Webhook,
} from 'lucide-react';
import { AppShell } from '@/components/temo/app-shell';
import { useSystemStore } from '@/stores/systemStore';
import { useToast } from '@/hooks/use-toast';
import { n8n, type N8nWorkflow, type N8nExecution, type N8nExecutionList } from '@/services/n8n';
import { logger } from '@/lib/utils/logger';
import { cn } from '@/lib/utils';

type Tab = 'workflows' | 'executions';

export default function WorkflowsPage() {
  const [tab, setTab] = useState<Tab>('workflows');
  const addEvent = useSystemStore((s) => s.addEvent);
  const { toast } = useToast();

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display-lg text-headline-md font-bold tracking-tight text-primary-fixed-dim">Workflows</h1>
            <p className="font-label-caps text-label-caps text-on-surface-variant uppercase">Browse, execute, and manage your n8n workflows</p>
          </div>
        </div>

        <div className="flex gap-1 rounded-xl border border-border/40 bg-white/[0.02] p-1">
          <TabButton active={tab === 'workflows'} onClick={() => setTab('workflows')} icon={Layers} label="Workflows" />
          <TabButton active={tab === 'executions'} onClick={() => setTab('executions')} icon={Activity} label="Execution History" />
        </div>

        {tab === 'workflows' && <WorkflowsPanel addEvent={addEvent} toast={toast} />}
        {tab === 'executions' && <ExecutionsPanel addEvent={addEvent} toast={toast} />}
      </div>
    </AppShell>
  );
}

function TabButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof Layers; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
        active ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

// ---- Workflows Panel ----

function WorkflowsPanel({ addEvent, toast }: { addEvent: (e: { message: string; type: 'info' | 'error' | 'success' }) => void; toast: (opts: { title: string; description?: string; variant?: 'default' | 'destructive' }) => void }) {
  const [workflows, setWorkflows] = useState<N8nWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      logger.system('Loading n8n workflows');
      const data = await n8n.workflows.list();
      setWorkflows(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load workflows';
      setError(msg);
      logger.error('Failed to load workflows', { error: msg });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAction = async (workflow: N8nWorkflow, action: string, fn: () => Promise<unknown>) => {
    setActionLoading(`${workflow.id}-${action}`);
    try {
      const result = await fn();
      addEvent({ message: `Workflow "${workflow.name}" — ${action}`, type: 'success' });
      toast({ title: `Workflow ${action}`, description: `"${workflow.name}" ${action} successfully` });
      logger.system(`n8n workflow ${action}`, { workflowId: workflow.id, workflowName: workflow.name });
      await load();
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : `${action} failed`;
      addEvent({ message: `Workflow "${workflow.name}" — ${action} failed`, type: 'error' });
      toast({ title: `${action} failed`, description: msg, variant: 'destructive' });
      logger.error(`n8n workflow ${action} failed`, { workflowId: workflow.id, error: msg });
    } finally {
      setActionLoading(null);
    }
  };

  const handleExecute = (w: N8nWorkflow) => handleAction(w, 'triggered', () => n8n.executions.trigger(w.id));
  const handleActivate = (w: N8nWorkflow) => handleAction(w, 'activated', () => n8n.workflows.activate(w.id));
  const handleDeactivate = (w: N8nWorkflow) => handleAction(w, 'deactivated', () => n8n.workflows.deactivate(w.id));
  const handleDelete = (w: N8nWorkflow) => handleAction(w, 'deleted', () => n8n.workflows.delete(w.id));
  const handleConvert = (w: N8nWorkflow) => handleAction(w, 'converted', () => n8n.workflows.convertToWebhook(w.id));

  const handleExport = async (w: N8nWorkflow) => {
    setActionLoading(`${w.id}-exported`);
    try {
      const data = await n8n.workflows.export(w.id);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${w.name.replace(/\s+/g, '-')}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: 'Workflow exported', description: `"${w.name}" downloaded as JSON` });
      logger.system('n8n workflow exported', { workflowId: w.id, workflowName: w.name });
    } catch (err) {
      toast({ title: 'Export failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setActionLoading(null);
    }
  };

  const stats = {
    total: workflows.length,
    active: workflows.filter((w) => w.active).length,
    inactive: workflows.filter((w) => !w.active).length,
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Total" value={stats.total} icon={Layers} color="text-primary" />
        <StatCard label="Active" value={stats.active} icon={CheckCircle2} color="text-success" />
        <StatCard label="Inactive" value={stats.inactive} icon={Pause} color="text-muted-foreground" />
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-border/40 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && workflows.length === 0 && (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading workflows from n8n...
        </div>
      )}

      {/* Empty */}
      {!loading && workflows.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <FileCode className="mb-3 h-10 w-10 text-muted-foreground/50" />
          <p className="text-sm font-medium text-muted-foreground">No workflows found</p>
          <p className="text-xs text-muted-foreground/70">Connect to n8n in Settings to see your workflows</p>
        </div>
      )}

      {/* Workflow list */}
      <div className="space-y-3">
        {workflows.map((w, i) => (
          <motion.div
            key={w.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            className={cn(
              'glass-panel rounded-2xl p-5 transition-colors',
              w.active ? 'border-success/20' : '',
            )}
          >
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <span className={cn('h-2.5 w-2.5 rounded-full', w.active ? 'bg-success' : 'bg-muted-foreground')} />
                <div>
                  <h3 className="font-headline-md text-base font-semibold text-on-surface">{w.name}</h3>
                  <p className="font-data-point text-xs text-on-surface-variant">
                    {w.active ? 'Active' : 'Inactive'}
                    {w.updatedAt && ` · Updated ${new Date(w.updatedAt).toLocaleDateString()}`}
                    {w.nodes && ` · ${w.nodes.length} nodes`}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <ActionButton
                  icon={Play}
                  label="Execute"
                  loading={actionLoading === `${w.id}-triggered`}
                  onClick={() => handleExecute(w)}
                  color="text-primary"
                />
                <ActionButton
                  icon={Webhook}
                  label="Convert"
                  loading={actionLoading === `${w.id}-converted`}
                  onClick={() => handleConvert(w)}
                  color="text-secondary"
                />
                {w.active ? (
                  <ActionButton
                    icon={Pause}
                    label="Deactivate"
                    loading={actionLoading === `${w.id}-deactivated`}
                    onClick={() => handleDeactivate(w)}
                    color="text-warning"
                  />
                ) : (
                  <ActionButton
                    icon={CheckCircle2}
                    label="Activate"
                    loading={actionLoading === `${w.id}-activated`}
                    onClick={() => handleActivate(w)}
                    color="text-success"
                  />
                )}
                <ActionButton
                  icon={Download}
                  label="Export"
                  loading={actionLoading === `${w.id}-exported`}
                  onClick={() => handleExport(w)}
                  color="text-secondary"
                />
                <ActionButton
                  icon={Trash2}
                  label="Delete"
                  loading={actionLoading === `${w.id}-deleted`}
                  onClick={() => handleDelete(w)}
                  color="text-destructive"
                />
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ---- Executions Panel ----

function ExecutionsPanel({ addEvent, toast }: { addEvent: (e: { message: string; type: 'info' | 'error' | 'success' }) => void; toast: (opts: { title: string; description?: string; variant?: 'default' | 'destructive' }) => void }) {
  const [executions, setExecutions] = useState<N8nExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const load = useCallback(async () => {
    try {
      const result: N8nExecutionList = await n8n.executions.listExecutions(20);
      setExecutions(result.data);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load executions';
      if (loading) setError(msg);
      logger.error('Failed to load executions', { error: msg });
    } finally {
      setLoading(false);
    }
  }, [loading]);

  useEffect(() => {
    load();
    if (!autoRefresh) return;
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load, autoRefresh]);

  const stats = {
    total: executions.length,
    running: executions.filter((e) => e.status === 'running').length,
    waiting: executions.filter((e) => e.status === 'waiting').length,
    success: executions.filter((e) => e.status === 'success').length,
    failed: executions.filter((e) => e.status === 'error').length,
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Total" value={stats.total} icon={Activity} color="text-primary" />
        <StatCard label="Running" value={stats.running} icon={Loader2} color="text-primary" />
        <StatCard label="Waiting" value={stats.waiting} icon={Clock} color="text-warning" />
        <StatCard label="Success" value={stats.success} icon={CheckCircle2} color="text-success" />
        <StatCard label="Failed" value={stats.failed} icon={XCircle} color="text-destructive" />
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setAutoRefresh(!autoRefresh)}
          className={cn(
            'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors',
            autoRefresh ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border/40 text-muted-foreground hover:text-foreground',
          )}
        >
          <span className={cn('h-2 w-2 rounded-full', autoRefresh ? 'bg-primary animate-pulse' : 'bg-muted-foreground')} />
          Auto-refresh {autoRefresh ? 'ON' : 'OFF'}
        </button>
        <button
          onClick={load}
          className="flex items-center gap-2 rounded-lg border border-border/40 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh now
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && executions.length === 0 && (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading execution history...
        </div>
      )}

      {/* Empty */}
      {!loading && executions.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Activity className="mb-3 h-10 w-10 text-muted-foreground/50" />
          <p className="text-sm font-medium text-muted-foreground">No executions yet</p>
          <p className="text-xs text-muted-foreground/70">Execute a workflow to see its history here</p>
        </div>
      )}

      {/* Execution list */}
      <div className="space-y-2">
        {executions.map((e, i) => {
          const duration = e.startedAt && e.stoppedAt
            ? new Date(e.stoppedAt).getTime() - new Date(e.startedAt).getTime()
            : null;
          return (
            <motion.div
              key={e.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className="glass-panel rounded-xl p-4"
            >
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-3">
                  <StatusIcon status={e.status} />
                  <div>
                    <p className="font-data-point text-sm font-medium text-on-surface">Execution #{e.id}</p>
                    <p className="font-data-point text-xs text-on-surface-variant">
                      {e.mode ?? 'manual'} mode
                      {e.startedAt && ` · Started ${new Date(e.startedAt).toLocaleString()}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  {duration !== null && (
                    <div>
                      <span className="text-muted-foreground">Duration</span>
                      <p className="font-medium tabular-nums">{duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(1)}s`}</p>
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground">Status</span>
                    <p className={cn('font-medium capitalize', statusColor(e.status))}>{e.status}</p>
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ---- Helpers ----

function StatCard({ label, value, icon: Icon, color }: { label: string; value: number; icon: typeof Layers; color: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      className="glass-panel rounded-xl p-4"
    >
      <div className="flex items-center justify-between">
        <span className="font-label-caps text-label-caps text-on-surface-variant">{label}</span>
        <Icon className={cn('h-4 w-4', color)} />
      </div>
      <div className="mt-2 font-display-lg text-2xl font-bold tabular-nums text-on-surface">{value}</div>
    </motion.div>
  );
}

function ActionButton({ icon: Icon, label, loading, onClick, color }: { icon: typeof Play; label: string; loading: boolean; onClick: () => void; color: string }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      title={label}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/5 disabled:opacity-50"
    >
      {loading ? <Loader2 className={cn('h-4 w-4 animate-spin', color)} /> : <Icon className={cn('h-4 w-4', color)} />}
    </button>
  );
}

function StatusIcon({ status }: { status: N8nExecution['status'] }) {
  switch (status) {
    case 'running':
      return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
    case 'waiting':
      return <Clock className="h-4 w-4 text-warning" />;
    case 'success':
      return <CheckCircle2 className="h-4 w-4 text-success" />;
    case 'error':
      return <XCircle className="h-4 w-4 text-destructive" />;
    default:
      return <Activity className="h-4 w-4 text-muted-foreground" />;
  }
}

function statusColor(status: N8nExecution['status']): string {
  switch (status) {
    case 'running': return 'text-primary';
    case 'waiting': return 'text-warning';
    case 'success': return 'text-success';
    case 'error': return 'text-destructive';
    default: return 'text-muted-foreground';
  }
}
