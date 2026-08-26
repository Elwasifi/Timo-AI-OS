'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

// ── GlassPanel: Universal structural container (06_Component_Library.md §3) ──
export function GlassPanel({
  children,
  className,
  variant = 'base',
  hover = false,
}: {
  children: ReactNode;
  className?: string;
  variant?: 'base' | 'dense' | 'smoked';
  hover?: boolean;
}) {
  return (
    <div
      className={cn(
        variant === 'base' && 'temo-glass',
        variant === 'dense' && 'temo-glass-dense',
        variant === 'smoked' && 'temo-glass-smoked',
        'rounded-2xl',
        hover && 'transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_0_30px_rgba(0,243,255,0.2)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

// ── StatCard: Compact numerical display (06_Component_Library.md §3) ──
export function StatCard({
  label,
  value,
  unit,
  trend,
  icon,
  accentColor = '#00F3FF',
  index = 0,
}: {
  label: string;
  value: string | number;
  unit?: string;
  trend?: { direction: 'up' | 'down' | 'neutral'; value: string };
  icon?: ReactNode;
  accentColor?: string;
  index?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.05 }}
      className="temo-glass rounded-xl p-4"
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-wider text-temo-titanium">{label}</span>
        {icon && <span style={{ color: accentColor }}>{icon}</span>}
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="font-mono text-2xl font-bold tabular-nums text-temo-led">{value}</span>
        {unit && <span className="font-mono text-xs text-temo-titanium">{unit}</span>}
      </div>
      {trend && (
        <div className="mt-1 flex items-center gap-1">
          <span className={cn('font-mono text-[10px]', trend.direction === 'up' && 'text-temo-mint', trend.direction === 'down' && 'text-temo-critical', trend.direction === 'neutral' && 'text-temo-titanium')}>
            {trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→'} {trend.value}
          </span>
        </div>
      )}
    </motion.div>
  );
}

// ── DepartmentBadge: colored pill for department tagging ──
const DEPT_COLORS: Record<string, string> = {
  engineering: '#A855F7',
  marketing: '#F97316',
  automation: '#10B981',
  creative: '#EC4899',
  research: '#06B6D4',
  trading: '#EAB308',
};

export function DepartmentBadge({ department, label }: { department: string; label?: string }) {
  const color = DEPT_COLORS[department] ?? '#00F3FF';
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider"
      style={{ backgroundColor: `${color}15`, color, border: `1px solid ${color}30` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 4px ${color}` }} />
      {label ?? department}
    </span>
  );
}

// ── StatusDot: agent/worker status indicator ──
export function StatusDot({ status, color = '#00F3FF' }: { status: 'available' | 'busy' | 'thinking' | 'speaking' | 'offline'; color?: string }) {
  const statusConfig = {
    available: { bg: '#10B981', pulse: true },
    busy: { bg: '#F97316', pulse: true },
    thinking: { bg: '#8B5CF6', pulse: true },
    speaking: { bg: '#00F3FF', pulse: true },
    offline: { bg: '#64748B', pulse: false },
  };
  const conf = statusConfig[status];
  return (
    <span
      className={cn('inline-block h-2 w-2 rounded-full', conf.pulse && 'animate-pulse')}
      style={{ backgroundColor: conf.bg, boxShadow: conf.pulse ? `0 0 6px ${conf.bg}` : 'none' }}
    />
  );
}

// ── ProgressBar: sub-surface glowing conduit (06_Component_Library.md §11) ──
export function ProgressBar({ value, color = '#00F3FF', size = 'standard' }: { value: number; color?: string; size?: 'standard' | 'micro' }) {
  return (
    <div className={cn('w-full overflow-hidden rounded-full', size === 'standard' ? 'h-1.5' : 'h-0.5')} style={{ background: 'rgba(255,255,255,0.1)' }}>
      <motion.div
        className="h-full rounded-full"
        style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}80` }}
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(value, 100)}%` }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
      />
    </div>
  );
}

// ── EmptyState: holographic wireframe guidance (06_Component_Library.md §11) ──
export function EmptyState({ icon, title, description, actionLabel, onAction }: { icon: ReactNode; title: string; description: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
      <motion.div
        animate={{ y: [0, -4, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
        className="text-temo-titanium opacity-40"
      >
        {icon}
      </motion.div>
      <h3 className="font-sans text-base font-semibold text-temo-led">{title}</h3>
      <p className="max-w-sm font-sans text-sm text-temo-titanium">{description}</p>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="rounded-xl bg-temo-cyan px-5 py-2.5 font-mono text-xs font-bold uppercase tracking-wider text-temo-void transition-all hover:shadow-[0_0_20px_#00F3FF]"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

// ── LoadingSpinner: kinetic concentric rings (06_Component_Library.md §11) ──
export function LoadingSpinner({ label = 'SYNTHESIZING...', size = 48 }: { label?: string; size?: number }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3">
      <div className="relative" style={{ width: size, height: size }}>
        <div className="absolute inset-0 rounded-full border-2 border-temo-cyan/30" />
        <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-temo-cyan animate-spin-slow" />
        <div className="absolute inset-2 rounded-full border-2 border-transparent border-b-temo-blue animate-spin-slow-rev" />
      </div>
      <span className="font-mono text-[11px] uppercase tracking-widest text-temo-titanium">{label}</span>
    </div>
  );
}

// ── SectionHeader: reusable section title with icon ──
export function SectionHeader({ title, icon, accent = '#00F3FF' }: { title: string; icon?: ReactNode; accent?: string }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      {icon && <span style={{ color: accent }}>{icon}</span>}
      <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-temo-titanium">{title}</h3>
    </div>
  );
}
