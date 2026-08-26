'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import {
  Sparkles, Code2, Workflow, TrendingUp, Palette, PenTool,
} from 'lucide-react';
import type { AgentAnimationState } from '@/types';

const ICONS: Record<string, LucideIcon> = {
  Sparkles, Code2, Workflow, TrendingUp, Palette, PenTool,
};

interface AgentAvatarProps {
  agentId: string;
  iconName: string;
  color: string;
  state: AgentAnimationState;
  size?: number;
  volume?: number;
  /** Real uploaded portrait (agent_registry.avatar_url / AgentUI.image). Rendered in place of the icon when present. */
  imageUrl?: string | null;
}

/**
 * AgentAvatar — animated per-agent avatar with 5 states.
 * Each agent has its own icon, color, and animation behavior.
 *
 * States:
 *   idle      — soft glow + floating + breathing
 *   listening — pulsing outer rings
 *   thinking  — rotating energy ring + orbiting particles
 *   speaking  — reactive waveform + scaling + light rays
 *   offline   — gray, static
 */
export function AgentAvatar({
  agentId,
  iconName,
  color,
  state,
  size = 56,
  volume = 0,
  imageUrl,
}: AgentAvatarProps) {
  const Icon = ICONS[iconName] ?? Sparkles;

  const colors = useMemo(() => {
    if (state === 'offline') {
      return { core: '#3f3f46', ring: '#52525b', glow: 'rgba(82,82,91,0.3)' };
    }
    return {
      core: color,
      ring: `${color}88`,
      glow: `${color}80`,
    };
  }, [color, state]);

  const scaleBoost = state === 'speaking' ? 1 + volume * 0.2 : 1;
  const iconSize = size * 0.38;

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
      data-agent={agentId}
    >
      {/* Outer glow */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: size * 1.6,
          height: size * 1.6,
          background: `radial-gradient(circle, ${colors.glow} 0%, transparent 70%)`,
        }}
        animate={{
          opacity:
            state === 'listening' ? [0.3, 0.6, 0.3]
            : state === 'speaking' ? [0.25, 0.55, 0.25]
            : state === 'thinking' ? [0.15, 0.4, 0.15]
            : state === 'idle' ? [0.1, 0.25, 0.1]
            : 0.08,
          scale:
            state === 'listening' ? [1, 1.12, 1]
            : state === 'speaking' ? [1, 1.08 + volume * 0.12, 1]
            : 1,
        }}
        transition={{ duration: state === 'listening' ? 1.5 : 2.5, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Pulsing outer rings (listening) */}
      {state === 'listening' && (
        <>
          <motion.span
            className="absolute rounded-full border-2"
            style={{ borderColor: `${color}80`, width: size, height: size }}
            animate={{ scale: [1, 1.5], opacity: [0.5, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
          />
          <motion.span
            className="absolute rounded-full border-2"
            style={{ borderColor: `${color}50`, width: size, height: size }}
            animate={{ scale: [1, 1.8], opacity: [0.3, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut', delay: 0.5 }}
          />
        </>
      )}

      {/* Rotating energy ring (thinking) */}
      {state === 'thinking' && (
        <motion.div
          className="absolute rounded-full border-2 border-dashed"
          style={{ borderColor: `${color}80`, width: size * 1.25, height: size * 1.25 }}
          animate={{ rotate: 360 }}
          transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
        />
      )}

      {/* Orbiting particles (thinking) */}
      {state === 'thinking' &&
        Array.from({ length: 3 }).map((_, i) => (
          <motion.div
            key={i}
            className="absolute"
            animate={{ rotate: 360 }}
            transition={{ duration: 2 + i * 0.5, repeat: Infinity, ease: 'linear' }}
            style={{ width: size, height: size }}
          >
            <span
              className="absolute block h-1.5 w-1.5 rounded-full"
              style={{
                top: '50%',
                left: '50%',
                backgroundColor: color,
                boxShadow: `0 0 6px ${color}`,
                transform: `translate(${size * 0.5}px, -50%)`,
              }}
            />
          </motion.div>
        ))}

      {/* Light rays (speaking) */}
      {state === 'speaking' &&
        Array.from({ length: 8 }).map((_, i) => (
          <motion.div
            key={i}
            className="absolute origin-center"
            style={{
              width: 2,
              height: size * 0.55,
              background: `linear-gradient(to top, ${color}, transparent)`,
              transform: `rotate(${i * 45}deg) translateY(-${size * 0.38}px)`,
            }}
            animate={{ opacity: [0, 0.6, 0], scaleY: [0.5, 1, 0.5] }}
            transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.1, ease: 'easeInOut' }}
          />
        ))}

      {/* Core avatar circle */}
      <motion.div
        className="relative flex items-center justify-center rounded-full"
        style={{
          width: size * 0.72,
          height: size * 0.72,
          background:
            state === 'offline'
              ? 'radial-gradient(circle at 30% 30%, #52525b, #27272a)'
              : `radial-gradient(circle at 30% 30%, ${colors.core}, ${colors.ring})`,
          boxShadow:
            state === 'offline'
              ? '0 0 12px rgba(82,82,91,0.3)'
              : `0 0 20px ${colors.glow}, inset 0 0 12px rgba(255,255,255,0.12)`,
        }}
        animate={{
          y: state === 'idle' ? [0, -3, 0] : 0,
          scale: scaleBoost,
        }}
        transition={{
          y: { duration: 4, repeat: Infinity, ease: 'easeInOut' },
          scale: { duration: 0.15 },
        }}
      >
        {/* Inner shimmer */}
        <motion.div
          className="absolute inset-0 rounded-full opacity-30"
          style={{
            background: 'radial-gradient(circle at 70% 70%, transparent 40%, rgba(255,255,255,0.1) 100%)',
          }}
          animate={{ opacity: state === 'idle' ? [0.15, 0.35, 0.15] : 0.25 }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* Agent portrait, when uploaded — falls back to the icon otherwise */}
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL, not a local /public asset
          <img
            src={imageUrl}
            alt=""
            className="relative z-10 h-full w-full rounded-full object-cover"
          />
        ) : (
          <Icon
            className="relative z-10 text-white"
            style={{ width: iconSize, height: iconSize }}
          />
        )}

        {/* Waveform bars (speaking) */}
        {state === 'speaking' && (
          <div className="absolute bottom-1 left-1/2 z-20 flex -translate-x-1/2 items-end gap-0.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <motion.span
                key={i}
                className="w-0.5 rounded-full bg-white/80"
                animate={{ height: [2, size * 0.12 * (0.5 + Math.random()), 2] }}
                transition={{ duration: 0.3 + i * 0.05, repeat: Infinity, ease: 'easeInOut' }}
              />
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}

export function getAgentIcon(iconName: string): LucideIcon {
  return ICONS[iconName] ?? Sparkles;
}
