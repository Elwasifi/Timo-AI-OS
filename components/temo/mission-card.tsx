'use client';

import { motion } from 'framer-motion';
import { Target, Clock, Zap } from 'lucide-react';
import { ProgressBar, DepartmentBadge } from './primitives';
import { cn } from '@/lib/utils';

// Mirrors lib/swarm/types.ts's real MissionStatus 1:1 (not a lossy 5-bucket
// subset) so every status the Mission Engine can actually produce renders
// correctly instead of falling through to `undefined` config.
export type MissionCardStatus =
  | 'pending' | 'planning' | 'ready' | 'executing' | 'reviewing'
  | 'completed' | 'failed' | 'cancelled' | 'paused';

export type Mission = {
  id: string;
  name: string;
  status: MissionCardStatus;
  progress: number;
  department?: string;
  managerName?: string;
  managerColor?: string;
  elapsedMs?: number;
  stepCount?: number;
  currentStep?: number;
};

const STATUS_CONFIG: Record<MissionCardStatus, { color: string; label: string }> = {
  pending: { color: '#F97316', label: 'Pending' },
  planning: { color: '#F97316', label: 'Planning' },
  ready: { color: '#EAB308', label: 'Ready' },
  executing: { color: '#00F3FF', label: 'Executing' },
  reviewing: { color: '#A855F7', label: 'Reviewing' },
  completed: { color: '#10B981', label: 'Completed' },
  failed: { color: '#EF4444', label: 'Failed' },
  cancelled: { color: '#64748B', label: 'Cancelled' },
  paused: { color: '#94A3B8', label: 'Paused' },
};

function formatElapsed(ms?: number): string {
  if (!ms) return '--';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function MissionCard({ mission, index = 0, onClick }: { mission: Mission; index?: number; onClick?: () => void }) {
  const statusConf = STATUS_CONFIG[mission.status];
  const accentColor = mission.managerColor ?? statusConf.color;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      whileHover={{ y: -3 }}
      onClick={onClick}
      className={cn(
        'temo-glass group relative cursor-pointer rounded-2xl p-5 transition-all duration-300',
        mission.status === 'executing' && 'animate-sine-float',
        onClick && 'hover:shadow-[0_0_25px_rgba(0,243,255,0.2)]',
      )}
      style={{ borderColor: `${accentColor}30` }}
    >
      {/* Hover glow */}
      <div
        className="absolute -right-12 -top-12 h-32 w-32 rounded-full opacity-20 blur-3xl transition-opacity group-hover:opacity-40"
        style={{ backgroundColor: accentColor }}
      />

      {/* Header */}
      <div className="relative flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4" style={{ color: accentColor }} />
          <h3 className="font-sans text-[15px] font-bold text-temo-led">{mission.name}</h3>
        </div>
        {mission.department && <DepartmentBadge department={mission.department} />}
      </div>

      {/* Progress bar with step nodes */}
      <div className="relative mt-4">
        <ProgressBar value={mission.progress} color={accentColor} />
        {mission.stepCount && mission.stepCount > 0 && (
          <div className="mt-1 flex items-center justify-between">
            <span className="font-mono text-[11px] text-temo-titanium">
              Step {mission.currentStep ?? '?'}/{mission.stepCount}
            </span>
            <span className="font-mono text-[11px] font-bold" style={{ color: accentColor }}>
              {Math.round(mission.progress)}%
            </span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="relative mt-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {mission.managerName && (
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: accentColor, boxShadow: `0 0 4px ${accentColor}` }} />
              <span className="font-mono text-[11px] text-temo-titanium">{mission.managerName}</span>
            </div>
          )}
          {mission.elapsedMs !== undefined && (
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3 text-temo-titanium" />
              <span className="font-mono text-[11px] text-temo-titanium">{formatElapsed(mission.elapsedMs)}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Zap className="h-3 w-3" style={{ color: statusConf.color }} />
          <span className="font-mono text-[11px] font-medium" style={{ color: statusConf.color }}>
            {statusConf.label}
          </span>
        </div>
      </div>
    </motion.div>
  );
}
