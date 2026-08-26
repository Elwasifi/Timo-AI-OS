'use client';

import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

export function TemoLogo({
  size = 32,
  withText = true,
  collapsed = false,
  className,
}: {
  size?: number;
  withText?: boolean;
  collapsed?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 18 }}
        className="relative flex items-center justify-center rounded-xl"
        style={{ width: size, height: size }}
      >
        <div className="absolute inset-0 rounded-xl bg-primary/20 blur-md" />
        <div className="relative flex h-full w-full items-center justify-center rounded-xl border border-primary/40 bg-gradient-to-br from-primary/20 to-secondary/20">
          <Sparkles className="text-primary" style={{ width: size * 0.5, height: size * 0.5 }} />
        </div>
      </motion.div>
      {withText && !collapsed && (
        <motion.div
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1 }}
          className="flex flex-col leading-none"
        >
          <span className="font-grotesk text-lg font-bold tracking-tight text-foreground">
            Temo
          </span>
          <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            AI OS
          </span>
        </motion.div>
      )}
    </div>
  );
}
