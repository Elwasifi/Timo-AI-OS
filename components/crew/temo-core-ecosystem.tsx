'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { Brain, Network, Wrench, Sparkles, Cpu, Activity } from 'lucide-react';
import { TemoCore } from '@/components/crew/temo-core';
import { useDashboardStore } from '@/stores/dashboardStore';
import { useOrchestrationStore } from '@/stores/orchestrationStore';
import { useVoiceStore } from '@/stores/voiceStore';
import { useRotatingState } from '@/hooks/use-rotating-state';
import { authFetch } from '@/lib/api/authFetch';
import { cn } from '@/lib/utils';

// ── API response types ──

interface MemoryStats {
  totalMemories: number;
  byType: Record<string, number>;
  embeddings: number;
  links: number;
  events: number;
}

interface KnowledgeStats {
  totalFacts: number;
  byCategory: Record<string, number>;
  averageConfidence: number;
  conflicts: number;
}

interface ToolUsageStats {
  totalTools: number;
  byCategory: Record<string, number>;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
}

interface MissionSummary {
  total: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  paused: number;
  averageProgress: number;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface SatelliteData {
  memory: MemoryStats | null;
  knowledge: KnowledgeStats | null;
  tools: ToolUsageStats | null;
  missions: MissionSummary | null;
}

// ── Satellite positions — asymmetric hexagonal arrangement ──
const SATELLITE_POSITIONS = [
  { x: -0.85, y: -0.72 },
  { x: 0.85, y: -0.72 },
  { x: -0.85, y: 0.72 },
  { x: 0.85, y: 0.72 },
] as const;

const TEMO_STATES = ['Thinking', 'Planning', 'Learning', 'Optimizing', 'Delegating'];

function bezierPath(x1: number, y1: number, x2: number, y2: number, curve = 0.3): string {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const perpX = -dy * curve;
  const perpY = dx * curve;
  return `M ${x1} ${y1} Q ${mx + perpX} ${my + perpY} ${x2} ${y2}`;
}

// ── Ambient particle field ──
function ParticleField({ size }: { size: number }) {
  const particles = useMemo(
    () =>
      Array.from({ length: 28 }).map((_, i) => ({
        id: i,
        x: (Math.random() - 0.5) * size * 2.2,
        y: (Math.random() - 0.5) * size * 2.2,
        duration: 6 + Math.random() * 10,
        delay: Math.random() * 5,
        size: 1 + Math.random() * 2,
        color: i % 3 === 0 ? '#00F3FF' : i % 3 === 1 ? '#8B5CF6' : '#0088FF',
      })),
    [size]
  );

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ pointerEvents: 'none' }}>
      {particles.map((p) => (
        <motion.span
          key={p.id}
          className="absolute left-1/2 top-1/2 rounded-full chamber-particle"
          style={{
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
            boxShadow: `0 0 ${p.size * 3}px ${p.color}`,
            opacity: 0.4,
            '--tw-translate-x': `${p.x}px`,
            '--tw-translate-y': `${p.y}px`,
          } as React.CSSProperties}
          animate={{
            x: [p.x - 20, p.x + 20, p.x - 20],
            y: [p.y - 15, p.y + 15, p.y - 15],
            opacity: [0.15, 0.5, 0.15],
          }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  );
}

// ── Hexagonal environmental node ──
function HexNode({
  icon: Icon,
  label,
  sublabel,
  color,
  value,
  detail,
  pulse,
  isHovered,
  isFocused,
  onHover,
  onClick,
  delay,
}: {
  icon: typeof Brain;
  label: string;
  sublabel: string;
  color: string;
  value: string | null;
  detail: string;
  pulse: boolean;
  isHovered: boolean;
  isFocused: boolean;
  onHover: (id: string | null) => void;
  onClick: () => void;
  delay: number;
}) {
  const showHighlight = isHovered || isFocused;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.3 }}
      animate={{ opacity: 1, scale: isFocused ? 1.15 : 1 }}
      transition={{ delay, type: 'spring', stiffness: 100, damping: 16 }}
      whileHover={{ scale: isFocused ? 1.2 : 1.1, zIndex: 30 }}
      onHoverStart={() => onHover(label)}
      onHoverEnd={() => onHover(null)}
      onClick={onClick}
      className="absolute left-1/2 top-1/2 z-20 cursor-pointer"
      style={{ marginLeft: -60, marginTop: -60 }}
    >
      {/* Atmospheric glow */}
      <motion.div
        className="absolute -inset-6"
        style={{
          background: `radial-gradient(circle, ${color}20 0%, transparent 65%)`,
          filter: 'blur(10px)',
        }}
        animate={{ opacity: pulse ? [0.4, 0.7, 0.4] : [0.2, 0.35, 0.2], scale: pulse ? [1, 1.15, 1] : 1 }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Hexagonal structure */}
      <div className="relative" style={{ width: 120, height: 120 }}>
        <svg className="absolute inset-0" viewBox="0 0 120 120" style={{ overflow: 'visible' }}>
          <defs>
            <linearGradient id={`hex-grad-${label}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={`${color}30`} />
              <stop offset="100%" stopColor={`${color}08`} />
            </linearGradient>
          </defs>
          <polygon
            points="60,8 104,34 104,86 60,112 16,86 16,34"
            fill={`url(#hex-grad-${label})`}
            stroke={showHighlight ? color : `${color}40`}
            strokeWidth={showHighlight ? 1.5 : 1}
            style={{
              filter: showHighlight ? `drop-shadow(0 0 8px ${color}60)` : `drop-shadow(0 0 4px ${color}20)`,
              transition: 'all 0.3s ease',
            }}
          />
          <polygon
            points="60,20 92,38 92,82 60,100 28,82 28,38"
            fill="none"
            stroke={`${color}15`}
            strokeWidth="0.5"
          />
          {[[60, 8], [104, 34], [104, 86], [60, 112], [16, 86], [16, 34]].map(([cx, cy], i) => (
            <circle key={i} cx={cx} cy={cy} r="1.5" fill={color} opacity={showHighlight ? 0.8 : 0.3} />
          ))}
        </svg>

        {/* Content overlay */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
          <div
            className="relative flex h-9 w-9 items-center justify-center rounded-full"
            style={{
              background: `radial-gradient(circle at 30% 30%, ${color}50, ${color}10)`,
              border: `1px solid ${color}60`,
              boxShadow: pulse ? `0 0 14px ${color}50` : `0 0 6px ${color}25`,
            }}
          >
            <Icon className="h-4 w-4" style={{ color }} />
            {pulse && (
              <span
                className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full"
                style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }}
              />
            )}
          </div>

          <span className="font-sans text-[11px] font-semibold text-temo-led">{label}</span>
          <span className="font-mono text-[7px] uppercase tracking-wider text-temo-titanium">{sublabel}</span>

          <AnimatePresence mode="wait">
            {value !== null ? (
              <motion.span
                key={value}
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                className="font-mono text-sm font-bold leading-none"
                style={{ color, textShadow: `0 0 10px ${color}60` }}
              >
                {value}
              </motion.span>
            ) : (
              <span className="font-mono text-sm font-bold leading-none text-temo-titanium/40">—</span>
            )}
          </AnimatePresence>

          <span className="text-center font-mono text-[7px] leading-tight text-temo-titanium/60">{detail}</span>
        </div>

        {/* Rotating accent ring on hover/focus */}
        {showHighlight && (
          <motion.div
            className="absolute -inset-2"
            animate={{ rotate: 360 }}
            transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
          >
            <svg viewBox="0 0 140 140" className="h-full w-full">
              <polygon
                points="70,14 118,42 118,98 70,126 22,98 22,42"
                fill="none"
                stroke={`${color}30`}
                strokeWidth="0.5"
                strokeDasharray="4 6"
              />
            </svg>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

// ── Main Ecosystem Component ──

export function TemoCoreEcosystem({ size = 320 }: { size?: number }) {
  const router = useRouter();
  const agents = useDashboardStore((s) => s.agents);
  const activeAgentId = useOrchestrationStore((s) => s.activeAgentId);
  const orbState = useVoiceStore((s) => s.orbState);
  const stateText = useRotatingState(TEMO_STATES, 4000);

  const [satData, setSatData] = useState<SatelliteData>({
    memory: null,
    knowledge: null,
    tools: null,
    missions: null,
  });
  const [loading, setLoading] = useState(true);
  const [hoveredSat, setHoveredSat] = useState<string | null>(null);
  const [focusedSat, setFocusedSat] = useState<string | null>(null);
  const [focusedAgentId, setFocusedAgentId] = useState<string | null>(null);

  const fetchSatelliteData = useCallback(async () => {
    try {
      const [memRes, knowRes, toolRes, missionRes] = await Promise.allSettled([
        // M7-07b: same root cause as M7-07's health badge — these are
        // auth-required routes (lib/auth/apiAuth.ts's requireUser() only
        // reads the Authorization header, never cookies) but were called
        // with plain fetch(), so they always 401'd for a real signed-in
        // user. authFetch() (lib/api/authFetch.ts) attaches the session's
        // Bearer token.
        authFetch('/api/stats/memory').then((r) => r.json() as Promise<ApiEnvelope<{ stats: MemoryStats }>>),
        authFetch('/api/stats/knowledge').then((r) => r.json() as Promise<ApiEnvelope<{ stats: KnowledgeStats }>>),
        authFetch('/api/stats/tools').then((r) => r.json() as Promise<ApiEnvelope<{ stats: ToolUsageStats }>>),
        authFetch('/api/missions/summary').then((r) => r.json() as Promise<ApiEnvelope<{ summary: MissionSummary }>>),
      ]);

      setSatData({
        memory: memRes.status === 'fulfilled' && memRes.value?.success ? memRes.value.data.stats : null,
        knowledge: knowRes.status === 'fulfilled' && knowRes.value?.success ? knowRes.value.data.stats : null,
        tools: toolRes.status === 'fulfilled' && toolRes.value?.success ? toolRes.value.data.stats : null,
        missions: missionRes.status === 'fulfilled' && missionRes.value?.success ? missionRes.value.data.summary : null,
      });
    } catch {
      // Keep null states
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSatelliteData();
    const interval = setInterval(() => void fetchSatelliteData(), 30000);
    return () => clearInterval(interval);
  }, [fetchSatelliteData]);

  const specialists = useMemo(() => agents.filter((a) => a.id !== 'temo'), [agents]);
  const activeAgent = useMemo(
    () => agents.find((a) => a.id === activeAgentId) ?? null,
    [agents, activeAgentId]
  );

  const satelliteRadius = size * 1.05;

  const satellites = useMemo(
    () => [
      {
        id: 'brain',
        icon: Brain,
        label: 'Brain',
        sublabel: 'Memory Engine',
        color: '#8B5CF6',
        position: SATELLITE_POSITIONS[0],
        value: satData.memory ? `${satData.memory.totalMemories}` : null,
        detail: satData.memory
          ? satData.memory.totalMemories > 0
            ? `${satData.memory.embeddings} emb`
            : 'Empty'
          : loading ? 'Loading…' : 'Offline',
        route: '/memory',
        pulse: satData.memory ? satData.memory.totalMemories > 0 : false,
      },
      {
        id: 'knowledge',
        icon: Network,
        label: 'Knowledge',
        sublabel: 'Graph Engine',
        color: '#00E5FF',
        position: SATELLITE_POSITIONS[1],
        value: satData.knowledge ? `${satData.knowledge.totalFacts}` : null,
        detail: satData.knowledge
          ? satData.knowledge.totalFacts > 0
            ? `${satData.knowledge.averageConfidence}% conf`
            : 'Empty'
          : loading ? 'Loading…' : 'Offline',
        route: '/knowledge',
        pulse: satData.knowledge ? satData.knowledge.totalFacts > 0 : false,
      },
      {
        id: 'missions',
        icon: Sparkles,
        label: 'Swarm',
        sublabel: 'Missions',
        color: '#10B981',
        position: SATELLITE_POSITIONS[2],
        value: satData.missions ? `${satData.missions.running}` : null,
        detail: satData.missions
          ? satData.missions.total > 0
            ? `${satData.missions.total} · ${satData.missions.averageProgress}%`
            : 'Idle'
          : loading ? 'Loading…' : 'Offline',
        route: '/missions',
        pulse: satData.missions ? satData.missions.running > 0 : false,
      },
      {
        id: 'tools',
        icon: Wrench,
        label: 'Tools',
        sublabel: 'n8n / MCP',
        color: '#F59E0B',
        position: SATELLITE_POSITIONS[3],
        value: satData.tools ? `${satData.tools.totalTools}` : null,
        detail: satData.tools
          ? satData.tools.totalTools > 0
            ? `${satData.tools.totalExecutions} runs`
            : 'None'
          : loading ? 'Loading…' : 'Offline',
        route: '/tools',
        pulse: satData.tools ? satData.tools.totalTools > 0 : false,
      },
    ],
    [satData, loading]
  );

  const satPositions = useMemo(
    () =>
      satellites.map((sat) => ({
        ...sat,
        absX: sat.position.x * satelliteRadius,
        absY: sat.position.y * satelliteRadius,
      })),
    [satellites, satelliteRadius]
  );

  const crossConnections = useMemo(
    () => [
      { from: 0, to: 1 },
      { from: 1, to: 3 },
      { from: 3, to: 2 },
      { from: 2, to: 0 },
    ],
    []
  );

  const isAnySatFocused = focusedSat !== null;

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size * 2.4, height: size * 2.4, maxWidth: '100%' }}
    >
      {/* ── Chamber environment layers ── */}
      <div className="chamber-fog" />
      <div className="god-rays" />

      {/* Concentric floor pedestal rings */}
      <div className="chamber-pedestal" style={{ width: size * 2, height: size * 2 }}>
        {[0.35, 0.55, 0.75, 0.95].map((r, i) => (
          <div
            key={`pedestal-${i}`}
            className="chamber-pedestal-ring"
            style={{
              width: size * 2 * r,
              height: size * 2 * r,
              animationDelay: `${i * 0.8}s`,
            }}
          />
        ))}
      </div>

      {/* ── Deep space backdrop ── */}
      <div
        className="absolute rounded-full"
        style={{
          width: size * 2,
          height: size * 2,
          background: 'radial-gradient(circle, rgba(0,243,255,0.05) 0%, rgba(139,92,246,0.025) 35%, transparent 65%)',
          filter: 'blur(50px)',
        }}
      />

      {/* ── Ambient particle field ── */}
      <ParticleField size={size} />

      {/* ── Main SVG network layer ── */}
      <svg
        className="absolute inset-0"
        viewBox={`${-size * 1.2} ${-size * 1.2} ${size * 2.4} ${size * 2.4}`}
        style={{ overflow: 'visible', pointerEvents: 'none' }}
      >
        <defs>
          <filter id="ecosystem-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Concentric depth rings */}
        {[0.35, 0.52, 0.72, 0.92, 1.12].map((r, i) => (
          <circle
            key={`depth-${i}`}
            cx="0" cy="0" r={size * r}
            fill="none"
            stroke={
              i === 0 ? 'rgba(0,243,255,0.12)'
              : i === 1 ? 'rgba(0,243,255,0.07)'
              : i === 2 ? 'rgba(139,92,246,0.05)'
              : i === 3 ? 'rgba(0,243,255,0.03)'
              : 'rgba(0,243,255,0.018)'
            }
            strokeWidth={i === 0 ? 1 : 0.5}
            strokeDasharray={i >= 2 ? '2 8' : undefined}
          />
        ))}

        {/* Radar sweep */}
        <g className="animate-radar-sweep" style={{ transformOrigin: 'center' }}>
          <defs>
            <linearGradient id="eco-radar-grad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="rgba(0,243,255,0)" />
              <stop offset="100%" stopColor="rgba(0,243,255,0.08)" />
            </linearGradient>
          </defs>
          <path
            d={`M 0 0 L ${size * 1.12} 0 A ${size * 1.12} ${size * 1.12} 0 0 1 ${size * 1.12 * Math.cos(0.25)} ${size * 1.12 * Math.sin(0.25)} Z`}
            fill="url(#eco-radar-grad)"
            opacity="0.6"
          />
        </g>

        {/* Cross-network connections */}
        {crossConnections.map((conn, i) => {
          const from = satPositions[conn.from];
          const to = satPositions[conn.to];
          const path = bezierPath(from.absX, from.absY, to.absX, to.absY, 0.25);
          const isRelated = hoveredSat === from.label || hoveredSat === to.label ||
                            focusedSat === from.label || focusedSat === to.label;
          return (
            <g key={`cross-${i}`}>
              <path
                d={path}
                fill="none"
                stroke={isRelated ? `${from.color}40` : 'rgba(0,243,255,0.08)'}
                strokeWidth={isRelated ? 1 : 0.5}
                strokeDasharray="2 6"
                opacity={isRelated ? 0.6 : 0.4}
                className={cn(isRelated && 'neural-conduit')}
              />
              <circle r="1.5" fill={from.color} opacity="0.5">
                <animateMotion
                  dur={`${6 + i * 2}s`}
                  repeatCount="indefinite"
                  path={path}
                  begin={`${i * 1.5}s`}
                />
              </circle>
            </g>
          );
        })}

        {/* Satellite connection conduits */}
        {satPositions.map((sat) => {
          const isHovered = hoveredSat === sat.label;
          const isFocused = focusedSat === sat.label;
          const showHighlight = isHovered || isFocused;
          const path = bezierPath(0, 0, sat.absX, sat.absY, 0.2);
          return (
            <g key={`conduit-${sat.id}`}>
              <path
                d={path}
                fill="none"
                stroke={sat.color}
                strokeWidth={showHighlight ? 8 : 4}
                opacity={showHighlight ? 0.2 : 0.06}
                style={{ filter: 'blur(6px)' }}
              />
              <path
                d={path}
                fill="none"
                stroke={showHighlight ? sat.color : `${sat.color}30`}
                strokeWidth={showHighlight ? 2 : 1}
                strokeDasharray="6 4"
                className={cn('transition-all duration-300', showHighlight && 'neural-conduit')}
                style={{ filter: showHighlight ? `drop-shadow(0 0 8px ${sat.color}80)` : undefined }}
              />
              {sat.pulse && (
                <circle r="3.5" fill={sat.color} filter="url(#ecosystem-glow)">
                  <animateMotion dur="3.5s" repeatCount="indefinite" path={path} />
                </circle>
              )}
              {sat.pulse && (
                <circle r="2" fill={sat.color} opacity="0.5">
                  <animateMotion dur="5s" repeatCount="indefinite" path={path} begin="1.5s" />
                </circle>
              )}
            </g>
          );
        })}

        {/* Inner ambient rings */}
        <circle cx="0" cy="0" r={size * 0.24} fill="none" stroke="rgba(0,243,255,0.14)" strokeWidth="0.5" />
        <circle cx="0" cy="0" r={size * 0.30} fill="none" stroke="rgba(139,92,246,0.08)" strokeWidth="0.3" />
      </svg>

      {/* ── Central TemoCore ── */}
      <div className="relative z-10">
        <TemoCore
          size={size}
          showAgents={true}
          focusedAgentId={focusedAgentId}
          onAgentFocus={setFocusedAgentId}
          onAgentClick={() => router.push('/agents')}
        />
      </div>

      {/* ── Hexagonal satellite nodes ── */}
      {satPositions.map((sat, i) => (
        <div
          key={sat.id}
          className="absolute"
          style={{
            left: '50%',
            top: '50%',
            transform: `translate(${sat.absX}px, ${sat.absY}px) translate(-50%, -50%)`,
            zIndex: 20,
          }}
        >
          <HexNode
            icon={sat.icon}
            label={sat.label}
            sublabel={sat.sublabel}
            color={sat.color}
            value={sat.value}
            detail={sat.detail}
            pulse={sat.pulse}
            isHovered={hoveredSat === sat.label}
            isFocused={focusedSat === sat.label}
            onHover={setHoveredSat}
            onClick={() => {
              if (focusedSat === sat.label) {
                setFocusedSat(null);
              } else {
                setFocusedSat(sat.label);
              }
              router.push(sat.route);
            }}
            delay={0.3 + i * 0.1}
          />
        </div>
      ))}

      {/* ── Active agent indicator ── */}
      <div
        className="absolute z-20 flex flex-col items-center"
        style={{ top: 'calc(50% + ' + size * 0.44 + 'px)' }}
      >
        <AnimatePresence mode="wait">
          {activeAgent && activeAgent.id !== 'temo' && (
            <motion.div
              key={activeAgent.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="flex items-center gap-2 rounded-full px-3 py-1"
              style={{
                background: `${activeAgent.color}15`,
                border: `1px solid ${activeAgent.color}40`,
                boxShadow: `0 0 12px ${activeAgent.color}20`,
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  backgroundColor: activeAgent.color,
                  boxShadow: `0 0 6px ${activeAgent.color}`,
                }}
              />
              <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: activeAgent.color }}>
                {activeAgent.name} active
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Holographic state readout ── */}
      <div
        className="absolute z-20 holo-readout flex flex-col items-center gap-0.5"
        style={{ top: 'calc(50% - ' + size * 0.5 + 'px)' }}
      >
        <span className="font-mono text-[8px] uppercase tracking-[0.3em] text-temo-cyan/50">Temo Core</span>
        <span className="font-mono text-[10px] font-bold text-temo-cyan">{stateText}</span>
      </div>
    </div>
  );
}
