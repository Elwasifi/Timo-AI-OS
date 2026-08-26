'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import type { OrbState } from '@/types';

interface OrbProps {
  state: OrbState;
  size?: number;
  volume?: number;
}

export function AIOrb({ state, size = 56, volume = 0 }: OrbProps) {
  const colors = useMemo(() => {
    if (state === 'disconnected') {
      return { core: '#3f3f46', ring: '#52525b', glow: 'rgba(82,82,91,0.3)' };
    }
    return { core: '#00E5FF', ring: '#7B61FF', glow: 'rgba(0,229,255,0.5)' };
  }, [state]);

  const scaleBoost = state === 'speaking' ? 1 + volume * 0.25 : 1;

  const ringCount = state === 'thinking' ? 2 : 0;
  const rayCount = state === 'speaking' ? 8 : 0;

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      {/* Outer glow */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: size * 2,
          height: size * 2,
          background: `radial-gradient(circle, ${colors.glow} 0%, transparent 70%)`,
        }}
        animate={{
          opacity:
            state === 'listening' ? [0.4, 0.8, 0.4]
            : state === 'speaking' ? [0.3, 0.7, 0.3]
            : state === 'thinking' ? [0.2, 0.5, 0.2]
            : state === 'idle' ? [0.15, 0.35, 0.15]
            : 0.1,
          scale:
            state === 'listening' ? [1, 1.15, 1]
            : state === 'speaking' ? [1, 1.1 + volume * 0.15, 1]
            : 1,
        }}
        transition={{ duration: state === 'listening' ? 1.5 : 2.5, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Energy waves — idle state breathing waves */}
      {state === 'idle' && (
        <>
          <motion.span
            className="absolute rounded-full border"
            style={{ borderColor: 'rgba(0,229,255,0.15)', width: size, height: size }}
            animate={{ scale: [1, 1.8], opacity: [0.3, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeOut' }}
          />
          <motion.span
            className="absolute rounded-full border"
            style={{ borderColor: 'rgba(123,97,255,0.12)', width: size, height: size }}
            animate={{ scale: [1, 1.8], opacity: [0.2, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeOut', delay: 1.5 }}
          />
        </>
      )}

      {/* Pulsing outer rings (listening) */}
      {state === 'listening' && (
        <>
          <motion.span
            className="absolute rounded-full border-2"
            style={{ borderColor: 'rgba(0,229,255,0.5)', width: size, height: size }}
            animate={{ scale: [1, 1.6], opacity: [0.6, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
          />
          <motion.span
            className="absolute rounded-full border-2"
            style={{ borderColor: 'rgba(0,229,255,0.35)', width: size, height: size }}
            animate={{ scale: [1, 1.9], opacity: [0.4, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut', delay: 0.5 }}
          />
          <motion.span
            className="absolute rounded-full border-2"
            style={{ borderColor: 'rgba(123,97,255,0.25)', width: size, height: size }}
            animate={{ scale: [1, 2.1], opacity: [0.2, 0] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: 'easeOut', delay: 1 }}
          />
        </>
      )}

      {/* Rotating energy ring (thinking) — two counter-rotating rings */}
      {state === 'thinking' && (
        <>
          <motion.div
            className="absolute rounded-full border-2 border-dashed"
            style={{ borderColor: 'rgba(123,97,255,0.5)', width: size * 1.3, height: size * 1.3 }}
            animate={{ rotate: 360 }}
            transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
          />
          <motion.div
            className="absolute rounded-full border border-dashed"
            style={{ borderColor: 'rgba(0,229,255,0.3)', width: size * 1.5, height: size * 1.5 }}
            animate={{ rotate: -360 }}
            transition={{ duration: 5, repeat: Infinity, ease: 'linear' }}
          />
        </>
      )}

      {/* Orbiting particles (thinking) — reduced from 4 to 2 for performance */}
      {state === 'thinking' &&
        Array.from({ length: ringCount }).map((_, i) => (
          <motion.div
            key={`orbit-${i}`}
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
                backgroundColor: i % 2 === 0 ? colors.core : colors.ring,
                boxShadow: `0 0 6px ${i % 2 === 0 ? colors.core : colors.ring}`,
                transform: `translate(${size * (0.55 + i * 0.08)}px, -50%)`,
              }}
            />
          </motion.div>
        ))}

      {/* Light rays (speaking) — reduced from 12 to 8 for performance */}
      {state === 'speaking' &&
        Array.from({ length: rayCount }).map((_, i) => (
          <motion.div
            key={`ray-${i}`}
            className="absolute origin-center"
            style={{
              width: 2,
              height: size * 0.55,
              background: `linear-gradient(to top, ${i % 2 === 0 ? colors.core : colors.ring}, transparent)`,
              transform: `rotate(${i * (360 / rayCount)}deg) translateY(-${size * 0.38}px)`,
            }}
            animate={{ opacity: [0, 0.7, 0], scaleY: [0.5, 1, 0.5] }}
            transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.1, ease: 'easeInOut' }}
          />
        ))}

      {/* Core orb */}
      <motion.div
        className="relative rounded-full"
        style={{
          width: size * 0.7,
          height: size * 0.7,
          background:
            state === 'disconnected'
              ? 'radial-gradient(circle at 30% 30%, #52525b, #27272a)'
              : `radial-gradient(circle at 30% 30%, ${colors.core}, ${colors.ring})`,
          boxShadow:
            state === 'disconnected'
              ? '0 0 12px rgba(82,82,91,0.3)'
              : `0 0 24px ${colors.glow}, 0 0 48px ${colors.glow}, inset 0 0 16px rgba(255,255,255,0.15)`,
        }}
        animate={{
          y: state === 'idle' ? [0, -4, 0] : 0,
          scale: state === 'idle' ? [1, 1.03, 1] : scaleBoost,
        }}
        transition={{
          y: { duration: 4, repeat: Infinity, ease: 'easeInOut' },
          scale: { duration: state === 'idle' ? 4 : 0.15, repeat: state === 'idle' ? Infinity : 0, ease: 'easeInOut' },
        }}
      >
        {/* Inner shimmer */}
        <motion.div
          className="absolute inset-0 rounded-full opacity-30"
          style={{
            background: 'radial-gradient(circle at 70% 70%, transparent 40%, rgba(255,255,255,0.1) 100%)',
          }}
          animate={{ opacity: state === 'idle' ? [0.2, 0.4, 0.2] : 0.3 }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* Waveform bars (speaking) */}
        {state === 'speaking' && (
          <div className="absolute inset-0 flex items-center justify-center gap-0.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <motion.span
                key={i}
                className="w-0.5 rounded-full bg-white/70"
                animate={{ height: [4, size * 0.22 * (0.5 + i * 0.12), 4] }}
                transition={{ duration: 0.3 + i * 0.05, repeat: Infinity, ease: 'easeInOut' }}
              />
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}
