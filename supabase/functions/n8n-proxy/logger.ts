// Structured logger for the n8n-proxy edge function.
// Writes JSON lines to stdout so Supabase's log viewer can parse them.
// Never logs secrets or request bodies — only action, duration, status.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  module: string;
  action: string;
  message: string;
  durationMs?: number;
  workflowName?: string;
  status?: string;
  error?: string;
  [key: string]: unknown;
}

function emit(entry: LogEntry): void {
  console.log(JSON.stringify(entry));
}

export const n8nLog = {
  debug(action: string, message: string, extra: Partial<LogEntry> = {}) {
    emit({ level: 'debug', module: 'n8n-proxy', action, message, ...extra });
  },
  info(action: string, message: string, extra: Partial<LogEntry> = {}) {
    emit({ level: 'info', module: 'n8n-proxy', action, message, ...extra });
  },
  warn(action: string, message: string, extra: Partial<LogEntry> = {}) {
    emit({ level: 'warn', module: 'n8n-proxy', action, message, ...extra });
  },
  error(action: string, message: string, extra: Partial<LogEntry> = {}) {
    emit({ level: 'error', module: 'n8n-proxy', action, message, ...extra });
  },
};
