'use client';

import { motion } from 'framer-motion';
import { ClientTime } from '@/components/temo/client-time';
import { cn } from '@/lib/utils';

export type TimelineEvent = {
  id: string;
  label: string;
  detail?: string;
  timestamp: number;
  status: 'completed' | 'active' | 'error' | 'pending';
  color?: string;
};

export function Timeline({ events, className }: { events: TimelineEvent[]; className?: string }) {
  if (events.length === 0) {
    return (
      <div className="py-8 text-center font-mono text-xs text-temo-titanium/50">
        No events recorded
      </div>
    );
  }

  return (
    <div className={cn('space-y-0', className)}>
      {events.map((event, i) => {
        const color = event.color ?? (event.status === 'error' ? '#EF4444' : event.status === 'active' ? '#F97316' : event.status === 'completed' ? '#10B981' : '#94A3B8');
        return (
          <motion.div
            key={event.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.03 }}
            className="relative flex gap-4 pb-6"
          >
            {/* Axis line */}
            {i < events.length - 1 && (
              <div
                className="absolute left-[7px] top-4 bottom-0 w-px"
                style={{ background: `linear-gradient(to bottom, ${color}40, transparent)` }}
              />
            )}

            {/* Node point */}
            <div className="relative shrink-0">
              <span
                className={cn('block h-3.5 w-3.5 rounded-full border-2', event.status === 'active' && 'animate-pulse')}
                style={{ backgroundColor: event.status === 'pending' ? 'transparent' : color, borderColor: color, boxShadow: event.status === 'active' ? `0 0 8px ${color}` : 'none' }}
              />
              {event.status === 'active' && (
                <motion.span
                  className="absolute inset-0 rounded-full"
                  style={{ border: `1px solid ${color}` }}
                  animate={{ scale: [1, 2.5], opacity: [0.5, 0] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
                />
              )}
            </div>

            {/* Event card */}
            <div className="flex-1 pt-0.5">
              <div className="font-mono text-[11px] text-temo-cyan/70">
                <ClientTime ts={event.timestamp} fmt="time-seconds" />
              </div>
              <div className="font-sans text-sm font-medium text-temo-led">{event.label}</div>
              {event.detail && <div className="mt-0.5 font-mono text-[11px] text-temo-titanium">{event.detail}</div>}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
