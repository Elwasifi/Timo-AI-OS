type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogCategory = 'voice' | 'ai' | 'provider' | 'routing' | 'error' | 'system' | 'n8n';

interface LogEntry {
  level: LogLevel;
  category: LogCategory;
  message: string;
  data?: unknown;
  timestamp: number;
}

const LOG_PREFIX = '[TemoOS]';

const categoryColors: Record<LogCategory, string> = {
  voice: '#00E5FF',
  ai: '#22C55E',
  provider: '#F59E0B',
  routing: '#7B61FF',
  error: '#EF4444',
  system: '#6B7280',
  n8n: '#FF6D5A',
};

const log = (level: LogLevel, category: LogCategory, message: string, data?: unknown) => {
  const entry: LogEntry = { level, category, message, data, timestamp: Date.now() };
  const color = categoryColors[category];
  const prefix = `${LOG_PREFIX}%c[${category}]`;
  const style = `color:${color};font-weight:bold`;

  if (level === 'error') {
    console.error(prefix, style, message, data ?? '');
  } else if (level === 'warn') {
    console.warn(prefix, style, message, data ?? '');
  } else if (process.env.NODE_ENV === 'development') {
    console.log(prefix, style, message, data ?? '');
  }

  return entry;
};

export const logger = {
  voice: (message: string, data?: unknown) => log('info', 'voice', message, data),
  voiceDebug: (message: string, data?: unknown) => log('debug', 'voice', message, data),
  voiceWarn: (message: string, data?: unknown) => log('warn', 'voice', message, data),

  ai: (message: string, data?: unknown) => log('info', 'ai', message, data),
  aiDebug: (message: string, data?: unknown) => log('debug', 'ai', message, data),
  aiWarn: (message: string, data?: unknown) => log('warn', 'ai', message, data),

  provider: (message: string, data?: unknown) => log('info', 'provider', message, data),
  providerWarn: (message: string, data?: unknown) => log('warn', 'provider', message, data),
  providerSwitch: (from: string, to: string, reason: string) =>
    log('warn', 'provider', `Switching provider: ${from} → ${to} (${reason})`),

  routing: (message: string, data?: unknown) => log('info', 'routing', message, data),
  routingDebug: (message: string, data?: unknown) => log('debug', 'routing', message, data),

  error: (message: string, data?: unknown) => log('error', 'error', message, data),
  system: (message: string, data?: unknown) => log('info', 'system', message, data),

  n8n: (message: string, data?: unknown) => log('info', 'n8n', message, data),
  n8nDebug: (message: string, data?: unknown) => log('debug', 'n8n', message, data),
  n8nWarn: (message: string, data?: unknown) => log('warn', 'n8n', message, data),
};
