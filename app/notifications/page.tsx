'use client';

import { motion } from 'framer-motion';
import { Bell, CheckCircle, AlertCircle, Info, X } from 'lucide-react';
import { AppShell } from '@/components/temo/app-shell';
import { GlassPanel, EmptyState } from '@/components/temo/primitives';
import { useSystemStore } from '@/stores/systemStore';
import { useOrchestrationStore } from '@/stores/orchestrationStore';
import { ClientTime } from '@/components/temo/client-time';
import { cn } from '@/lib/utils';

export default function NotificationsPage() {
  const events = useSystemStore((s) => s.events);
  const activityFeed = useOrchestrationStore((s) => s.activityFeed);

  const TYPE_CONFIG = {
    success: { icon: CheckCircle, color: '#10B981', label: 'Success' },
    error: { icon: AlertCircle, color: '#EF4444', label: 'Critical' },
    warning: { icon: AlertCircle, color: '#F97316', label: 'Warning' },
    info: { icon: Info, color: '#00F3FF', label: 'Info' },
  } as const;

  const allNotifications = [
    ...events.map((e) => ({ id: e.id, title: e.message, type: e.type as keyof typeof TYPE_CONFIG, time: e.time, source: 'System' })),
    ...activityFeed.map((a) => ({ id: a.id, title: a.title, type: a.type === 'error' ? 'error' : 'info' as keyof typeof TYPE_CONFIG, time: '--:--', timestamp: a.timestamp, source: a.detail ?? 'Activity' })),
  ];

  return (
    <AppShell>
      <div className="space-y-6 pb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-sans text-2xl font-bold tracking-tight text-temo-led">Notifications</h1>
            <p className="font-mono text-xs text-temo-titanium">System alerts and event history</p>
          </div>
          <button className="flex items-center gap-2 rounded-xl border border-temo-titanium/20 px-3 py-2 font-mono text-xs uppercase tracking-wider text-temo-titanium transition-colors hover:text-temo-led">
            <CheckCircle className="h-4 w-4" /> Mark All Read
          </button>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2">
          {['All', 'Critical', 'Missions', 'System'].map((t) => (
            <button
              key={t}
              className={cn(
                'rounded-full px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-all',
                t === 'All'
                  ? 'bg-temo-cyan/15 text-temo-cyan border border-temo-cyan/30'
                  : 'border border-temo-titanium/20 text-temo-titanium hover:text-temo-led'
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {allNotifications.length > 0 ? (
          <div className="space-y-2">
            {allNotifications.map((n, i) => {
              const conf = TYPE_CONFIG[n.type] ?? TYPE_CONFIG.info;
              const Icon = conf.icon;
              return (
                <motion.div
                  key={n.id}
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="group flex items-start gap-3 rounded-xl temo-glass p-4 transition-colors hover:bg-temo-cyan/5"
                  style={{ borderLeft: `3px solid ${conf.color}` }}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: conf.color }} />
                  <div className="flex-1 min-w-0">
                    <p className="font-sans text-sm text-temo-led">{n.title}</p>
                    <p className="font-mono text-[10px] text-temo-titanium">{n.source}</p>
                  </div>
                  {'timestamp' in n && n.timestamp ? (
                    <ClientTime ts={n.timestamp as number} fmt="time" className="shrink-0 font-mono text-[10px] text-temo-titanium/60" />
                  ) : (
                    <span className="shrink-0 font-mono text-[10px] text-temo-titanium/60">{n.time}</span>
                  )}
                  <button className="text-temo-titanium opacity-0 transition-opacity group-hover:opacity-100 hover:text-temo-led">
                    <X className="h-4 w-4" />
                  </button>
                </motion.div>
              );
            })}
          </div>
        ) : (
          <GlassPanel className="p-8">
            <EmptyState
              icon={<Bell className="h-12 w-12" />}
              title="Zero Active Alerts"
              description="All systems nominal. No notifications to display."
            />
          </GlassPanel>
        )}
      </div>
    </AppShell>
  );
}
