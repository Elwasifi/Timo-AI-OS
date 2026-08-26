'use client';

import { motion } from 'framer-motion';
import { Target, Activity, Zap, CheckCircle2, Clock } from 'lucide-react';
import { useOrchestrationStore } from '@/stores/orchestrationStore';
import { useDashboardStore } from '@/stores/dashboardStore';
import { useVoiceStore } from '@/stores/voiceStore';

export function MissionBar() {
  const activeAgentId = useOrchestrationStore((s) => s.activeAgentId);
  const taskQueue = useOrchestrationStore((s) => s.taskQueue);
  const completedTasks = useOrchestrationStore((s) => s.completedTasks);
  const agents = useDashboardStore((s) => s.agents);
  const orbState = useVoiceStore((s) => s.orbState);

  const activeAgent = agents.find((a) => a.id === activeAgentId);
  const availableCount = agents.filter((a) => a.status === 'available').length;

  const missionLabel = orbState === 'listening'
    ? 'Listening for command...'
    : orbState === 'thinking'
    ? 'Processing request...'
    : orbState === 'speaking'
    ? 'Responding...'
    : taskQueue.length > 0
    ? `${taskQueue.length} task${taskQueue.length > 1 ? 's' : ''} in queue`
    : 'All systems standing by';

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-3 rounded-2xl glass-holo px-4 py-2.5"
    >
      {/* Mission icon */}
      <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15">
        <Target className="h-4 w-4 text-primary" />
        <motion.div
          className="absolute inset-0 rounded-lg border border-primary/30"
          animate={{ opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
      </div>

      {/* Mission label */}
      <div className="flex flex-col">
        <span className="text-[9px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Active Mission</span>
        <span className="text-sm font-medium text-foreground">{missionLabel}</span>
      </div>

      {/* Divider */}
      <div className="h-8 w-px bg-border/40" />

      {/* Stats strip */}
      <div className="flex items-center gap-4">
        <Stat icon={Activity} label="Crew" value={`${availableCount}/${agents.length}`} color="#00E5FF" />
        <Stat icon={Zap} label="Queue" value={String(taskQueue.length)} color="#F59E0B" />
        <Stat icon={CheckCircle2} label="Done" value={String(completedTasks.length)} color="#22C55E" />
        <Stat icon={Clock} label="Agent" value={activeAgent?.name ?? 'Temo'} color={activeAgent?.color ?? '#00E5FF'} />
      </div>
    </motion.div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="h-3 w-3" style={{ color }} />
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-xs font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  );
}
