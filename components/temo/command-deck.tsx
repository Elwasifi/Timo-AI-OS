'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Bot,
  LayoutDashboard,
  Network,
  Plus,
  ShieldCheck,
  Sparkles,
  Workflow,
  X,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useDashboardStore } from '@/stores/dashboardStore';
import { crewCoordinator } from '@/lib/crew/crew-coordinator';
import { VoiceTrigger } from './voice-trigger';
import { loadAgents, loadBusinessUnitsWithDepartments } from '@/lib/agents/agentRegistryService';
import { listMissions } from '@/lib/swarm/missionService';
import {
  recordToUI,
  TEMO_UI,
  TONE_COLORS,
  type AgentUI,
} from '@/lib/agents/frontendBridge';
import type { Mission } from '@/lib/swarm/types';
import type { BusinessUnitWithDepartments } from '@/lib/agents/types';
import { TopNav } from './top-nav';
import { RightContextPanel } from './right-panel';
import { CommandPalette } from '@/components/layout/command-palette';
import { useUIStore } from '@/stores/uiStore';
import { Holo, VoiceAura, Node } from './holo';
import { NAV_ITEMS } from './left-nav';
import { CommandCenterWidgets } from './command-widgets';

type Snapshot = {
  agents: AgentUI[];
  missions: Mission[];
  metrics: {
    activeAgents: number;
    missions: number;
    completion: number;
    uptime: string;
  };
};

type Point = { x: number; y: number };
type BridgeEdge = { id: string; from: Point; to: Point; color: string; delay: number };
type HeroCluster = { id: string; name: string; themeColor: string; kind: 'corporate' | 'operating'; agents: AgentUI[] };

const SPACE_BACKGROUND =
  'https://hebbkx1anhila5yf.public.blob.vercel-storage.com/Stars_floating_in_space_void_202608161156-9XpFD91iiUbgGWePMBqBu8AAvk8Eha.jpeg';
const AGENT_IMAGES: Record<string, string> = { temo: TEMO_UI.image };

// Settings intentionally not in this list — it's reachable from the
// unified TopNav now (Settings icon) instead of duplicated here too.
const navItems = [
  [LayoutDashboard, 'Overview'],
  [Bot, 'Agents'],
  [Network, 'Network'],
  [Workflow, 'Workflows'],
  [ShieldCheck, 'Security'],
] as const;

const NAV_ROUTES: Record<string, string> = {
  Overview: '/dashboard',
  Agents: '/agents',
  Network: '/',
  Workflows: '/workflows',
  Security: '/validation',
};

const colors: Record<string, string> = TONE_COLORS;

export function Panel({
  title,
  children,
  className = '',
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`hologram-panel ${className}`}>
      <div className="panel-heading">
        <span>{title}</span>
        <span className="panel-signal" />
      </div>
      {children}
    </section>
  );
}

function Stars() {
  return (
    <div
      className="starfield"
      style={{
        backgroundImage: `linear-gradient(rgba(3,7,18,.44),rgba(3,7,18,.7)), url(${SPACE_BACKGROUND})`,
      }}
      aria-hidden
    >
      <div className="star-drift" />
      {Array.from({ length: 70 }, (_, i) => (
        <i
          key={i}
          style={{
            left: `${(i * 37) % 100}%`,
            top: `${(i * 61) % 100}%`,
            animationDelay: `${i % 6}s`,
          }}
        />
      ))}
    </div>
  );
}

function MissionWidget({ data, onCreate }: { data: Snapshot; onCreate: () => void }) {
  return (
    <Panel title="Mission Control" className="widget">
      <button className="panel-add" aria-label="Create mission" onClick={onCreate}>
        <Plus size={14} />
      </button>
      <div className="mission-list">
        {data.missions.length === 0 && <p className="widget-note">No active missions.</p>}
        {data.missions.slice(0, 6).map((m) => (
          <div className="mission-row" key={m.id}>
            <span>{m.title}</span>
            <b>{m.progress}%</b>
            <div>
              <i style={{ width: `${m.progress}%` }} />
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// Command Deck as the real hub: every functional page in the app, one click
// away. Reuses LeftNav's exact NAV_ITEMS — a single source of truth for "the
// app's menu" instead of a second hand-maintained list that could drift.
function QuickAccessWidget({ router }: { router: ReturnType<typeof useRouter> }) {
  const items = NAV_ITEMS.filter((item) => item.path !== '/dashboard');
  return (
    <Panel title="Quick Access" className="widget widget-wide">
      <div className="quick-access-grid">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.path} onClick={() => router.push(item.path)} className="quick-access-tile">
              <Icon size={16} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

export function CommandDeck() {
  const router = useRouter();
  const rightSidebarOpen = useUIStore((s) => s.rightSidebarOpen);
  // M3-07: this page loads its own agent list into local component state
  // (data.agents, below) via lib/agents/agentRegistryService's loadAgents()
  // directly — it never populated the shared useDashboardStore. voiceManager
  // reads its active agent from that shared store (lib/voice/voice-manager.ts's
  // getActiveAgent()), so a user opening Main Dashboard as their first page
  // (never visiting /chat, which does populate the store) hit "No agent
  // selected" the moment they used the voice trigger. Populating the shared
  // store here too — same action app/chat/page.tsx already calls — fixes
  // voice regardless of which page loads first, without touching this
  // page's own local-state rendering.
  const loadDashboardAgents = useDashboardStore((s) => s.loadAgents);
  const dashboardAgents = useDashboardStore((s) => s.agents);
  const [data, setData] = useState<Snapshot | null>(null);
  const [selected, setSelected] = useState<AgentUI | null>(null);
  const [activeNav, setActiveNav] = useState('Overview');
  const [speakingId, setSpeakingId] = useState('temo');
  const [businessUnits, setBusinessUnits] = useState<BusinessUnitWithDepartments[]>([]);
  const [bridgeEdges, setBridgeEdges] = useState<BridgeEdge[]>([]);
  const [bridgeSize, setBridgeSize] = useState({ w: 0, h: 0 });

  const bridgeRef = useRef<HTMLDivElement | null>(null);
  const temoRef = useRef<HTMLSpanElement | null>(null);
  const nodeRefs = useRef<Map<string, HTMLElement>>(new Map());
  const registerNode = useCallback((id: string, el: HTMLElement | null) => {
    if (el) nodeRefs.current.set(id, el);
    else nodeRefs.current.delete(id);
  }, []);

  // Live Command Bridge mirrors G-Brain's own Corporate Office / Operating
  // Company grouping — same live data, same clustering, and now the same
  // measured/animated connection lines (built below) instead of the old
  // decorative fixed-path SVG. Corporate Office renders first (nearest
  // Temo), Operating Companies after — matching G-Brain's own hierarchy.
  const heroClusters = useMemo<HeroCluster[]>(() => {
    const agents = data?.agents ?? [];
    if (agents.length === 0) return [];
    if (businessUnits.length === 0) {
      return [{ id: '__flat', name: '', themeColor: '', kind: 'operating', agents }];
    }
    const unitByAgentId = new Map<string, BusinessUnitWithDepartments>();
    businessUnits.forEach((u) => u.agents.forEach((a) => unitByAgentId.set(a.id, u)));
    const order: string[] = [];
    const grouped = new Map<string, HeroCluster>();
    agents.forEach((agent) => {
      const unit = unitByAgentId.get(agent.id);
      const key = unit?.id ?? '__unassigned';
      if (!grouped.has(key)) {
        order.push(key);
        grouped.set(key, { id: key, name: unit?.name ?? '', themeColor: unit?.themeColor ?? '', kind: unit?.kind ?? 'operating', agents: [] });
      }
      grouped.get(key)!.agents.push(agent);
    });
    return order
      .map((k) => grouped.get(k)!)
      .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'corporate' ? -1 : 1));
  }, [data, businessUnits]);

  const measureBridge = useCallback(() => {
    const stage = bridgeRef.current;
    const temo = temoRef.current;
    if (!stage || !temo) return;
    const base = stage.getBoundingClientRect();
    const point = (el: Element, edge: 'top' | 'bottom'): Point => {
      const r = el.getBoundingClientRect();
      return {
        x: r.left - base.left + stage.scrollLeft + r.width / 2,
        y: (edge === 'bottom' ? r.bottom : r.top) - base.top + stage.scrollTop,
      };
    };
    const temoBottom = point(temo, 'bottom');
    const next: BridgeEdge[] = [];
    let d = 0;
    heroClusters.forEach((cluster) => {
      cluster.agents.forEach((agent) => {
        const el = nodeRefs.current.get(agent.id);
        if (!el) return;
        next.push({ id: agent.id, from: temoBottom, to: point(el, 'top'), color: TONE_COLORS[agent.tone], delay: d });
        d += 0.14;
      });
    });
    setBridgeEdges(next);
    setBridgeSize({ w: stage.clientWidth, h: stage.clientHeight });
  }, [heroClusters]);

  useLayoutEffect(() => {
    measureBridge();
    const t = setTimeout(measureBridge, 300);
    return () => clearTimeout(t);
  }, [measureBridge]);

  useEffect(() => {
    const onResize = () => measureBridge();
    window.addEventListener('resize', onResize);
    const ro = new ResizeObserver(() => measureBridge());
    if (bridgeRef.current) ro.observe(bridgeRef.current);
    return () => {
      window.removeEventListener('resize', onResize);
      ro.disconnect();
    };
  }, [measureBridge]);

  useEffect(() => {
    loadBusinessUnitsWithDepartments().then(setBusinessUnits);
  }, []);

  useEffect(() => {
    if (!data) return;
    const ids = ['temo', ...data.agents.map((a) => a.id)];
    const t = setInterval(() => {
      setSpeakingId((prev) => {
        const i = ids.indexOf(prev);
        return ids[(i + 1) % ids.length];
      });
    }, 3200);
    return () => clearInterval(t);
  }, [data]);

  const goToNav = (label: string) => {
    setActiveNav(label);
    const route = NAV_ROUTES[label];
    if (route && route !== '/dashboard') router.push(route);
  };

  useEffect(() => {
    void loadDashboardAgents();
  }, [loadDashboardAgents]);

  // M3-07: crewCoordinator.registry (used to resolve the agent a routed
  // response is generated for — see lib/crew/crew-coordinator.ts's
  // generateResponse()) is only ever populated by whichever page happens
  // to call crewCoordinator.init(agents) — previously only app/chat/page.tsx
  // did. Main Dashboard never did, so a voice request made here with no
  // prior /chat visit hit "No agent selected" the moment a response tried
  // to generate. Mirrors app/chat/page.tsx's identical effect.
  useEffect(() => {
    crewCoordinator.init(dashboardAgents);
  }, [dashboardAgents]);

  useEffect(() => {
    Promise.all([loadAgents(), listMissions(10)]).then(([records, missions]) => {
      const managers = records
        .filter((r) => r.level === 'manager' && r.isActive)
        .map((r) => recordToUI(r, records));
      setData({
        agents: managers,
        missions,
        metrics: {
          activeAgents: managers.filter((a) => a.status === 'online').length,
          missions: missions.length,
          completion:
            missions.length > 0
              ? missions.reduce((s, m) => s + m.progress, 0) / missions.length
              : 0,
          uptime: '99.98%',
        },
      });
    });
  }, []);

  if (!data)
    return (
      <main className="dashboard-shell">
        <Stars />
        <div className="loading-state">Initializing Temo intelligence network...</div>
      </main>
    );

  const activeAgent = selected ?? data.agents[0] ?? TEMO_UI;

  const stats: [string, string | number][] = [
    ['System Status', 'OPTIMAL'],
    ['Companies', businessUnits.length],
    ['Active Missions', data.metrics.missions],
    ['Active Agents', data.metrics.activeAgents],
    ['Avg Completion', `${data.metrics.completion.toFixed(1)}%`],
    ['Uptime', data.metrics.uptime],
  ];

  return (
    <main className="dashboard-shell">
      <Stars />
      {/* Single global TopNav (same component used by every other page) —
          replaces this page's own hand-rolled header, which duplicated
          Search/Notifications/Settings controls with a second, slightly
          different implementation. */}
      <TopNav />
      <div style={{ marginRight: rightSidebarOpen ? '376px' : '0', transition: 'margin-right .3s ease' }}>
      <div className="command-grid">
        <aside className="sidebar">
          <Panel title="Commander">
            <p className="text-xs text-slate-400">Welcome back,</p>
            <h2 className="commander-title">Commander</h2>
            <p className="mb-3 text-[10px] text-slate-500">Temo AI OS is fully operational.</p>
            <div className="stats">
              {stats.map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <b className={label === 'System Status' ? 'good' : ''}>{value}</b>
                </div>
              ))}
            </div>
          </Panel>
          {/* Quick Access relocated here from the bottom widget-grid — same
              component, same style, just repositioned into the sidebar
              alongside navigation instead of requiring a scroll down. */}
          <QuickAccessWidget router={router} />
          <nav className="nav-rail">
            {navItems.map(([Icon, label]) => (
              <button
                className={activeNav === label ? 'active' : ''}
                onClick={() => goToNav(label)}
                title={label}
                key={label}
              >
                <Icon size={17} />
              </button>
            ))}
          </nav>
          <p className="nav-status">
            <Activity size={12} /> {activeNav} mode
          </p>
        </aside>
        <section className="hero-bridge" ref={bridgeRef}>
          <div className="hero-grid" />
          <button type="button" className="gbrain-link hero-gbrain-link" onClick={() => router.push('/')}>
            <Network size={12} />
            G-Brain
          </button>
          <svg
            className="org-lines"
            width={bridgeSize.w}
            height={bridgeSize.h}
            viewBox={`0 0 ${bridgeSize.w || 1} ${bridgeSize.h || 1}`}
            aria-hidden
          >
            <defs>
              <filter id="bridge-glow" x="-40%" y="-40%" width="180%" height="180%">
                <feGaussianBlur stdDeviation="2.4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            {bridgeEdges.map((e) => {
              const midY = e.from.y + (e.to.y - e.from.y) / 2;
              const d = `M ${e.from.x} ${e.from.y} C ${e.from.x} ${midY}, ${e.to.x} ${midY}, ${e.to.x} ${e.to.y}`;
              return (
                <g key={e.id}>
                  <path d={d} stroke={e.color} strokeOpacity={0.2} strokeWidth={1.4} fill="none" />
                  <path
                    d={d}
                    stroke={e.color}
                    strokeWidth={1.6}
                    fill="none"
                    filter="url(#bridge-glow)"
                    strokeLinecap="round"
                    strokeDasharray="7 240"
                    className="org-pulse"
                    style={{ animationDelay: `${e.delay}s` }}
                  />
                  <circle r={2.6} fill={e.color} filter="url(#bridge-glow)">
                    <animateMotion dur="3s" begin={`${e.delay}s`} repeatCount="indefinite" path={d} />
                  </circle>
                </g>
              );
            })}
          </svg>
          {/* M3-05: z-index bumped above .agent-row's own stacking context
              (both are 2 in the shared CSS, tied by DOM order otherwise) —
              the expanded voice recording bar sits in this exact area and
              was getting its click target stolen by the "Corporate Office"
              cluster label painting on top of it. */}
          <div className="central-hologram" style={{ zIndex: 5 }}>
            <span
              className={`node-avatar temo-holo ${speakingId === 'temo' ? 'node-active' : ''}`}
              style={{ ['--tone' as string]: TONE_COLORS.cyan }}
              ref={temoRef}
            >
              {speakingId === 'temo' && <VoiceAura />}
              <Holo image={AGENT_IMAGES.temo} fallback="T" tone="cyan" size="xl" />
            </span>
            <div className="holo-core">
              <VoiceTrigger />
            </div>
            <p>TEMO</p>
            <small>CHIEF INTELLIGENCE OFFICER</small>
          </div>
          <div className="agent-row">
            {heroClusters.map((cluster) => (
              <div className={`agent-cluster ${cluster.kind === 'corporate' ? 'cluster-corporate' : ''}`} key={cluster.id}>
                {cluster.name && (
                  <span className="agent-cluster-label" style={{ ['--tone' as string]: cluster.themeColor }}>
                    {cluster.name}
                  </span>
                )}
                <div className="agent-cluster-row">
                  {cluster.agents.map((agent) => (
                    <button
                      type="button"
                      className="node-btn"
                      onClick={() => setSelected(agent)}
                      aria-label={`Inspect ${agent.name}`}
                      key={agent.id}
                    >
                      <Node
                        level="manager"
                        image={agent.image}
                        fallback={agent.name[0]}
                        tone={agent.tone}
                        size="sm"
                        name={agent.name}
                        title={agent.role}
                        status={agent.status}
                        active={activeAgent.id === agent.id || speakingId === agent.id}
                        avatarRef={(el) => registerNode(agent.id, el)}
                      />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
        {/* Diagnostics/Logs/Properties now live in the same RightContextPanel
            every other page uses (Section 14) — replaces this page's own
            Corporate Overview/Approvals/AI Usage aside, whose real numbers
            (companies/managers/missions) already duplicated the Commander
            panel's own stats, and whose AI-usage panel is now the API Calls
            widget below instead. */}
      </div>
      <div className="widget-grid">
        <CommandCenterWidgets missionWidget={<MissionWidget data={data} onCreate={() => router.push('/missions')} />} />
      </div>
      <footer className="footer footer-compact">
        <div className="footer-brand">
          <b>TEMO AI OS</b>
          <span>
            One AI.
            <br />
            Unlimited Intelligence.
            <br />
            Infinite Possibilities.
          </span>
        </div>
        <div className="footer-copy">
          <p>BUILT FOR THE FUTURE</p>
          <span>
            Autonomous Operations
            <br />
            Intelligent Automation
            <br />
            Real-time Analytics
            <br />
            Advanced AI Agents
          </span>
        </div>
      </footer>
      </div>
      {selected && (
        <div className="agent-modal-backdrop" onClick={() => setSelected(null)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            className="agent-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="modal-close" onClick={() => setSelected(null)} aria-label="Close">
              <X size={18} />
            </button>
            <div
              className="modal-avatar"
              style={{
                ['--agent-color' as string]: colors[selected.tone],
                backgroundImage: `linear-gradient(180deg, transparent 10%, rgba(2,9,20,.3)), url(${selected.image})`,
              }}
            />
            <p className="eyebrow">Department intelligence node</p>
            <h2>{selected.name}</h2>
            <p className="modal-role">{selected.role}</p>
            <p className="modal-activity">{selected.activity}</p>
            <div className="modal-status">
              <span>Status</span>
              <strong className={`status-${selected.status}`}>{selected.status}</strong>
            </div>
          </motion.div>
        </div>
      )}
      <RightContextPanel />
      <CommandPalette />
    </main>
  );
}
