'use client';

import { motion } from 'framer-motion';
import { BarChart3, TrendingUp, TrendingDown, DollarSign, Zap, Clock } from 'lucide-react';
import { AppShell } from '@/components/temo/app-shell';
import { StatCard, GlassPanel, SectionHeader } from '@/components/temo/primitives';
import { useSystemStore } from '@/stores/systemStore';
import { useDashboardStore } from '@/stores/dashboardStore';

export default function AnalyticsPage() {
  const health = useSystemStore((s) => s.health);
  const agents = useDashboardStore((s) => s.agents);
  const workflows = useDashboardStore((s) => s.workflows);

  const totalTasks = agents.reduce((sum, a) => sum + (a.memory?.conversationCount ?? 0), 0);
  const activeWorkflows = workflows.filter((w) => w.status === 'running').length;
  const completedWorkflows = workflows.filter((w) => w.status === 'idle').length;

  return (
    <AppShell>
      <div className="space-y-6 pb-8">
        <div>
          <h1 className="font-sans text-2xl font-bold tracking-tight text-temo-led">Analytics</h1>
          <p className="font-mono text-xs text-temo-titanium">System telemetry and performance metrics</p>
        </div>

        {/* Timeframe selector */}
        <div className="flex gap-2">
          {['1H', '24H', '7D', '30D', 'ALL'].map((tf) => (
            <button
              key={tf}
              className={`rounded-full px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-all ${tf === '24H'
                ? 'bg-temo-trading/15 text-temo-trading border border-temo-trading/30'
                : 'border border-temo-titanium/20 text-temo-titanium hover:text-temo-led'
                }`}
            >
              {tf}
            </button>
          ))}
        </div>

        {/* Macro stats */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="API Calls" value={health.apiCalls.toLocaleString()} icon={<Zap className="h-4 w-4" />} accentColor="#EAB308" index={0} trend={{ direction: 'up', value: '+12%' }} />
          <StatCard label="Total Tasks" value={totalTasks} icon={<Clock className="h-4 w-4" />} accentColor="#EAB308" index={1} trend={{ direction: 'up', value: '+8%' }} />
          <StatCard label="Active Workflows" value={activeWorkflows} icon={<TrendingUp className="h-4 w-4" />} accentColor="#10B981" index={2} />
          <StatCard label="Completed" value={completedWorkflows} icon={<TrendingDown className="h-4 w-4" />} accentColor="#94A3B8" index={3} />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <SectionHeader title="CPU & Memory Utilization" icon={<BarChart3 className="h-4 w-4" />} accent="#00F3FF" />
            <GlassPanel className="p-6">
              <div className="space-y-4">
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-mono text-xs text-temo-titanium">CPU</span>
                    <span className="font-mono text-xs font-bold text-temo-cyan">{health.cpu}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/10">
                    <motion.div className="h-full rounded-full bg-temo-cyan" initial={{ width: 0 }} animate={{ width: `${health.cpu}%` }} transition={{ duration: 0.8 }} style={{ boxShadow: '0 0 8px #00F3FF80' }} />
                  </div>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-mono text-xs text-temo-titanium">Memory</span>
                    <span className="font-mono text-xs font-bold text-temo-purple">{health.memory}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/10">
                    <motion.div className="h-full rounded-full bg-temo-purple" initial={{ width: 0 }} animate={{ width: `${health.memory}%` }} transition={{ duration: 0.8 }} style={{ boxShadow: '0 0 8px #8B5CF680' }} />
                  </div>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-mono text-xs text-temo-titanium">Network</span>
                    <span className="font-mono text-xs font-bold text-temo-blue">{health.network}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/10">
                    <motion.div className="h-full rounded-full bg-temo-blue" initial={{ width: 0 }} animate={{ width: `${health.network}%` }} transition={{ duration: 0.8 }} style={{ boxShadow: '0 0 8px #0088FF80' }} />
                  </div>
                </div>
              </div>
            </GlassPanel>
          </div>

          <div>
            <SectionHeader title="Department Throughput" icon={<DollarSign className="h-4 w-4" />} accent="#EAB308" />
            <GlassPanel className="p-6">
              <div className="space-y-3">
                {agents.filter((a) => a.id !== 'temo').map((a, i) => (
                  <motion.div
                    key={a.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="flex items-center gap-3"
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: a.color, boxShadow: `0 0 4px ${a.color}` }} />
                    <span className="w-16 font-mono text-xs text-temo-led">{a.name}</span>
                    <div className="flex-1">
                      <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ backgroundColor: a.color, boxShadow: `0 0 6px ${a.color}80` }}
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min((a.memory?.conversationCount ?? 0) / 3, 100)}%` }}
                          transition={{ duration: 0.8, delay: i * 0.05 }}
                        />
                      </div>
                    </div>
                    <span className="font-mono text-[10px] text-temo-titanium">{a.memory?.conversationCount ?? 0}</span>
                  </motion.div>
                ))}
              </div>
            </GlassPanel>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
