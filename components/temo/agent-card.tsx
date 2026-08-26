'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { StatusDot, DepartmentBadge } from './primitives';

export type Agent = {
  id: string;
  name: string;
  role: string;
  department?: string;
  status: 'available' | 'busy' | 'thinking' | 'speaking' | 'offline';
  color: string;
  icon?: string;
  description?: string;
  skills?: string[];
  currentActivity?: string;
  isFavorite?: boolean;
  tasksExecuted?: number;
};

export function AgentCard({ agent, index = 0, onClick }: { agent: Agent; index?: number; onClick?: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      whileHover={{ y: -3 }}
      onClick={onClick}
      className={cn(
        'temo-glass group relative cursor-pointer overflow-hidden rounded-2xl p-5 transition-all duration-300',
        onClick && 'hover:shadow-[0_0_25px_rgba(0,243,255,0.15)]',
      )}
      style={{ borderColor: `${agent.color}25` }}
    >
      {/* Ambient glow */}
      <div
        className="absolute -right-16 -top-16 h-40 w-40 rounded-full opacity-30 blur-3xl transition-opacity group-hover:opacity-50"
        style={{ backgroundColor: `${agent.color}30` }}
      />

      {/* Header: avatar + name */}
      <div className="relative flex items-start gap-4">
        <div className="relative flex h-14 w-14 items-center justify-center">
          {/* Avatar ring */}
          <div
            className={cn('absolute inset-0 rounded-full border-2', agent.status !== 'offline' && agent.status !== 'available' && 'animate-spin-slow')}
            style={{ borderColor: agent.color, borderRightColor: agent.status !== 'offline' ? 'transparent' : agent.color }}
          />
          <span className="material-symbols-outlined text-2xl" style={{ color: agent.color }}>
            {agent.icon === 'Sparkles' ? 'auto_awesome' :
             agent.icon === 'Code2' ? 'code' :
             agent.icon === 'Workflow' ? 'settings_input_component' :
             agent.icon === 'TrendingUp' ? 'trending_up' :
             agent.icon === 'Palette' ? 'palette' :
             agent.icon === 'PenTool' ? 'edit' :
             agent.icon === 'LineChart' ? 'monitoring' : 'smart_toy'}
          </span>
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-sans text-base font-semibold text-temo-led">{agent.name}</h3>
            <StatusDot status={agent.status} color={agent.color} />
          </div>
          <p className="font-mono text-xs uppercase tracking-wider text-temo-titanium">{agent.role}</p>
          {agent.department && <div className="mt-1"><DepartmentBadge department={agent.department} /></div>}
        </div>
      </div>

      {/* Description */}
      {agent.description && (
        <p className="relative mt-4 line-clamp-2 font-sans text-sm text-temo-titanium">{agent.description}</p>
      )}

      {/* Skills */}
      {agent.skills && agent.skills.length > 0 && (
        <div className="relative mt-3 flex flex-wrap gap-1.5">
          {agent.skills.slice(0, 3).map((skill) => (
            <span key={skill} className="rounded-md border border-temo-cyan/10 px-2 py-1 font-mono text-[10px] text-temo-titanium">
              {skill}
            </span>
          ))}
          {agent.skills.length > 3 && (
            <span className="px-2 py-1 font-mono text-[10px] text-temo-titanium">+{agent.skills.length - 3}</span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="relative mt-4 flex items-center justify-between">
        <span className="font-mono text-[10px] text-temo-titanium">{agent.currentActivity ?? 'Standing by'}</span>
        {agent.tasksExecuted !== undefined && (
          <span className="font-mono text-[10px] text-temo-titanium">{agent.tasksExecuted} tasks</span>
        )}
      </div>
    </motion.div>
  );
}
