'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

export type ActivityItem = {
  id: string;
  title: string;
  detail?: string;
  timestamp: number;
  type: 'info' | 'success' | 'warning' | 'error';
  department?: string;
};

const TYPE_COLORS: Record<ActivityItem['type'], string> = {
  info: '#00F3FF',
  success: '#10B981',
  warning: '#F97316',
  error: '#EF4444',
};

function formatTime(ts: number): string {
  if (!ts) return '--:--';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function Timestamp({ ts }: { ts: number }) {
  const [display, setDisplay] = useState('--:--');

  useEffect(() => {
    setDisplay(formatTime(ts));
  }, [ts]);

  return (
    <span className="shrink-0 font-mono text-[10px] text-temo-titanium/60">
      {display}
    </span>
  );
}

export function ActivityFeed({ items, className, maxItems = 50 }: { items: ActivityItem[]; className?: string; maxItems?: number }) {
  const visible = items.slice(0, maxItems);

  if (visible.length === 0) {
    return (
      <div className="py-8 text-center font-mono text-xs text-temo-titanium/50">
        No live activity
      </div>
    );
  }

  return (
    <div className={cn('space-y-1', className)}>
      <AnimatePresence initial={false}>
        {visible.map((item) => {
          const color = TYPE_COLORS[item.type];
          return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="group flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-temo-cyan/5"
            >
              <span
                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: color, boxShadow: `0 0 4px ${color}` }}
              />
              <div className="flex-1 min-w-0">
                <p className="truncate font-mono text-xs text-temo-led">{item.title}</p>
                {item.detail && <p className="truncate font-mono text-[10px] text-temo-titanium">{item.detail}</p>}
              </div>
              <Timestamp ts={item.timestamp} />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
