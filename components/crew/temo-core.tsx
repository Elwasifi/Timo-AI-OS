'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles, Code2, Workflow, TrendingUp, Palette, PenTool,
  type LucideIcon,
} from 'lucide-react';
import { useVoiceStore } from '@/stores/voiceStore';
import { useDashboardStore } from '@/stores/dashboardStore';
import { useOrchestrationStore } from '@/stores/orchestrationStore';
import { cn } from '@/lib/utils';
import type { Agent, AgentAnimationState, OrbState } from '@/types';

const AGENT_ICONS: Record<string, LucideIcon> = {
  Sparkles, Code2, Workflow, TrendingUp, Palette, PenTool,
};

const STATUS_DOT: Record<string, string> = {
  available: 'bg-success',
  busy: 'bg-warning',
  thinking: 'bg-secondary',
  speaking: 'bg-primary',
  offline: 'bg-muted-foreground',
};

function statusToAnim(status: string): AgentAnimationState {
  if (status === 'thinking') return 'thinking';
  if (status === 'speaking') return 'speaking';
  if (status === 'offline') return 'offline';
  return 'idle';
}

// Organic asymmetric positions — NOT a perfect circle
// Each agent occupies a unique spatial zone around the core
const AGENT_LAYOUT = [
  { x: -0.78, y: -0.42 },  // upper-left
  { x: 0.82, y: -0.28 },   // upper-right
  { x: 0.68, y: 0.62 },    // lower-right
  { x: -0.62, y: 0.72 },   // lower-left
  { x: 0.0, y: -0.88 },    // top-center
];

function bezierPath(x1: number, y1: number, x2: number, y2: number, curve = 0.25): string {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const perpX = -dy * curve;
  const perpY = dx * curve;
  return `M ${x1} ${y1} Q ${mx + perpX} ${my + perpY} ${x2} ${y2}`;
}

interface TemoCoreProps {
  size?: number;
  showAgents?: boolean;
  onAgentClick?: (agent: Agent) => void;
  focusedAgentId?: string | null;
  onAgentFocus?: (id: string | null) => void;
}

export function TemoCore({
  size = 320,
  showAgents = true,
  onAgentClick,
  focusedAgentId,
  onAgentFocus,
}: TemoCoreProps) {
  const orbState = useVoiceStore((s) => s.orbState);
  const volume = useVoiceStore((s) => s.volume);
  const agents = useDashboardStore((s) => s.agents);
  const activeAgentId = useOrchestrationStore((s) => s.activeAgentId);
  const [hoveredAgent, setHoveredAgent] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [parallax, setParallax] = useState({ x: 0, y: 0 });

  const chief = agents.find((a) => a.id === 'temo');
  const specialists = agents.filter((a) => a.id !== 'temo');
  const orbitRadius = size * 0.72;

  const agentPositions = useMemo(
    () =>
      specialists.map((agent, i) => {
        const layout = AGENT_LAYOUT[i % AGENT_LAYOUT.length];
        return {
          agent,
          x: layout.x * orbitRadius,
          y: layout.y * orbitRadius,
        };
      }),
    [specialists, orbitRadius]
  );

  // Camera parallax — subtle mouse tracking
  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = (e.clientX - cx) / rect.width;
      const dy = (e.clientY - cy) / rect.height;
      setParallax({ x: dx * 12, y: dy * 8 });
    };
    window.addEventListener('mousemove', handleMove);
    return () => window.removeEventListener('mousemove', handleMove);
  }, []);

  const isAnyFocused = focusedAgentId !== null && focusedAgentId !== undefined;

  return (
    <div
      ref={containerRef}
      className="relative flex items-center justify-center"
      style={{ width: size * 1.8, height: size * 1.8 }}
    >
      <div
        className="chamber-parallax"
        style={{ transform: `translate(${parallax.x}px, ${parallax.y}px)` }}
      >
        {/* ── SVG Neural Network Layer ── */}
        <svg
          className="absolute inset-0"
          viewBox={`${-size * 0.9} ${-size * 0.9} ${size * 1.8} ${size * 1.8}`}
          style={{ overflow: 'visible' }}
        >
          <defs>
            <filter id="core-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <radialGradient id="reactor-aura" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(0,243,255,0.15)" />
              <stop offset="50%" stopColor="rgba(139,92,246,0.08)" />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
          </defs>

          {/* Reactor aura field */}
          <circle cx="0" cy="0" r={size * 0.85} fill="url(#reactor-aura)" />

          {/* Concentric depth rings */}
          {[0.3, 0.5, 0.72, 0.95].map((r, i) => (
            <circle
              key={`depth-${i}`}
              cx="0" cy="0" r={size * r}
              fill="none"
              stroke={
                i === 0 ? 'rgba(0,243,255,0.14)'
                : i === 1 ? 'rgba(0,243,255,0.07)'
                : i === 2 ? 'rgba(139,92,246,0.05)'
                : 'rgba(0,243,255,0.025)'
              }
              strokeWidth={i === 0 ? 0.8 : 0.5}
              strokeDasharray={i >= 2 ? '2 8' : undefined}
            />
          ))}

          {/* Radar sweep */}
          <g className="animate-radar-sweep" style={{ transformOrigin: 'center' }}>
            <defs>
              <linearGradient id="radar-grad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="rgba(0,243,255,0)" />
                <stop offset="100%" stopColor="rgba(0,243,255,0.1)" />
              </linearGradient>
            </defs>
            <path
              d={`M 0 0 L ${size * 0.9} 0 A ${size * 0.9} ${size * 0.9} 0 0 1 ${size * 0.9 * Math.cos(0.3)} ${size * 0.9 * Math.sin(0.3)} Z`}
              fill="url(#radar-grad)"
              opacity="0.4"
            />
          </g>

          {/* Neural mesh — inter-agent connections (organic web) */}
          {showAgents && agentPositions.map(({ agent, x, y }, i) => {
            const next = agentPositions[(i + 1) % agentPositions.length];
            const nextNext = agentPositions[(i + 2) % agentPositions.length];
            const isFocused = focusedAgentId === agent.id || focusedAgentId === next.agent.id;
            const isDimmed = isAnyFocused && !isFocused;
            return (
              <g key={`mesh-${agent.id}`}>
                <path
                  d={bezierPath(x * 0.85, y * 0.85, next.x * 0.85, next.y * 0.85, 0.3)}
                  fill="none"
                  stroke={isFocused ? `${agent.color}30` : 'rgba(0,243,255,0.06)'}
                  strokeWidth={isFocused ? 0.8 : 0.4}
                  strokeDasharray="1 5"
                  className="neural-conduit"
                  opacity={isDimmed ? 0.15 : 1}
                />
                <path
                  d={bezierPath(x * 0.85, y * 0.85, nextNext.x * 0.85, nextNext.y * 0.85, 0.35)}
                  fill="none"
                  stroke="rgba(0,243,255,0.03)"
                  strokeWidth="0.3"
                  strokeDasharray="1 8"
                  opacity={isDimmed ? 0.1 : 1}
                />
              </g>
            );
          })}

          {/* Core-to-agent neural conduits — curved bezier */}
          {showAgents && agentPositions.map(({ agent, x, y }) => {
            const isActive = activeAgentId === agent.id;
            const isHovered = hoveredAgent === agent.id;
            const isFocused = focusedAgentId === agent.id;
            const isDimmed = isAnyFocused && !isFocused;
            const path = bezierPath(0, 0, x, y, 0.2);
            const showEnergy = isActive || isHovered || isFocused;
            return (
              <g key={`conduit-${agent.id}`} opacity={isDimmed ? 0.15 : 1}>
                {/* Wide glow conduit */}
                <path
                  d={path}
                  fill="none"
                  stroke={agent.color}
                  strokeWidth={showEnergy ? 8 : 3}
                  opacity={showEnergy ? 0.15 : 0.04}
                  style={{ filter: 'blur(6px)' }}
                />
                {/* Sharp conduit */}
                <path
                  d={path}
                  fill="none"
                  stroke={showEnergy ? agent.color : `${agent.color}25`}
                  strokeWidth={showEnergy ? 1.5 : 0.8}
                  strokeDasharray="6 4"
                  className={cn('transition-all duration-300', showEnergy && 'neural-conduit')}
                  style={{ filter: showEnergy ? `drop-shadow(0 0 6px ${agent.color}80)` : undefined }}
                />
                {/* Energy packets traveling along active conduit */}
                {showEnergy && (
                  <>
                    <circle r="3.5" fill={agent.color} filter="url(#core-glow)">
                      <animateMotion dur="2s" repeatCount="indefinite" path={path} />
                    </circle>
                    <circle r="2" fill={agent.color} opacity="0.6">
                      <animateMotion dur="2.8s" repeatCount="indefinite" path={path} begin="0.8s" />
                    </circle>
                  </>
                )}
              </g>
            );
          })}

          {/* Inner reactor rings */}
          <circle cx="0" cy="0" r={size * 0.22} fill="none" stroke="rgba(0,243,255,0.2)" strokeWidth="0.8" />
          <circle cx="0" cy="0" r={size * 0.28} fill="none" stroke="rgba(139,92,246,0.12)" strokeWidth="0.4" strokeDasharray="2 5" />
        </svg>

        {/* ── Rotating outer rings ── */}
        <div className="absolute" style={{ width: size * 0.6, height: size * 0.6 }}>
          <div
            className="absolute inset-0 rounded-full border border-dashed border-primary/20 animate-spin-slow"
            style={{ borderTopColor: 'rgba(0,243,255,0.4)' }}
          />
        </div>
        <div className="absolute" style={{ width: size * 0.75, height: size * 0.75 }}>
          <div
            className="absolute inset-0 rounded-full border border-dashed border-secondary/15 animate-spin-slow-rev"
            style={{ borderBottomColor: 'rgba(139,92,246,0.3)' }}
          />
        </div>

        {/* ── Energy waves ── */}
        {orbState === 'idle' && (
          <>
            <motion.span
              className="absolute rounded-full border border-primary/15"
              style={{ width: size * 0.5, height: size * 0.5 }}
              animate={{ scale: [1, 2.5], opacity: [0.4, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeOut' }}
            />
            <motion.span
              className="absolute rounded-full border border-secondary/10"
              style={{ width: size * 0.5, height: size * 0.5 }}
              animate={{ scale: [1, 2.5], opacity: [0.3, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeOut', delay: 2 }}
            />
          </>
        )}

        {/* ── Central Temo Reactor ── */}
        <div
          className={cn('relative z-20', isAnyFocused && 'chamber-focus-dim')}
          style={{ width: size * 0.5, height: size * 0.5 }}
          onClick={() => onAgentFocus?.(null)}
        >
          <CoreOrb state={orbState} size={size * 0.5} volume={volume} color={chief?.color ?? '#00E5FF'} />
        </div>

        {/* ── Temo label ── */}
        <div className="absolute z-20 flex flex-col items-center" style={{ top: 'calc(50% + ' + size * 0.28 + 'px)' }}>
          <span className="font-grotesk text-sm font-bold text-glow-primary" style={{ color: chief?.color }}>
            {chief?.name}
          </span>
          <span className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">Chief AI</span>
        </div>

        {/* ── Agent entities ── */}
        {showAgents &&
          agentPositions.map(({ agent, x, y }, i) => (
            <AgentEntity
              key={agent.id}
              agent={agent}
              x={x}
              y={y}
              index={i}
              isActive={activeAgentId === agent.id}
              isHovered={hoveredAgent === agent.id}
              isFocused={focusedAgentId === agent.id}
              isDimmed={isAnyFocused && focusedAgentId !== agent.id}
              orbState={orbState}
              volume={volume}
              onHover={(id) => setHoveredAgent(id)}
              onClick={() => {
                if (focusedAgentId === agent.id) {
                  onAgentFocus?.(null);
                } else {
                  onAgentFocus?.(agent.id);
                }
                onAgentClick?.(agent);
              }}
            />
          ))}
      </div>
    </div>
  );
}

// ── Core Orb (reactor) ──
function CoreOrb({
  state,
  size,
  volume,
  color,
}: {
  state: OrbState;
  size: number;
  volume: number;
  color: string;
}) {
  const scaleBoost = state === 'speaking' ? 1 + volume * 0.25 : 1;
  const secondaryColor = '#7B61FF';

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      {/* Outer glow — volumetric */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: size * 3.2,
          height: size * 3.2,
          background: `radial-gradient(circle, ${color}55 0%, rgba(123,97,255,0.18) 28%, transparent 68%)`,
          filter: 'blur(10px)',
        }}
        animate={{
          opacity:
            state === 'listening' ? [0.5, 0.9, 0.5]
            : state === 'speaking' ? [0.4, 0.8, 0.4]
            : state === 'thinking' ? [0.3, 0.6, 0.3]
            : [0.2, 0.45, 0.2],
          scale:
            state === 'listening' ? [1, 1.15, 1]
            : state === 'speaking' ? [1, 1.1 + volume * 0.15, 1]
            : 1,
        }}
        transition={{ duration: state === 'listening' ? 1.5 : 3, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Pulsing rings (listening) */}
      {state === 'listening' && (
        <>
          {[0, 0.6, 1.2].map((delay) => (
            <motion.span
              key={delay}
              className="absolute rounded-full border-2"
              style={{ borderColor: `${color}50`, width: size, height: size }}
              animate={{ scale: [1, 2], opacity: [0.6, 0] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeOut', delay }}
            />
          ))}
        </>
      )}

      {/* Counter-rotating rings (thinking) */}
      {state === 'thinking' && (
        <>
          <motion.div
            className="absolute rounded-full border-2 border-dashed"
            style={{ borderColor: `${secondaryColor}60`, width: size * 1.4, height: size * 1.4 }}
            animate={{ rotate: 360 }}
            transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
          />
          <motion.div
            className="absolute rounded-full border border-dashed"
            style={{ borderColor: `${color}40`, width: size * 1.7, height: size * 1.7 }}
            animate={{ rotate: -360 }}
            transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
          />
        </>
      )}

      {/* Orbiting particles (thinking) */}
      {state === 'thinking' &&
        Array.from({ length: 5 }).map((_, i) => (
          <motion.div
            key={i}
            className="absolute"
            animate={{ rotate: 360 }}
            transition={{ duration: 2.5 + i * 0.4, repeat: Infinity, ease: 'linear' }}
            style={{ width: size, height: size }}
          >
            <span
              className="absolute block h-2 w-2 rounded-full"
              style={{
                top: '50%',
                left: '50%',
                backgroundColor: i % 2 === 0 ? color : secondaryColor,
                boxShadow: `0 0 8px ${i % 2 === 0 ? color : secondaryColor}`,
                transform: `translate(${size * (0.6 + i * 0.06)}px, -50%)`,
              }}
            />
          </motion.div>
        ))}

      {/* Light rays (speaking) */}
      {state === 'speaking' &&
        Array.from({ length: 16 }).map((_, i) => (
          <motion.div
            key={i}
            className="absolute origin-center"
            style={{
              width: 2,
              height: size * 0.6,
              background: `linear-gradient(to top, ${i % 2 === 0 ? color : secondaryColor}, transparent)`,
              transform: `rotate(${i * 22.5}deg) translateY(-${size * 0.4}px)`,
            }}
            animate={{ opacity: [0, 0.7, 0], scaleY: [0.5, 1, 0.5] }}
            transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.05, ease: 'easeInOut' }}
          />
        ))}

      {/* Core orb — reactor */}
      <motion.div
        className="relative rounded-full ring-1 ring-white/20 reactor-breathe"
        style={{
          width: size,
          height: size,
          background: state === 'disconnected'
            ? 'radial-gradient(circle at 30% 30%, #52525b, #27272a)'
            : `radial-gradient(circle at 30% 30%, ${color}, ${secondaryColor})`,
          boxShadow: state === 'disconnected'
            ? '0 0 12px rgba(82,82,91,0.3)'
            : `0 0 55px ${color}90, 0 0 120px ${color}45, 0 0 180px rgba(123,97,255,0.2), inset 0 0 32px rgba(255,255,255,0.2)`,
        }}
        animate={{
          y: state === 'idle' ? [0, -5, 0] : 0,
          scale: state === 'idle' ? [1, 1.04, 1] : scaleBoost,
        }}
        transition={{
          y: { duration: 4, repeat: Infinity, ease: 'easeInOut' },
          scale: { duration: state === 'idle' ? 4 : 0.15, repeat: state === 'idle' ? Infinity : 0, ease: 'easeInOut' },
        }}
      >
        {/* Inner plasma shimmer */}
        <motion.div
          className="absolute inset-0 rounded-full opacity-30"
          style={{
            background: 'radial-gradient(circle at 70% 70%, transparent 40%, rgba(255,255,255,0.12) 100%)',
          }}
          animate={{ opacity: [0.2, 0.4, 0.2] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* Neural wave lines (idle) */}
        {state === 'idle' && (
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100">
            {[30, 50, 70].map((y, i) => (
              <motion.path
                key={i}
                d={`M 10 ${y} Q 25 ${y - 8} 50 ${y} T 90 ${y}`}
                fill="none"
                stroke="rgba(255,255,255,0.15)"
                strokeWidth="0.5"
                animate={{ opacity: [0.1, 0.3, 0.1], pathLength: [0, 1] }}
                transition={{ duration: 3, repeat: Infinity, delay: i * 0.5, ease: 'easeInOut' }}
              />
            ))}
          </svg>
        )}

        {/* Waveform (speaking) */}
        {state === 'speaking' && (
          <div className="absolute inset-0 flex items-center justify-center gap-0.5">
            {Array.from({ length: 7 }).map((_, i) => (
              <motion.span
                key={i}
                className="w-0.5 rounded-full bg-white/70"
                animate={{ height: [4, size * 0.25 * (0.3 + Math.random()), 4] }}
                transition={{ duration: 0.25 + i * 0.04, repeat: Infinity, ease: 'easeInOut' }}
              />
            ))}
          </div>
        )}

        {/* Center icon */}
        <div className="absolute inset-0 flex items-center justify-center">
          <Sparkles className="h-1/3 w-1/3 text-white/80" />
        </div>
      </motion.div>
    </div>
  );
}

// ── Agent Entity — living node in the network ──
function AgentEntity({
  agent,
  x,
  y,
  index,
  isActive,
  isHovered,
  isFocused,
  isDimmed,
  orbState,
  volume,
  onHover,
  onClick,
}: {
  agent: Agent;
  x: number;
  y: number;
  index: number;
  isActive: boolean;
  isHovered: boolean;
  isFocused: boolean;
  isDimmed: boolean;
  orbState: OrbState;
  volume: number;
  onHover: (id: string | null) => void;
  onClick: () => void;
}) {
  const Icon = AGENT_ICONS[agent.icon] ?? Sparkles;
  const animState: AgentAnimationState = isActive
    ? orbState === 'idle' ? statusToAnim(agent.status) : orbState as AgentAnimationState
    : statusToAnim(agent.status);

  const showHalo = isActive || isHovered || isFocused;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.3 }}
      animate={{
        opacity: isDimmed ? 0.2 : 1,
        scale: isFocused ? 1.2 : 1,
        x, y,
        filter: isDimmed ? 'blur(3px) saturate(0.5)' : 'blur(0px) saturate(1)',
      }}
      transition={{ delay: 0.15 + index * 0.1, type: 'spring', stiffness: 120, damping: 16 }}
      whileHover={{ scale: isFocused ? 1.25 : 1.15, zIndex: 30 }}
      onHoverStart={() => onHover(agent.id)}
      onHoverEnd={() => onHover(null)}
      onClick={onClick}
      className="absolute left-1/2 top-1/2 z-10 cursor-pointer"
      style={{ marginLeft: -32, marginTop: -32 }}
    >
      {/* Active glow halo */}
      {showHalo && (
        <motion.div
          className="absolute -inset-5 rounded-full"
          style={{ background: `radial-gradient(circle, ${agent.color}30 0%, transparent 70%)` }}
          animate={{ opacity: [0.3, 0.6, 0.3], scale: [1, 1.3, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
      )}

      {/* Idle drift animation wrapper — breathing */}
      <motion.div
        animate={{ y: [0, -6, 0], x: [0, 3, 0] }}
        transition={{ duration: 5 + index, repeat: Infinity, ease: 'easeInOut', delay: index * 0.3 }}
      >
        <div className="relative flex flex-col items-center gap-1">
          {/* Autonomous entity node — chest reactor */}
          <div className="relative">
            <motion.div
              className="relative flex items-center justify-center rounded-full"
              style={{
                width: 62,
                height: 62,
                background: `radial-gradient(circle at 30% 30%, ${agent.color}, ${agent.color}99)`,
                boxShadow: showHalo
                  ? `0 0 24px ${agent.color}80, inset 0 0 12px rgba(255,255,255,0.12)`
                  : `0 0 12px ${agent.color}40, inset 0 0 8px rgba(255,255,255,0.08)`,
                border: `1px solid ${agent.color}40`,
                ['--agent-color' as string]: agent.color,
              }}
              animate={{
                scale: isActive && orbState === 'speaking' ? 1 + volume * 0.15 : 1,
              }}
            >
              <Icon className="h-5 w-5 text-white drop-shadow-[0_0_6px_rgba(255,255,255,0.5)]" />
              <span
                className="absolute inset-1 rounded-full border border-white/10"
                style={{ borderTopColor: `${agent.color}90`, borderRightColor: `${agent.color}50` }}
              />
              {/* Inner reactor core dot */}
              <span
                className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.6)',
                  boxShadow: `0 0 6px ${agent.color}`,
                }}
              />
            </motion.div>

            {/* Status dot */}
            <span
              className={cn(
                'absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background',
                STATUS_DOT[agent.status],
                agent.status === 'available' && 'animate-pulse'
              )}
              style={agent.status === 'available' ? { backgroundColor: agent.color } : undefined}
            />

            {/* Thinking ring */}
            {animState === 'thinking' && (
              <motion.div
                className="absolute -inset-1 rounded-full border border-dashed"
                style={{ borderColor: `${agent.color}60` }}
                animate={{ rotate: 360 }}
                transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
              />
            )}

            {/* Speaking rays */}
            {animState === 'speaking' &&
              Array.from({ length: 6 }).map((_, i) => (
                <motion.div
                  key={i}
                  className="absolute origin-center"
                  style={{
                    width: 1.5,
                    height: 24,
                    background: `linear-gradient(to top, ${agent.color}, transparent)`,
                    transform: `rotate(${i * 60}deg) translateY(-30px)`,
                  }}
                  animate={{ opacity: [0, 0.6, 0], scaleY: [0.5, 1, 0.5] }}
                  transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.08 }}
                />
              ))}

            {/* Focus accent ring */}
            {isFocused && (
              <motion.div
                className="absolute -inset-2 rounded-full border-2 border-dashed"
                style={{ borderColor: `${agent.color}60` }}
                animate={{ rotate: 360 }}
                transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
              />
            )}
          </div>

          {/* Label */}
          <div className="text-center">
            <div
              className={cn('text-xs font-medium transition-colors', (isActive || isFocused) && 'text-glow-primary')}
              style={isActive || isFocused ? { color: agent.color } : {}}
            >
              {agent.name}
            </div>
            <div className="text-[8px] uppercase tracking-wider text-muted-foreground">{agent.role.split(' ')[0]}</div>
          </div>

          {/* Focus info panel */}
          <AnimatePresence>
            {isFocused && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.9 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className="absolute -bottom-20 left-1/2 z-40 w-44 -translate-x-1/2 rounded-lg border p-2"
                style={{
                  background: 'rgba(8,12,20,0.85)',
                  borderColor: `${agent.color}40`,
                  backdropFilter: 'blur(12px)',
                  boxShadow: `0 0 20px ${agent.color}20`,
                }}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: agent.color, boxShadow: `0 0 4px ${agent.color}` }}
                  />
                  <span className="font-mono text-[9px] uppercase tracking-wider" style={{ color: agent.color }}>
                    {agent.status}
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">{agent.role}</p>
                <p className="mt-0.5 text-[9px] text-muted-foreground/70">
                  {agent.memory.conversationCount} conversations
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}
