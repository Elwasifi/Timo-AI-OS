'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'muted' | 'disconnected';

type VoiceOrbProps = {
  state: OrbState;
  size?: number;
  onClick?: () => void;
  label?: string;
  className?: string;
};

const STATE_COLORS: Record<OrbState, { core: string; ring: string; glow: string }> = {
  idle: { core: '#00F3FF', ring: 'rgba(0, 243, 255, 0.4)', glow: 'rgba(0, 243, 255, 0.2)' },
  listening: { core: '#00F3FF', ring: 'rgba(0, 243, 255, 0.6)', glow: 'rgba(0, 243, 255, 0.4)' },
  thinking: { core: '#8B5CF6', ring: 'rgba(139, 92, 246, 0.6)', glow: 'rgba(139, 92, 246, 0.3)' },
  speaking: { core: '#00F3FF', ring: 'rgba(0, 243, 255, 0.8)', glow: 'rgba(0, 243, 255, 0.5)' },
  muted: { core: '#94A3B8', ring: 'rgba(148, 163, 184, 0.3)', glow: 'rgba(148, 163, 184, 0.1)' },
  disconnected: { core: '#64748B', ring: 'rgba(100, 116, 139, 0.2)', glow: 'rgba(100, 116, 139, 0.05)' },
};

const STATE_LABELS: Record<OrbState, string> = {
  idle: 'STANDBY',
  listening: 'LISTENING',
  thinking: 'PROCESSING',
  speaking: 'SPEAKING',
  muted: 'MUTED',
  disconnected: 'OFFLINE',
};

export function VoiceOrb({ state, size = 80, onClick, label, className }: VoiceOrbProps) {
  const colors = STATE_COLORS[state];
  const isMuted = state === 'muted' || state === 'disconnected';
  const isThinking = state === 'thinking';
  const isListening = state === 'listening';
  const isSpeaking = state === 'speaking';

  return (
    <div
      className={cn('flex flex-col items-center gap-2', onClick && 'cursor-pointer', className)}
      onClick={onClick}
      role="button"
      tabIndex={0}
    >
      <motion.div
        className="relative flex items-center justify-center"
        style={{ width: size, height: size }}
        animate={isListening ? { scale: [1, 1.08, 1] } : isSpeaking ? { scale: [1, 1.05, 1] } : {}}
        transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
      >
        {/* Outer energy ring */}
        <div
          className={cn('absolute inset-0 rounded-full border-2', !isMuted && 'animate-spin-slow')}
          style={{ borderColor: colors.ring, borderStyle: isMuted ? 'solid' : 'dashed' }}
        />

        {/* Inner ring - counter rotating */}
        <div
          className={cn('absolute rounded-full border', isThinking ? 'animate-spin-slow-rev' : !isMuted && 'animate-spin-slow')}
          style={{
            inset: size * 0.15,
            borderColor: colors.ring,
            borderWidth: isThinking ? 2 : 1,
            borderStyle: 'solid',
            borderRightColor: 'transparent',
            borderBottomColor: 'transparent',
          }}
        />

        {/* Core sphere */}
        <motion.div
          className="relative rounded-full"
          style={{
            width: size * 0.5,
            height: size * 0.5,
            background: `radial-gradient(circle at 35% 35%, ${colors.core}, ${colors.core}40 60%, transparent 80%)`,
            boxShadow: `0 0 ${size * 0.3}px ${colors.glow}, inset 0 0 ${size * 0.15}px ${colors.glow}`,
          }}
          animate={isSpeaking ? { scale: [1, 1.1, 1] } : {}}
          transition={{ duration: 0.8, repeat: Infinity, ease: 'easeInOut' }}
        >
          {/* Breathing pulse */}
          {!isMuted && (
            <motion.div
              className="absolute inset-0 rounded-full"
              style={{ border: `1px solid ${colors.core}` }}
              animate={{ scale: [1, 1.8], opacity: [0.5, 0] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
            />
          )}
        </motion.div>

        {/* Particle dots */}
        {!isMuted && Array.from({ length: 4 }).map((_, i) => {
          const angle = (i * 90 + (isThinking ? 180 : 0)) * (Math.PI / 180);
          const r = size * 0.42;
          return (
            <motion.div
              key={i}
              className="absolute h-1 w-1 rounded-full"
              style={{
                left: '50%',
                top: '50%',
                backgroundColor: colors.core,
                boxShadow: `0 0 4px ${colors.core}`,
              }}
              animate={{
                x: [Math.cos(angle) * r, Math.cos(angle + 1.5) * r, Math.cos(angle) * r],
                y: [Math.sin(angle) * r, Math.sin(angle + 1.5) * r, Math.sin(angle) * r],
                opacity: [0.3, 1, 0.3],
              }}
              transition={{ duration: 3 + i, repeat: Infinity, ease: 'easeInOut' }}
            />
          );
        })}
      </motion.div>

      {label !== undefined && (
        <span className="font-mono text-[11px] uppercase tracking-widest" style={{ color: colors.core }}>
          {label ?? STATE_LABELS[state]}
        </span>
      )}
    </div>
  );
}
