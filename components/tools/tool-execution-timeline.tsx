'use client';

import { motion } from 'framer-motion';
import { Wrench, CheckCircle2, XCircle, Loader2, Clock, AlertCircle, Webhook, Zap } from 'lucide-react';
import { useToolStore } from '@/stores/toolStore';
import { cn } from '@/lib/utils';
import type { TriggerResult } from '@/services/n8n';

export function ToolExecutionTimeline() {
  const executions = useToolStore((s) => s.executions);

  if (executions.length === 0) return null;

  return (
    <div className="space-y-2">
      {executions.slice(0, 10).map((ex) => {
        const triggerData = ex.result?.data as TriggerResult | undefined;
        const isTrigger = ex.toolId.startsWith('n8n.trigger') || ex.toolId === 'n8n.convertToWebhook';
        return (
          <motion.div
            key={ex.requestId}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            className="rounded-lg border border-border/30 bg-white/[0.02] px-3 py-2"
          >
            <div className="flex items-center gap-3">
              <ToolStatusIcon status={ex.status} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {isTrigger ? (
                    <Zap className="h-3 w-3 text-primary" />
                  ) : (
                    <Wrench className="h-3 w-3 text-muted-foreground" />
                  )}
                  <span className="truncate font-mono text-xs">{ex.toolId}</span>
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {ex.agentId} · {ex.durationMs ? `${ex.durationMs}ms` : 'running...'}
                  {ex.result?.retries ? ` · ${ex.result.retries} retries` : ''}
                </div>
              </div>
              <span className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-medium capitalize',
                ex.status === 'success' ? 'bg-success/10 text-success' :
                ex.status === 'error' ? 'bg-destructive/10 text-destructive' :
                ex.status === 'running' ? 'bg-primary/10 text-primary' :
                'bg-muted text-muted-foreground'
              )}>
                {ex.status}
              </span>
            </div>
            {triggerData && (
              <div className="mt-2 space-y-1 border-t border-border/20 pt-2">
                {triggerData.triggerType && (
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span className="font-medium">Trigger:</span>
                    <span className={cn(
                      'rounded px-1 py-0.5 font-mono',
                      triggerData.triggerType === 'webhook' ? 'bg-primary/10 text-primary' :
                      triggerData.triggerType === 'manual' ? 'bg-warning/10 text-warning' :
                      'bg-muted text-muted-foreground'
                    )}>
                      {triggerData.triggerType}
                    </span>
                  </div>
                )}
                {triggerData.webhookUrl && (
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <Webhook className="h-2.5 w-2.5" />
                    <span className="truncate font-mono">{triggerData.webhookUrl}</span>
                  </div>
                )}
                {triggerData.httpStatus !== null && (
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span className="font-medium">HTTP:</span>
                    <span className={cn(
                      'font-mono font-medium',
                      triggerData.httpStatus < 400 ? 'text-success' : 'text-destructive'
                    )}>
                      {triggerData.httpMethod} {triggerData.httpStatus}
                    </span>
                    <span className="text-muted-foreground/60">·</span>
                    <span>{triggerData.latencyMs}ms</span>
                  </div>
                )}
                {triggerData.message && (
                  <div className="text-[10px] text-warning">{triggerData.message}</div>
                )}
                {triggerData.payload !== null && triggerData.payload !== undefined && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground">
                      Response payload
                    </summary>
                    <pre className="mt-1 max-h-32 overflow-auto rounded bg-black/20 p-2 text-[9px] font-mono text-muted-foreground">
                      {typeof triggerData.payload === 'string'
                        ? triggerData.payload.slice(0, 500)
                        : JSON.stringify(triggerData.payload, null, 2)?.slice(0, 500)}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}

function ToolStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'running': return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
    case 'success': return <CheckCircle2 className="h-4 w-4 text-success" />;
    case 'error': return <XCircle className="h-4 w-4 text-destructive" />;
    case 'cancelled': return <Clock className="h-4 w-4 text-warning" />;
    default: return <AlertCircle className="h-4 w-4 text-muted-foreground" />;
  }
}
