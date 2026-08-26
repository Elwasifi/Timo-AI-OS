'use client';

import { useEffect, useState } from 'react';

type Format = 'relative' | 'time' | 'time-seconds' | 'datetime' | 'date';

function format(ts: number, fmt: Format): string {
  if (!ts) return '--:--';
  const d = new Date(ts);
  switch (fmt) {
    case 'relative':
      return relativeTime(ts);
    case 'time':
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    case 'time-seconds':
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    case 'datetime':
      return d.toLocaleString();
    case 'date':
      return d.toLocaleDateString();
  }
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 5000) return 'just now';
  if (diff < 60000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ClientTime({
  ts,
  fmt = 'time',
  className,
}: {
  ts: number | string | Date;
  fmt?: Format;
  className?: string;
}) {
  const numericTs = typeof ts === 'string' ? new Date(ts).getTime() : ts instanceof Date ? ts.getTime() : ts;
  const [display, setDisplay] = useState('');

  useEffect(() => {
    setDisplay(format(numericTs, fmt));
    if (fmt === 'relative') {
      const interval = setInterval(() => setDisplay(format(numericTs, fmt)), 10000);
      return () => clearInterval(interval);
    }
  }, [numericTs, fmt]);

  return <span className={className}>{display}</span>;
}
