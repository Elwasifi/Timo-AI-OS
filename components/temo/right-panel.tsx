'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Pin, Download, Filter } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useOrchestrationStore } from '@/stores/orchestrationStore';
import { ActivityFeed, type ActivityItem } from './activity-feed';
import { cn } from '@/lib/utils';

type Tab = 'diagnostics' | 'logs' | 'properties';

export function RightContextPanel() {
  const open = useUIStore((s) => s.rightSidebarOpen);
  const setOpen = useUIStore((s) => s.setRightSidebarOpen);
  const activityFeed = useOrchestrationStore((s) => s.activityFeed);
  const [tab, setTab] = useState<Tab>('logs');

  // On a phone-width viewport this panel is full-screen (see className
  // below) — defaulting it open would hide the page behind it on first
  // load. Desktop/tablet keep the existing default-open behavior.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 640) {
      setOpen(false);
    }
    // Deliberately runs once on mount only — this is an initial-viewport
    // check, not a resize listener (resizing the window mid-session
    // shouldn't yank the panel open/closed out from under the user).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const feedItems: ActivityItem[] = activityFeed.slice(0, 50).map((item) => ({
    id: item.id,
    title: item.title,
    detail: item.detail,
    timestamp: item.timestamp,
    type: item.type === 'error' ? 'error' : item.type === 'notification' ? 'warning' : 'info',
  }));

  if (!open) return null;

  return (
    <motion.aside
      initial={{ x: 380, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 380, opacity: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="fixed right-0 top-16 bottom-0 z-30 flex w-full flex-col border-l border-temo-blue/25 bg-[rgba(6,20,32,0.45)] backdrop-blur-md sm:w-[360px]"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-temo-cyan/10 px-4 py-3">
        <div className="flex gap-1">
          {(['diagnostics', 'logs', 'properties'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'rounded-lg px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors',
                tab === t ? 'bg-temo-cyan/15 text-temo-cyan' : 'text-temo-titanium hover:text-temo-led',
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <button className="text-temo-titanium hover:text-temo-cyan"><Pin className="h-4 w-4" /></button>
          <button onClick={() => setOpen(false)} className="text-temo-titanium hover:text-temo-cyan"><X className="h-4 w-4" /></button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'logs' && (
          <div>
            <div className="mb-3 flex items-center gap-2">
              <Filter className="h-3 w-3 text-temo-titanium" />
              <span className="font-mono text-[10px] uppercase tracking-wider text-temo-titanium">Live Activity Stream</span>
            </div>
            <ActivityFeed items={feedItems} />
          </div>
        )}
        {tab === 'diagnostics' && (
          <div className="space-y-3">
            <div className="temo-glass rounded-xl p-3">
              <span className="font-mono text-[10px] uppercase tracking-wider text-temo-titanium">System Health</span>
              <div className="mt-2 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-temo-mint animate-pulse" />
                <span className="font-mono text-xs text-temo-mint">All systems nominal</span>
              </div>
            </div>
            <div className="temo-glass rounded-xl p-3">
              <span className="font-mono text-[10px] uppercase tracking-wider text-temo-titanium">Agent Registry</span>
              <p className="mt-2 font-mono text-xs text-temo-led">Connected and synced</p>
            </div>
          </div>
        )}
        {tab === 'properties' && (
          <div className="space-y-3">
            <div className="temo-glass rounded-xl p-3">
              <span className="font-mono text-[10px] uppercase tracking-wider text-temo-titanium">Selected Entity</span>
              <p className="mt-2 font-mono text-xs text-temo-titanium">No entity selected. Click an agent or mission node to inspect.</p>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-temo-cyan/10 px-4 py-2">
        <button className="flex w-full items-center justify-center gap-2 font-mono text-[10px] uppercase tracking-wider text-temo-titanium hover:text-temo-cyan">
          <Download className="h-3 w-3" /> Export Logs
        </button>
      </div>
    </motion.aside>
  );
}
