'use client';

import { useMemo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import {
  Sparkles, Code2, Workflow, Wrench, Brain, BookOpen,
  TrendingUp, Palette, PenTool, Cpu, MemoryStick, Network,
  Zap, Radio, Target, Activity, ChevronRight, Database,
  type LucideIcon,
} from 'lucide-react';
import { radialLayout, edgeArc, type PositionedNode, type GBrainNodeStatus } from '@/lib/gbrain/layout';
import { useSystemStore } from '@/stores/systemStore';
import { useVoiceStore } from '@/stores/voiceStore';
import { useDashboardStore } from '@/stores/dashboardStore';
import { useGBrainData } from '@/hooks/use-gbrain-data';
import { useRotatingState } from '@/hooks/use-rotating-state';
import { cn } from '@/lib/utils';

const TEMO_STATES = ['Thinking', 'Planning', 'Learning', 'Optimizing', 'Delegating'];

const DOMAIN_ICONS: Record<string, LucideIcon> = {
  agents: Sparkles,
  missions: Target,
  tools: Wrench,
  memory: Brain,
  knowledge: BookOpen,
};

const ENTITY_ICONS: Record<string, LucideIcon> = {
  temo: Sparkles, nova: Code2, flow: Workflow, atlas: TrendingUp,
  luna: Palette, echo: PenTool, '': Database,
};

const STATUS_COLORS: Record<GBrainNodeStatus, string> = {
  idle: '#64748B',
  available: '#10B981',
  working: '#F59E0B',
  thinking: '#8B5CF6',
  executing: '#00F3FF',
  speaking: '#00F3FF',
  completed: '#10B981',
  error: '#EF4444',
  offline: '#475569',
};

export function GBrainGraph() {
  const router = useRouter();
  const health = useSystemStore((s) => s.health);
  const orbState = useVoiceStore((s) => s.orbState);
  const agents = useDashboardStore((s) => s.agents);
  const stateText = useRotatingState(TEMO_STATES, 4000);

  const { graph, missions, activity, executingAgentIds, activeAgentId } = useGBrainData();

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const W = 720;
  const H = 720;
  const layout = useMemo(() => radialLayout(graph, W, H), [graph]);

  const getNode = useCallback((id: string | null) => {
    if (!id) return null;
    return layout.nodes.get(id) ?? null;
  }, [layout]);

  const hovered = getNode(hoveredId);
  const selected = getNode(selectedId);
  const isFocused = selectedId !== null;

  // Determine if there's a live execution path (Temo → active agent)
  const hasLiveExecution = activeAgentId !== 'temo' || executingAgentIds.size > 0;
  const liveAgentId = activeAgentId !== 'temo' ? activeAgentId : null;
  const liveAgentDomain = liveAgentId
    ? graph.nodes.find((n) => n.id === liveAgentId)?.domainId ?? null
    : null;

  const isEdgeActive = (srcId: string, tgtId: string) => {
    // User hover/selection takes priority
    const focus = selectedId ?? hoveredId;
    if (focus) return srcId === focus || tgtId === focus;
    // Auto-highlight live execution path: core → domain → agent
    if (hasLiveExecution && liveAgentId) {
      if (srcId === 'core' && tgtId === liveAgentDomain) return true;
      if (srcId === liveAgentDomain && tgtId === liveAgentId) return true;
      if (srcId === 'core' && tgtId === liveAgentId) return true;
    }
    // Highlight edges to executing agents
    if (executingAgentIds.size > 0) {
      for (const execId of Array.from(executingAgentIds)) {
        if (execId === 'temo') continue;
        const execDomain = graph.nodes.find((n) => n.id === execId)?.domainId ?? null;
        if (srcId === 'core' && tgtId === execDomain) return true;
        if (srcId === execDomain && tgtId === execId) return true;
      }
    }
    return false;
  };

  const isNodeDimmed = (id: string) => {
    // User hover/selection takes priority
    if (isFocused || hoveredId) {
      const focus = selectedId ?? hoveredId;
      if (id === focus) return false;
      if (selected && (selected.id === id)) return false;
      if (hovered) {
        if (id === hovered.domainId) return false;
        const hDomain = graph.nodes.find((n) => n.id === hovered.domainId);
        if (hDomain && id === hDomain.id) return false;
      }
      if (selected) {
        if (id === selected.domainId) return false;
        const sChildren = graph.nodes.filter((n) => n.domainId === selected.id);
        if (sChildren.some((c) => c.id === id)) return false;
        if (selected.domainId && id === selected.domainId) return false;
      }
      return true;
    }
    // Auto-dim during live execution: only show core, active domain, and active agent
    if (hasLiveExecution && liveAgentId) {
      if (id === 'core') return false;
      if (id === liveAgentDomain) return false;
      if (id === liveAgentId) return false;
      // Show executing agents too
      if (executingAgentIds.has(id)) return false;
      // Show the agents domain
      if (id === 'agents') return false;
      // Show skills leaf of active agent
      if (id === `${liveAgentId}-skills`) return false;
      return true;
    }
    return false;
  };

  return (
    <div className="relative pb-8">
      {/* HUD Telemetry Strip */}
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

      {/* G-Brain Graph */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.15, duration: 0.7, type: 'spring', stiffness: 70 }}
        className="relative mt-4 flex min-h-[640px] items-center justify-center overflow-hidden rounded-2xl"
        style={{ background: 'linear-gradient(180deg, rgba(4,7,13,0.7) 0%, rgba(8,12,20,0.5) 50%, rgba(4,7,13,0.7) 100%)' }}
      >
        <div className="absolute inset-0 dot-grid opacity-25" />
        <div className="absolute inset-0 hex-grid opacity-15" />
        <div className="absolute inset-0 scanline-overlay opacity-40" />
        <div className="v3-chamber-fog" />
        <div className="absolute inset-0 god-rays" />
        <div className="absolute inset-0 v3-holo-scan" />

        {/* Central radial bloom */}
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ width: 800, height: 800, background: 'radial-gradient(circle, rgba(0,243,255,0.06) 0%, rgba(139,92,246,0.03) 25%, transparent 55%)', filter: 'blur(80px)' }}
        />

        {/* Corner brackets */}
        <div className="v3-bracket v3-bracket-tl" style={{ top: 12, left: 12 }} />
        <div className="v3-bracket v3-bracket-tr" style={{ top: 12, right: 12 }} />
        <div className="v3-bracket v3-bracket-bl" style={{ bottom: 12, left: 12 }} />
        <div className="v3-bracket v3-bracket-br" style={{ bottom: 12, right: 12 }} />

        {/* Edge labels */}
        <div className="absolute left-4 top-1/2 -translate-y-1/2 -rotate-90 font-mono text-[8px] uppercase tracking-[0.3em] text-temo-cyan/30">
          G-Brain Neural Graph
        </div>
        <div className="absolute right-4 top-1/2 -translate-y-1/2 rotate-90 font-mono text-[8px] uppercase tracking-[0.3em] text-temo-cyan/30">
          Knowledge Mesh
        </div>

        {/* SVG Graph */}
        <svg
          className="relative z-10"
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          style={{ overflow: 'visible' }}
        >
          <defs>
            <filter id="gbrain-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <radialGradient id="gbrain-aura" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(0,243,255,0.15)" />
              <stop offset="50%" stopColor="rgba(139,92,246,0.08)" />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
          </defs>

          {/* Concentric ring guides */}
          {[0.16, 0.28, 0.38].map((r, i) => {
            const radius = r * Math.min(W, H);
            return (
              <circle
                key={`ring-${i}`}
                cx={W / 2}
                cy={H / 2}
                r={radius}
                fill="none"
                stroke={i === 0 ? 'rgba(0,243,255,0.10)' : 'rgba(0,243,255,0.05)'}
                strokeWidth={0.5}
                strokeDasharray="2 8"
              />
            );
          })}

          {/* Radar sweep */}
          <g className="animate-radar-sweep" style={{ transformOrigin: `${W / 2}px ${H / 2}px` }}>
            <defs>
              <linearGradient id="gbrain-radar-grad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="rgba(0,243,255,0)" />
                <stop offset="100%" stopColor="rgba(0,243,255,0.08)" />
              </linearGradient>
            </defs>
            <path
              d={`M ${W / 2} ${H / 2} L ${W / 2 + 0.38 * Math.min(W, H)} ${H / 2} A ${0.38 * Math.min(W, H)} ${0.38 * Math.min(W, H)} 0 0 1 ${W / 2 + 0.38 * Math.min(W, H) * Math.cos(0.3)} ${H / 2 + 0.38 * Math.min(W, H) * Math.sin(0.3)} Z`}
              fill="url(#gbrain-radar-grad)"
              opacity="0.4"
            />
          </g>

          {/* Edges */}
          {layout.edges.map((edge, i) => {
            const active = isEdgeActive(edge.source.id, edge.target.id);
            const dimmed = (hoveredId || selectedId || hasLiveExecution) && !active;
            const path = edgeArc(edge.source.x, edge.source.y, edge.target.x, edge.target.y, 0.12);
            const edgeActive = (edge as { active?: boolean }).active;
            return (
              <g key={`edge-${i}`}>
                <path
                  d={path}
                  fill="none"
                  stroke={active || edgeActive ? edge.source.color : 'rgba(0,243,255,0.06)'}
                  strokeWidth={active || edgeActive ? 1.5 : 0.5}
                  opacity={dimmed ? 0.1 : active ? 0.6 : edgeActive ? 0.5 : 0.25}
                  className={cn('v3-neural-link', (active || edgeActive) && 'v3-neural-link-active')}
                  style={active || edgeActive ? { filter: `drop-shadow(0 0 4px ${edge.source.color}80)` } : undefined}
                />
                {(active || edgeActive) && (
                  <circle r="2.5" fill={edge.source.color} filter="url(#gbrain-glow)" className="v3-energy-packet">
                    <animateMotion dur="2s" repeatCount="indefinite" path={path} />
                  </circle>
                )}
              </g>
            );
          })}

          {/* Nodes */}
          {Array.from(layout.nodes.values()).map((node) => {
            const isCore = node.kind === 'core';
            const isDomain = node.kind === 'domain';
            const isEntity = node.kind === 'entity';
            const isLeaf = node.kind === 'leaf';
            const dimmed = isNodeDimmed(node.id);
            const isActive = hoveredId === node.id || selectedId === node.id;
            const radius = isCore ? 28 : isDomain ? 18 : isEntity ? 12 : 8;
            const nodeStatus = node.status ?? 'idle';
            const statusColor = STATUS_COLORS[nodeStatus];
            const isExecuting = nodeStatus === 'executing' || nodeStatus === 'working' || nodeStatus === 'thinking';

            return (
              <g
                key={node.id}
                transform={`translate(${node.x}, ${node.y})`}
                className="cursor-pointer"
                onMouseEnter={() => setHoveredId(node.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => {
                  if (selectedId === node.id) setSelectedId(null);
                  else setSelectedId(node.id);
                }}
                opacity={dimmed ? 0.15 : 1}
                style={{ transition: 'opacity 0.3s ease' }}
              >
                {/* Glow halo */}
                {(isActive || isCore || isExecuting) && (
                  <circle
                    r={radius * 2.2}
                    fill={node.color}
                    opacity={isCore ? 0.12 : isExecuting ? 0.1 : 0.08}
                    filter="url(#gbrain-glow)"
                    style={{ transition: 'opacity 0.3s ease' }}
                  />
                )}

                {/* Core pulse rings */}
                {isCore && orbState === 'idle' && (
                  <>
                    <circle r={radius * 1.5} fill="none" stroke={node.color} strokeWidth="0.5" opacity="0.3">
                      <animate attributeName="r" values={`${radius * 1.3};${radius * 2.5}`} dur="3s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.4;0" dur="3s" repeatCount="indefinite" />
                    </circle>
                    <circle r={radius * 1.5} fill="none" stroke={node.color} strokeWidth="0.5" opacity="0.2">
                      <animate attributeName="r" values={`${radius * 1.3};${radius * 2.5}`} dur="3s" repeatCount="indefinite" begin="1.5s" />
                      <animate attributeName="opacity" values="0.3;0" dur="3s" repeatCount="indefinite" begin="1.5s" />
                    </circle>
                  </>
                )}

                {/* Executing node pulse ring */}
                {isExecuting && !isCore && (
                  <circle r={radius * 1.6} fill="none" stroke={statusColor} strokeWidth="0.8" opacity="0.4">
                    <animate attributeName="r" values={`${radius * 1.2};${radius * 2}`} dur="2s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.4;0" dur="2s" repeatCount="indefinite" />
                  </circle>
                )}

                {/* Node circle */}
                <circle
                  r={radius}
                  fill={isCore ? `url(#gbrain-aura)` : isLeaf ? `${node.color}20` : `${node.color}30`}
                  stroke={node.color}
                  strokeWidth={isActive ? 2 : isCore ? 1.5 : 1}
                  opacity={dimmed ? 0.2 : 1}
                  style={{
                    filter: isActive ? `drop-shadow(0 0 8px ${node.color}80)` : isCore ? `drop-shadow(0 0 12px ${node.color}60)` : isExecuting ? `drop-shadow(0 0 6px ${statusColor}60)` : undefined,
                    transition: 'all 0.3s ease',
                  }}
                />

                {/* Core inner orb */}
                {isCore && (
                  <circle
                    r={radius * 0.65}
                    fill={node.color}
                    opacity={0.8}
                    style={{ filter: `drop-shadow(0 0 16px ${node.color})` }}
                  >
                    <animate
                      attributeName="opacity"
                      values={orbState === 'thinking' ? '0.5;1;0.5' : orbState === 'speaking' ? '0.6;1;0.6' : '0.6;0.9;0.6'}
                      dur={orbState === 'thinking' ? '1.5' : '3s'}
                      repeatCount="indefinite"
                    />
                  </circle>
                )}

                {/* Status indicator dot for executing/thinking agents */}
                {isEntity && isExecuting && (
                  <circle cx={radius * 0.7} cy={-radius * 0.7} r={3} fill={statusColor} filter="url(#gbrain-glow)">
                    <animate attributeName="opacity" values="0.5;1;0.5" dur="1.5s" repeatCount="indefinite" />
                  </circle>
                )}

                {/* Node icon placeholder (small dot for entities/leaves) */}
                {!isCore && !isDomain && (
                  <circle r={2.5} fill={node.color} opacity={isActive ? 1 : 0.7} />
                )}

                {/* Domain icon */}
                {isDomain && (
                  <circle r={4} fill={node.color} opacity="0.9" />
                )}

                {/* Label */}
                <text
                  y={radius + 14}
                  textAnchor="middle"
                  className="font-mono"
                  fontSize={isCore ? 11 : isDomain ? 9 : 8}
                  fill={isActive ? node.color : 'rgba(203,213,225,0.7)'}
                  style={{
                    fontWeight: isCore || isDomain ? 600 : 400,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    pointerEvents: 'none',
                    opacity: dimmed ? 0.2 : 1,
                    transition: 'opacity 0.3s ease',
                  }}
                >
                  {node.label}
                </text>

                {/* Meta label for active nodes */}
                {isActive && node.meta && (
                  <text
                    y={radius + 26}
                    textAnchor="middle"
                    className="font-mono"
                    fontSize={7}
                    fill="rgba(148,163,184,0.6)"
                    style={{ pointerEvents: 'none' }}
                  >
                    {node.meta}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* Selected node detail panel */}
        <AnimatePresence>
          {selected && (
            <motion.div
              initial={{ opacity: 0, x: 20, y: 10 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, x: 20, y: 10 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="absolute right-4 top-4 z-30 w-56 rounded-lg border p-3"
              style={{
                background: 'rgba(8,12,20,0.85)',
                borderColor: `${selected.color}40`,
                backdropFilter: 'blur(12px)',
                boxShadow: `0 0 20px ${selected.color}20`,
              }}
            >
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: selected.color, boxShadow: `0 0 6px ${selected.color}` }} />
                <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: selected.color }}>
                  {selected.kind}
                </span>
                {selected.status && selected.status !== 'idle' && (
                  <span className="font-mono text-[9px] uppercase tracking-wider" style={{ color: STATUS_COLORS[selected.status] }}>
                    {selected.status}
                  </span>
                )}
                <button
                  onClick={() => setSelectedId(null)}
                  className="ml-auto text-[10px] text-muted-foreground hover:text-foreground"
                >
                  ✕
                </button>
              </div>
              <p className="mt-2 text-sm font-semibold" style={{ color: selected.color }}>{selected.label}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">{selected.meta}</p>
              {selected.capabilities && selected.capabilities.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {selected.capabilities.slice(0, 4).map((cap) => (
                    <span key={cap} className="rounded px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider" style={{ background: `${selected.color}15`, color: `${selected.color}cc` }}>
                      {cap}
                    </span>
                  ))}
                </div>
              )}

              {/* Navigate button for agents/workflows */}
              {(selected.kind === 'entity' || selected.kind === 'domain') && (
                <button
                  onClick={() => {
                    if (selected.domainId === 'agents' || selected.id === 'agents') router.push('/agents');
                    else if (selected.domainId === 'missions' || selected.id === 'missions') router.push('/missions');
                    else if (selected.domainId === 'tools' || selected.id === 'tools') router.push('/tools');
                    else if (selected.domainId === 'memory' || selected.id === 'memory') router.push('/memory');
                    else if (selected.domainId === 'knowledge' || selected.id === 'knowledge') router.push('/knowledge');
                  }}
                  className="mt-3 flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-[10px] transition-all hover:opacity-80"
                  style={{ borderColor: `${selected.color}30`, background: `${selected.color}10`, color: selected.color }}
                >
                  <span className="font-mono uppercase tracking-wider">Explore</span>
                  <ChevronRight className="h-3 w-3" />
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bottom agent strip — real live status */}
        <div className="absolute bottom-0 left-0 right-0 z-20">
          <div className="flex items-center justify-center gap-1.5 px-4 py-3">
            {agents.filter((a) => a.id !== 'temo').map((mgr, i) => (
              <AgentNodeChip
                key={mgr.id}
                agent={mgr}
                index={i}
                active={activeAgentId === mgr.id || executingAgentIds.has(mgr.id)}
                executing={executingAgentIds.has(mgr.id)}
                onClick={() => router.push('/agents')}
              />
            ))}
          </div>
        </div>
      </motion.div>

      {/* Lower Arena: Missions + Activity */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="relative">
          <SectionLabel icon={Target} title="Active Missions" accent="#10B981" />
          <div className="space-y-2">
            {missions.length > 0 ? (
              missions.map((m, i) => (
                <MissionReadout
                  key={m.id}
                  name={m.name}
                  status={m.status}
                  progress={m.progress}
                  steps={m.steps}
                  lastRun={m.lastRun}
                  index={i}
                  onClick={() => router.push('/missions')}
                />
              ))
            ) : (
              <div className="rounded-lg border border-temo-cyan/10 px-3 py-4 text-center">
                <p className="font-mono text-[10px] uppercase tracking-wider text-temo-titanium/50">No active missions</p>
              </div>
            )}
          </div>
        </div>
        <div className="relative">
          <SectionLabel icon={Activity} title="Activity Stream" accent="#8B5CF6" />
          <div className="space-y-1">
            {activity.length > 0 ? (
              activity.slice(0, 6).map((a, i) => (
                <ActivityStreamItem key={a.id} item={a} index={i} />
              ))
            ) : (
              <div className="rounded-lg border border-temo-cyan/10 px-3 py-4 text-center">
                <p className="font-mono text-[10px] uppercase tracking-wider text-temo-titanium/50">No recent activity</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
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

// ── Agent node chip with live status ──
function AgentNodeChip({ agent, index, active, executing, onClick }: { agent: { id: string; name: string; color: string; status: string }; index: number; active: boolean; executing: boolean; onClick: () => void }) {
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
          backgroundColor: executing ? '#00F3FF' : agent.color,
          boxShadow: active || executing ? `0 0 6px ${executing ? '#00F3FF' : agent.color}` : 'none',
          animation: executing ? 'pulse-glow 1s ease-in-out infinite' : agent.status === 'available' ? 'pulse-glow 2s ease-in-out infinite' : undefined,
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
