'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import {
  Sparkles, Code2, Workflow, TrendingUp, Palette, PenTool,
  Cpu, MemoryStick, Network, Zap, Radio,
  Target, Activity, ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import { useDashboardStore } from '@/stores/dashboardStore';
import { useSystemStore } from '@/stores/systemStore';
import { useOrchestrationStore } from '@/stores/orchestrationStore';
import { useVoiceStore } from '@/stores/voiceStore';
import { useRotatingState } from '@/hooks/use-rotating-state';
import { cn } from '@/lib/utils';
import type { Agent, OrbState } from '@/types';

const AGENT_ICONS: Record<string, LucideIcon> = {
  Sparkles, Code2, Workflow, TrendingUp, Palette, PenTool,
};

const TEMO_STATES = ['Thinking', 'Planning', 'Learning', 'Optimizing', 'Delegating'];

const AGENT_LAYOUT = [
  { x: -0.78, y: -0.42 },
  { x: 0.82, y: -0.28 },
  { x: 0.68, y: 0.62 },
  { x: -0.62, y: 0.72 },
  { x: 0.0, y: -0.88 },
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

export function CommandChamber() {
  const router = useRouter();
  const agents = useDashboardStore((s) => s.agents);
  const workflows = useDashboardStore((s) => s.workflows);
  const activity = useDashboardStore((s) => s.activity);
  const health = useSystemStore((s) => s.health);
  const activeAgentId = useOrchestrationStore((s) => s.activeAgentId);
  const orbState = useVoiceStore((s) => s.orbState);
  const volume = useVoiceStore((s) => s.volume);
  const stateText = useRotatingState(TEMO_STATES, 4000);

  const [hoveredAgent, setHoveredAgent] = useState<string | null>(null);
  const [focusedAgentId, setFocusedAgentId] = useState<string | null>(null);
  const [chamberYaw, setChamberYaw] = useState(0);
  const chamberRef = useRef<HTMLDivElement>(null);

  const chief = agents.find((a) => a.id === 'temo');
  const specialists = agents.filter((a) => a.id !== 'temo');
  const activeAgent = agents.find((a) => a.id === activeAgentId);
  const isAnyFocused = focusedAgentId !== null;

  const size = 300;
  const orbitRadius = size * 0.72;

  const agentPositions = useMemo(
    () =>
      specialists.map((agent, i) => {
        const layout = AGENT_LAYOUT[i % AGENT_LAYOUT.length];
        return { agent, x: layout.x * orbitRadius, y: layout.y * orbitRadius };
      }),
    [specialists, orbitRadius]
  );

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!chamberRef.current) return;
      const rect = chamberRef.current.getBoundingClientRect();
      const dx = (e.clientX - rect.left - rect.width / 2) / rect.width;
      setChamberYaw(dx * 4);
    };
    window.addEventListener('mousemove', handleMove);
    return () => window.removeEventListener('mousemove', handleMove);
  }, []);

  const orbStateClass =
    orbState === 'thinking' ? 'v3-reactor-thinking' :
    orbState === 'speaking' ? 'v3-reactor-speaking' :
    orbState === 'listening' ? 'v3-reactor-listening' : '';

  return (
    <div className="relative pb-8">
      {/* ── HUD Telemetry Strip ── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="v3-hud-bar relative flex items-center gap-6 overflow-hidden rounded-lg border border-temo-cyan/15 px-5 py-2.5"
      >
        <div className="absolute inset-0 v3-telemetry-bar opacity-20" />
        <div className="relative flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-temo-mint animate-pulse" style={{ boxShadow: '0 0 6px #10B981' }} />
          <span className="font-mono text-[10px] uppercase tracking-widest text-temo-cyan">System Online</span>
        </div>
        <div className="relative h-4 w-px bg-temo-cyan/15" />
        <div className="relative flex items-center gap-5">
          <TelemetryItem icon={Cpu} label="CPU" value={health.cpu} unit="%" />
          <TelemetryItem icon={MemoryStick} label="MEM" value={health.memory} unit="%" />
          <TelemetryItem icon={Network} label="NET" value={health.network} unit="%" />
          <TelemetryItem icon={Zap} label="API" value={health.apiCalls.toLocaleString()} />
        </div>
        <div className="relative ml-auto flex items-center gap-2">
          <Radio className="h-3 w-3 text-temo-cyan/50" />
          <span className="font-mono text-[10px] uppercase tracking-widest text-temo-titanium">Temo Status</span>
          <span className="font-mono text-[11px] font-bold text-temo-cyan text-glow-primary">{stateText}</span>
        </div>
      </motion.div>

      {/* ── Central Command Chamber ── */}
      <motion.div
        ref={chamberRef}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.15, duration: 0.7, type: 'spring', stiffness: 70 }}
        className="relative mt-4 flex min-h-[640px] items-center justify-center overflow-hidden rounded-2xl"
        style={{
          background: 'linear-gradient(180deg, rgba(4,7,13,0.7) 0%, rgba(8,12,20,0.5) 50%, rgba(4,7,13,0.7) 100%)',
        }}
      >
        {/* Environmental backdrop */}
        <div className="absolute inset-0 dot-grid opacity-25" />
        <div className="absolute inset-0 hex-grid opacity-15" />
        <div className="absolute inset-0 scanline-overlay opacity-40" />
        <div className="v3-chamber-fog" />
        <div className="absolute inset-0 god-rays" />
        <div className="absolute inset-0 v3-holo-scan" />

        {/* Central radial bloom */}
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            width: 800, height: 800,
            background: 'radial-gradient(circle, rgba(0,243,255,0.06) 0%, rgba(139,92,246,0.03) 25%, transparent 55%)',
            filter: 'blur(80px)',
          }}
        />

        {/* Pedestal rings */}
        {[0.35, 0.55, 0.75, 0.95].map((r, i) => (
          <div
            key={`pedestal-${i}`}
            className="v3-pedestal-ring"
            style={{ width: size * 2 * r, height: size * 2 * r, animationDelay: `${i * 0.8}s` }}
          />
        ))}

        {/* Corner brackets */}
        <div className="v3-bracket v3-bracket-tl" style={{ top: 12, left: 12 }} />
        <div className="v3-bracket v3-bracket-tr" style={{ top: 12, right: 12 }} />
        <div className="v3-bracket v3-bracket-bl" style={{ bottom: 12, left: 12 }} />
        <div className="v3-bracket v3-bracket-br" style={{ bottom: 12, right: 12 }} />

        {/* Edge labels */}
        <div className="absolute left-4 top-1/2 -translate-y-1/2 -rotate-90 font-mono text-[8px] uppercase tracking-[0.3em] text-temo-cyan/30">
          Neural Mesh
        </div>
        <div className="absolute right-4 top-1/2 -translate-y-1/2 rotate-90 font-mono text-[8px] uppercase tracking-[0.3em] text-temo-cyan/30">
          Agent Grid
        </div>

        {/* 3D-tilted chamber space */}
        <div className="v3-chamber-depth relative z-10">
          <div
            className={cn('v3-chamber-tilt relative', orbStateClass)}
            style={{ ['--chamber-yaw' as string]: `${chamberYaw}deg`, width: size * 1.8, height: size * 1.8 }}
          >
            {/* SVG Neural Network */}
            <svg
              className="absolute inset-0"
              viewBox={`${-size * 0.9} ${-size * 0.9} ${size * 1.8} ${size * 1.8}`}
              style={{ overflow: 'visible' }}
            >
              <defs>
                <filter id="v3-glow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
                <radialGradient id="v3-aura" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="rgba(0,243,255,0.15)" />
                  <stop offset="50%" stopColor="rgba(139,92,246,0.08)" />
                  <stop offset="100%" stopColor="transparent" />
                </radialGradient>
              </defs>

              <circle cx="0" cy="0" r={size * 0.85} fill="url(#v3-aura)" />

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
                  <linearGradient id="v3-radar-grad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="rgba(0,243,255,0)" />
                    <stop offset="100%" stopColor="rgba(0,243,255,0.1)" />
                  </linearGradient>
                </defs>
                <path
                  d={`M 0 0 L ${size * 0.9} 0 A ${size * 0.9} ${size * 0.9} 0 0 1 ${size * 0.9 * Math.cos(0.3)} ${size * 0.9 * Math.sin(0.3)} Z`}
                  fill="url(#v3-radar-grad)"
                  opacity="0.4"
                />
              </g>

              {/* Inter-agent neural mesh */}
              {agentPositions.map(({ agent, x, y }, i) => {
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
                      className="v3-neural-link"
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

              {/* Core-to-agent conduits */}
              {agentPositions.map(({ agent, x, y }) => {
                const isActive = activeAgentId === agent.id;
                const isHovered = hoveredAgent === agent.id;
                const isFocused = focusedAgentId === agent.id;
                const isDimmed = isAnyFocused && !isFocused;
                const path = bezierPath(0, 0, x, y, 0.2);
                const showEnergy = isActive || isHovered || isFocused;
                return (
                  <g key={`conduit-${agent.id}`} opacity={isDimmed ? 0.15 : 1}>
                    <path
                      d={path}
                      fill="none"
                      stroke={agent.color}
                      strokeWidth={showEnergy ? 8 : 3}
                      opacity={showEnergy ? 0.15 : 0.04}
                      style={{ filter: 'blur(6px)' }}
                    />
                    <path
                      d={path}
                      fill="none"
                      stroke={showEnergy ? agent.color : `${agent.color}25`}
                      strokeWidth={showEnergy ? 1.5 : 0.8}
                      className={cn('v3-neural-link', showEnergy && 'v3-neural-link-active')}
                      style={{ filter: showEnergy ? `drop-shadow(0 0 6px ${agent.color}80)` : undefined }}
                    />
                    {showEnergy && (
                      <>
                        <circle r="3.5" fill={agent.color} filter="url(#v3-glow)" className="v3-energy-packet">
                          <animateMotion dur="2s" repeatCount="indefinite" path={path} />
                        </circle>
                        <circle r="2" fill={agent.color} opacity="0.6" className="v3-energy-packet">
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

            {/* Rotating outer rings */}
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

            {/* Energy waves (idle) */}
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

            {/* Central Temo Reactor */}
            <div
              className={cn('v3-reactor-core relative z-20', isAnyFocused && 'opacity-40')}
              style={{ width: size * 0.5, height: size * 0.5 }}
              onClick={() => setFocusedAgentId(null)}
            >
              <ReactorOrb state={orbState} size={size * 0.5} volume={volume} color={chief?.color ?? '#00E5FF'} />
            </div>

            {/* Temo label */}
            <div className="absolute z-20 flex flex-col items-center" style={{ top: 'calc(50% + ' + size * 0.28 + 'px)' }}>
              <span className="font-grotesk text-sm font-bold text-glow-primary" style={{ color: chief?.color }}>
                {chief?.name}
              </span>
              <span className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">Chief AI</span>
            </div>

            {/* Agent entities */}
            {agentPositions.map(({ agent, x, y }, i) => (
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
                    setFocusedAgentId(null);
                  } else {
                    setFocusedAgentId(agent.id);
                  }
                  router.push('/agents');
                }}
              />
            ))}
          </div>
        </div>

        {/* Bottom HUD: Active agents strip */}
        <div className="absolute bottom-0 left-0 right-0 z-20">
          <div className="flex items-center justify-center gap-1.5 px-4 py-3">
            {specialists.map((mgr, i) => (
              <AgentNodeChip
                key={mgr.id}
                agent={mgr}
                index={i}
                active={mgr.id === activeAgentId}
                onClick={() => router.push('/agents')}
              />
            ))}
          </div>
        </div>

        {/* Top-right: Active agent callout */}
        <AnimatePresence>
          {activeAgent && activeAgent.id !== 'temo' && (
            <motion.div
              key={activeAgent.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="absolute right-4 top-4 z-30 flex items-center gap-2 rounded-lg px-3 py-1.5"
              style={{
                background: `${activeAgent.color}12`,
                border: `1px solid ${activeAgent.color}40`,
                boxShadow: `0 0 16px ${activeAgent.color}20`,
                backdropFilter: 'blur(12px)',
              }}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{
                  backgroundColor: activeAgent.color,
                  boxShadow: `0 0 8px ${activeAgent.color}`,
                  animation: 'pulse-glow 2s ease-in-out infinite',
                }}
              />
              <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: activeAgent.color }}>
                {activeAgent.name} engaged
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* ── Lower Arena: Missions + Activity ── */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="relative">
          <SectionLabel icon={Target} title="Active Missions" accent="#10B981" />
          <div className="space-y-2">
            {workflows.slice(0, 4).map((w, i) => (
              <MissionReadout
                key={w.id}
                name={w.name}
                status={w.status}
                progress={w.progress}
                steps={w.steps}
                lastRun={w.lastRun}
                index={i}
                onClick={() => router.push('/missions')}
              />
            ))}
          </div>
        </div>
        <div className="relative">
          <SectionLabel icon={Activity} title="Activity Stream" accent="#8B5CF6" />
          <div className="space-y-1">
            {activity.slice(0, 6).map((a, i) => (
              <ActivityStreamItem key={a.id} item={a} index={i} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Reactor Orb ──
function ReactorOrb({ state, size, volume, color }: { state: OrbState; size: number; volume: number; color: string }) {
  const scaleBoost = state === 'speaking' ? 1 + volume * 0.25 : 1;
  const secondaryColor = '#7B61FF';

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <motion.div
        className="absolute rounded-full"
        style={{
          width: size * 3.2, height: size * 3.2,
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
                top: '50%', left: '50%',
                backgroundColor: i % 2 === 0 ? color : secondaryColor,
                boxShadow: `0 0 8px ${i % 2 === 0 ? color : secondaryColor}`,
                transform: `translate(${size * (0.6 + i * 0.06)}px, -50%)`,
              }}
            />
          </motion.div>
        ))}

      {state === 'speaking' &&
        Array.from({ length: 16 }).map((_, i) => (
          <motion.div
            key={i}
            className="absolute origin-center"
            style={{
              width: 2, height: size * 0.6,
              background: `linear-gradient(to top, ${i % 2 === 0 ? color : secondaryColor}, transparent)`,
              transform: `rotate(${i * 22.5}deg) translateY(-${size * 0.4}px)`,
            }}
            animate={{ opacity: [0, 0.7, 0], scaleY: [0.5, 1, 0.5] }}
            transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.05, ease: 'easeInOut' }}
          />
        ))}

      <motion.div
        className="v3-reactor-pulse relative rounded-full ring-1 ring-white/20"
        style={{
          width: size, height: size,
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
        <motion.div
          className="absolute inset-0 rounded-full opacity-30"
          style={{ background: 'radial-gradient(circle at 70% 70%, transparent 40%, rgba(255,255,255,0.12) 100%)' }}
          animate={{ opacity: [0.2, 0.4, 0.2] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        />

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

        <div className="absolute inset-0 flex items-center justify-center">
          <Sparkles className="h-1/3 w-1/3 text-white/80" />
        </div>
      </motion.div>
    </div>
  );
}

// ── Agent Entity ──
function AgentEntity({
  agent, x, y, index, isActive, isHovered, isFocused, isDimmed, orbState, volume, onHover, onClick,
}: {
  agent: Agent; x: number; y: number; index: number;
  isActive: boolean; isHovered: boolean; isFocused: boolean; isDimmed: boolean;
  orbState: OrbState; volume: number;
  onHover: (id: string | null) => void; onClick: () => void;
}) {
  const Icon = AGENT_ICONS[agent.icon] ?? Sparkles;
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
      className={cn('v3-agent-entity absolute left-1/2 top-1/2 z-10 cursor-pointer', isDimmed && 'v3-agent-receded')}
      style={{ marginLeft: -32, marginTop: -32 }}
    >
      {showHalo && (
        <motion.div
          className="absolute -inset-5 rounded-full"
          style={{ background: `radial-gradient(circle, ${agent.color}30 0%, transparent 70%)` }}
          animate={{ opacity: [0.3, 0.6, 0.3], scale: [1, 1.3, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
      )}

      <motion.div
        animate={{ y: [0, -6, 0], x: [0, 3, 0] }}
        transition={{ duration: 5 + index, repeat: Infinity, ease: 'easeInOut', delay: index * 0.3 }}
      >
        <div className="relative flex flex-col items-center gap-1">
          <div className="relative">
            <motion.div
              className="v3-agent-core relative flex items-center justify-center rounded-full"
              style={{
                width: 62, height: 62,
                background: `radial-gradient(circle at 30% 30%, ${agent.color}, ${agent.color}99)`,
                boxShadow: showHalo
                  ? `0 0 24px ${agent.color}80, inset 0 0 12px rgba(255,255,255,0.12)`
                  : `0 0 12px ${agent.color}40, inset 0 0 8px rgba(255,255,255,0.08)`,
                border: `1px solid ${agent.color}40`,
              }}
              animate={{ scale: isActive && orbState === 'speaking' ? 1 + volume * 0.15 : 1 }}
            >
              <Icon className="h-5 w-5 text-white drop-shadow-[0_0_6px_rgba(255,255,255,0.5)]" />
              <span
                className="absolute inset-1 rounded-full border border-white/10"
                style={{ borderTopColor: `${agent.color}90`, borderRightColor: `${agent.color}50` }}
              />
              <span
                className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{ backgroundColor: 'rgba(255,255,255,0.6)', boxShadow: `0 0 6px ${agent.color}` }}
              />
            </motion.div>

            <span
              className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background"
              style={{
                backgroundColor: agent.status === 'available' ? agent.color : '#94A3B8',
                animation: agent.status === 'available' ? 'pulse-glow 2s ease-in-out infinite' : undefined,
              }}
            />

            {isFocused && (
              <motion.div
                className="absolute -inset-2 rounded-full border-2 border-dashed"
                style={{ borderColor: `${agent.color}60` }}
                animate={{ rotate: 360 }}
                transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
              />
            )}
          </div>

          <div className="text-center">
            <div
              className={cn('text-xs font-medium transition-colors', (isActive || isFocused) && 'text-glow-primary')}
              style={isActive || isFocused ? { color: agent.color } : {}}
            >
              {agent.name}
            </div>
            <div className="text-[8px] uppercase tracking-wider text-muted-foreground">{agent.role.split(' ')[0]}</div>
          </div>

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
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: agent.color, boxShadow: `0 0 4px ${agent.color}` }} />
                  <span className="font-mono text-[9px] uppercase tracking-wider" style={{ color: agent.color }}>{agent.status}</span>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">{agent.role}</p>
                <p className="mt-0.5 text-[9px] text-muted-foreground/70">{agent.memory.conversationCount} conversations</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Telemetry HUD item ──
function TelemetryItem({ icon: Icon, label, value, unit }: { icon: typeof Cpu; label: string; value: number | string; unit?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="h-3 w-3 text-temo-cyan/60" />
      <span className="font-mono text-[9px] uppercase tracking-wider text-temo-titanium">{label}</span>
      <span className="font-mono text-[11px] font-bold text-temo-led">
        {value}{unit && <span className="ml-0.5 text-[9px] text-temo-titanium">{unit}</span>}
      </span>
    </div>
  );
}

// ── Agent node chip ──
function AgentNodeChip({ agent, index, active, onClick }: { agent: Agent; index: number; active: boolean; onClick: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4 + index * 0.06 }}
      whileHover={{ y: -2 }}
      onClick={onClick}
      className="group flex cursor-pointer items-center gap-2 rounded-full px-2.5 py-1 transition-all"
      style={{
        background: active ? `${agent.color}15` : 'rgba(255,255,255,0.02)',
        border: `1px solid ${active ? agent.color + '50' : 'rgba(255,255,255,0.05)'}`,
        boxShadow: active ? `0 0 10px ${agent.color}25` : 'none',
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{
          backgroundColor: agent.color,
          boxShadow: active ? `0 0 6px ${agent.color}` : 'none',
          animation: agent.status === 'available' ? 'pulse-glow 2s ease-in-out infinite' : undefined,
        }}
      />
      <span className="font-mono text-[9px] uppercase tracking-wider transition-colors" style={{ color: active ? agent.color : 'var(--muted-foreground)' }}>
        {agent.name}
      </span>
    </motion.div>
  );
}

// ── Section label ──
function SectionLabel({ icon: Icon, title, accent }: { icon: typeof Target; title: string; accent: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <div className="flex h-6 w-6 items-center justify-center rounded" style={{ background: `${accent}15`, border: `1px solid ${accent}30` }}>
        <Icon className="h-3 w-3" style={{ color: accent }} />
      </div>
      <span className="font-mono text-[10px] uppercase tracking-widest text-temo-led">{title}</span>
      <div className="h-px flex-1" style={{ background: `linear-gradient(90deg, ${accent}30, transparent)` }} />
    </div>
  );
}

// ── Mission readout ──
function MissionReadout({
  name, status, progress, steps, lastRun, index, onClick,
}: {
  name: string; status: string; progress: number; steps: number; lastRun: string; index: number; onClick: () => void;
}) {
  const statusColor =
    status === 'running' ? '#10B981' :
    status === 'error' ? '#EF4444' :
    status === 'paused' ? '#F59E0B' : '#94A3B8';

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      onClick={onClick}
      className={cn('v3-mission-signal group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-all hover:bg-temo-cyan/5')}
      style={{ borderLeft: `2px solid ${statusColor}40` }}
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{
          backgroundColor: statusColor,
          boxShadow: status === 'running' ? `0 0 6px ${statusColor}` : 'none',
          animation: status === 'running' ? 'pulse-glow 2s ease-in-out infinite' : undefined,
        }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-sans text-sm text-temo-led truncate">{name}</span>
          <span className="font-mono text-[9px] uppercase tracking-wider" style={{ color: statusColor }}>{status}</span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-temo-cyan/5">
            {status === 'running' && <div className="absolute inset-0 signal-stream opacity-40" />}
            <motion.div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{ background: `linear-gradient(90deg, ${statusColor}, ${statusColor}80)` }}
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ delay: 0.3 + index * 0.1, duration: 0.8, ease: 'easeOut' }}
            />
          </div>
          <span className="font-mono text-[9px] text-temo-titanium">{progress}%</span>
          <span className="font-mono text-[9px] text-temo-titanium/50">{lastRun}</span>
        </div>
      </div>
      <ChevronRight className="h-3 w-3 text-temo-titanium/30 transition-transform group-hover:translate-x-0.5 group-hover:text-temo-cyan/50" />
    </motion.div>
  );
}

// ── Activity stream item ──
function ActivityStreamItem({ item, index }: { item: { id: string; label: string; detail: string; time: string; type: string }; index: number }) {
  const typeColor =
    item.type === 'workflow' ? '#10B981' :
    item.type === 'voice' ? '#EC4899' :
    item.type === 'system' ? '#8B5CF6' : '#00F3FF';

  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04 }}
      className="v3-activity-tape flex items-start gap-2.5 rounded-md px-2.5 py-2 pl-3 transition-colors hover:bg-temo-cyan/5"
    >
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: typeColor, boxShadow: `0 0 4px ${typeColor}60` }} />
      <div className="flex-1 min-w-0">
        <p className="font-sans text-xs text-temo-led">{item.label}</p>
        <p className="font-mono text-[10px] text-temo-titanium">{item.detail}</p>
      </div>
      <span className="shrink-0 font-mono text-[9px] text-temo-titanium/50">{item.time}</span>
    </motion.div>
  );
}
