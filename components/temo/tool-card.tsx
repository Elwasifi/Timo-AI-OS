'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export type Tool = {
  id: string;
  name: string;
  version?: string;
  description: string;
  enabled: boolean;
  category?: string;
  icon?: string;
};

export function ToolCard({ tool, index = 0, onToggle }: { tool: Tool; index?: number; onToggle?: (id: string) => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.04 }}
      whileHover={{ scale: 1.02 }}
      className={cn(
        'temo-glass group relative rounded-2xl p-5 transition-all duration-300',
        tool.enabled ? 'border-temo-cyan/40' : 'opacity-60',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-temo-cyan/10">
            <span className="material-symbols-outlined text-xl text-temo-cyan">
              {tool.icon ?? 'extension'}
            </span>
          </div>
          <div>
            <h3 className="font-sans text-sm font-semibold text-temo-led">{tool.name}</h3>
            {tool.version && <span className="font-mono text-[10px] text-temo-titanium">v{tool.version}</span>}
          </div>
        </div>

        {/* Toggle switch */}
        <button
          onClick={() => onToggle?.(tool.id)}
          className={cn(
            'relative h-6 w-11 rounded-full transition-all duration-300',
            tool.enabled ? 'bg-temo-cyan shadow-[0_0_10px_rgba(0,243,255,0.4)]' : 'bg-temo-bulkhead',
          )}
        >
          <motion.span
            className="absolute top-0.5 h-5 w-5 rounded-full bg-temo-led"
            animate={{ left: tool.enabled ? '22px' : '2px' }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          />
        </button>
      </div>

      <p className="mt-3 font-sans text-xs text-temo-titanium">{tool.description}</p>

      {tool.category && (
        <div className="mt-3">
          <span className="rounded-md bg-temo-cyan/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-temo-cyan">
            {tool.category}
          </span>
        </div>
      )}
    </motion.div>
  );
}
