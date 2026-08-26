'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  LayoutDashboard,
  X,
  Building2,
  Compass,
  FlaskConical,
  ShieldCheck,
  Radar,
  Wallet,
  Code2,
  Workflow,
  TrendingUp,
  Palette,
  PenTool,
  LineChart,
  type LucideIcon,
} from 'lucide-react';
import {
  loadAgents,
  loadBusinessUnitsWithDepartments,
} from '@/lib/agents/agentRegistryService';
import { getRecentTasksByManager } from '@/lib/swarm/missionService';
import type { MissionTask } from '@/lib/swarm/types';
import type { BusinessUnitWithDepartments } from '@/lib/agents/types';
import {
  recordToUI,
  TEMO_UI,
  TONE_COLORS,
  type AgentUI,
  type Tone,
} from '@/lib/agents/frontendBridge';
import { Holo, VoiceAura, Node } from './holo';

const BAND_ICONS: Record<string, LucideIcon> = {
  Building2,
  Compass,
  FlaskConical,
  ShieldCheck,
  Radar,
  Wallet,
  Code2,
  Workflow,
  TrendingUp,
  Palette,
  PenTool,
  LineChart,
};

type Band = {
  id: string;
  name: string;
  icon: string;
  themeColor: string;
  kind: 'corporate' | 'operating';
  agents: AgentUI[];
};

const SPACE =
  'https://hebbkx1anhila5yf.public.blob.vercel-storage.com/Stars_floating_in_space_void_202608161156-9XpFD91iiUbgGWePMBqBu8AAvk8Eha.jpeg';

type Point = { x: number; y: number };
type Edge = { id: string; from: Point; to: Point; tone: Tone; delay: number };

function Starfield() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    let raf = 0;
    type Star = {
      x: number;
      y: number;
      r: number;
      vx: number;
      vy: number;
      tw: number;
      ts: number;
    };
    let stars: Star[] = [];

    const resize = () => {
      w = canvas.width = window.innerWidth * DPR;
      h = canvas.height = window.innerHeight * DPR;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
    };
    const seed = () => {
      const count = Math.min(
        240,
        Math.round((window.innerWidth * window.innerHeight) / 9000),
      );
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: (Math.random() * 1.4 + 0.3) * DPR,
        vx: (Math.random() - 0.5) * 0.06 * DPR,
        vy: (Math.random() * 0.12 + 0.02) * DPR,
        tw: Math.random() * Math.PI * 2,
        ts: Math.random() * 0.02 + 0.004,
      }));
    };
    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) {
        s.x += s.vx;
        s.y += s.vy;
        s.tw += s.ts;
        if (s.y > h) s.y = 0;
        if (s.x < 0) s.x = w;
        if (s.x > w) s.x = 0;
        const a = 0.35 + Math.sin(s.tw) * 0.35;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(165,243,252,${a})`;
        ctx.shadowBlur = 6 * DPR;
        ctx.shadowColor = 'rgba(34,211,238,.85)';
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };

    resize();
    seed();
    tick();
    const onResize = () => {
      resize();
      seed();
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, []);
  return <canvas ref={ref} className="org-starfield" aria-hidden />;
}

function DepartmentModal({
  agent,
  onClose,
}: {
  agent: AgentUI;
  onClose: () => void;
}) {
  const [tasks, setTasks] = useState<MissionTask[]>([]);

  useEffect(() => {
    let cancelled = false;
    getRecentTasksByManager(agent.id).then((t) => {
      if (!cancelled) setTasks(t);
    });
    return () => {
      cancelled = true;
    };
  }, [agent.id]);

  return (
    <div className="org-modal-backdrop" onClick={onClose}>
      <section
        className={`org-modal tone-${agent.tone}`}
        onClick={(e) => e.stopPropagation()}
        style={{ ['--tone' as string]: TONE_COLORS[agent.tone] }}
      >
        <button className="org-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <Holo image={agent.image} fallback={agent.name[0]} tone={agent.tone} size="md" />
        <p className="org-kicker">DEPARTMENT NODE</p>
        <h2>{agent.name}</h2>
        <h3>{agent.role}</h3>
        <p className="org-modal-activity">{agent.activity}</p>
        <div className="org-modal-stats">
          <span>
            Sub-agents <b>{agent.children.length}</b>
          </span>
          <span>
            Status <b>{agent.status.toUpperCase()}</b>
          </span>
        </div>
        {agent.children.length > 0 && (
          <ul>
            {agent.children.map((child) => (
              <li key={child.title}>
                {child.title}
                <small className={`dot dot-${child.status}`}>{child.status}</small>
              </li>
            ))}
          </ul>
        )}
        {agent.capabilities.length > 0 && (
          <div className="org-modal-section">
            <p className="org-modal-section-title">Capabilities</p>
            <div className="chip-row">
              {agent.capabilities.map((cap) => (
                <span className="chip" key={cap}>
                  {cap.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          </div>
        )}
        {agent.tools.length > 0 && (
          <div className="org-modal-section">
            <p className="org-modal-section-title">Tools</p>
            <div className="chip-row">
              {agent.tools.map((tool) => (
                <span className="chip chip-tool" key={tool}>
                  {tool.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="org-modal-section">
          <p className="org-modal-section-title">Recent activity</p>
          {tasks.length === 0 ? (
            <p className="org-modal-empty">No tasks assigned yet.</p>
          ) : (
            <ul className="org-modal-tasks">
              {tasks.map((task) => (
                <li key={task.id}>
                  <span>{task.title}</span>
                  <small className={`dot dot-${task.status === 'completed' ? 'online' : task.status === 'failed' ? 'busy' : 'idle'}`}>
                    {task.status}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

export function OrgChart() {
  const [agents, setAgents] = useState<AgentUI[]>([]);
  const [units, setUnits] = useState<BusinessUnitWithDepartments[]>([]);
  const [selected, setSelected] = useState<AgentUI | null>(null);
  const [activeManager, setActiveManager] = useState<string>('');
  const [edges, setEdges] = useState<Edge[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const [treeScale, setTreeScale] = useState(1);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const treeRef = useRef<HTMLDivElement | null>(null);
  const ceoRef = useRef<HTMLSpanElement | null>(null);
  const managerRefs = useRef<Map<string, HTMLElement>>(new Map());
  const subRefs = useRef<Map<string, HTMLElement>>(new Map());

  const registerManager = useCallback((id: string, el: HTMLElement | null) => {
    if (el) managerRefs.current.set(id, el);
    else managerRefs.current.delete(id);
  }, []);
  const registerSub = useCallback((id: string, el: HTMLElement | null) => {
    if (el) subRefs.current.set(id, el);
    else subRefs.current.delete(id);
  }, []);

  useEffect(() => {
    loadAgents().then((records) => {
      const managers = records
        .filter((r) => r.level === 'manager' && r.isActive)
        .map((r) => recordToUI(r, records));
      setAgents(managers);
      if (managers.length > 0) setActiveManager(managers[0].id);
    });
    loadBusinessUnitsWithDepartments().then(setUnits);
  }, []);

  // Group managers into their Corporate Office / Operating Company bands.
  // Falls back to a single unlabeled band (today's flat layout) when the
  // business_units table isn't reachable yet — zero regression pre-migration.
  const bands = useMemo<Band[]>(() => {
    if (agents.length === 0) return [];
    if (units.length === 0) {
      return [{ id: '__flat', name: '', icon: '', themeColor: '', kind: 'operating', agents }];
    }

    const unitByAgentId = new Map<string, BusinessUnitWithDepartments>();
    units.forEach((u) => u.agents.forEach((a) => unitByAgentId.set(a.id, u)));

    const order: string[] = [];
    const grouped = new Map<string, Band>();
    agents.forEach((agent) => {
      const unit = unitByAgentId.get(agent.id);
      const key = unit?.id ?? '__unassigned';
      if (!grouped.has(key)) {
        order.push(key);
        grouped.set(key, {
          id: key,
          name: unit?.name ?? '',
          icon: unit?.icon ?? '',
          themeColor: unit?.themeColor ?? '',
          kind: unit?.kind ?? 'operating',
          agents: [],
        });
      }
      grouped.get(key)!.agents.push(agent);
    });
    return order.map((k) => grouped.get(k)!);
  }, [agents, units]);

  // Corporate Office flanks Temo directly (left/right of the CEO); Operating
  // Companies remain the row below. Split alternately so both flanks stay
  // balanced regardless of how many corporate agents exist later.
  const corporateBand = bands.find((b) => b.kind === 'corporate') ?? null;
  const operatingBands = bands.filter((b) => b.kind !== 'corporate');
  const corporateLeft = corporateBand?.agents.filter((_, i) => i % 2 === 0) ?? [];
  const corporateRight = corporateBand?.agents.filter((_, i) => i % 2 === 1) ?? [];

  useEffect(() => {
    if (agents.length === 0) return;
    const t = setInterval(() => {
      setActiveManager((prev) => {
        const idx = agents.findIndex((a) => a.id === prev);
        if (idx < 0) return agents[0].id;
        return agents[(idx + 1) % agents.length].id;
      });
    }, 3200);
    return () => clearInterval(t);
  }, [agents]);

  const measure = useCallback(() => {
    const stage = stageRef.current;
    const ceo = ceoRef.current;
    const tree = treeRef.current;
    if (!stage || !ceo || !tree) return;

    // Scale the whole tree to fit the visible width, so it's fully visible
    // at normal browser zoom without horizontal scrolling. offsetWidth is a
    // layout measurement, unaffected by the transform this applies, so it
    // stays accurate to re-measure on every call (no reset-then-measure
    // dance needed, and no feedback loop).
    const naturalWidth = tree.offsetWidth;
    // Larger-than-strictly-needed buffer: .org-shell's vertical scrollbar
    // (when present) claims width from stage.clientWidth AFTER this runs,
    // so measuring generously here avoids a small residual horizontal
    // overflow once that scrollbar appears.
    const available = stage.clientWidth - 56;
    const nextScale = naturalWidth > 0 ? Math.max(0.45, Math.min(1, available / naturalWidth)) : 1;
    // Applied directly (not just via React state) so the geometry reads
    // below — which happen synchronously in this same call — reflect the
    // new scale immediately, instead of the previous render's transform.
    tree.style.transform = nextScale < 1 ? `scale(${nextScale})` : 'none';
    tree.style.transformOrigin = 'top center';
    setTreeScale(nextScale);

    // A CSS transform shrinks the tree visually but NOT its contribution to
    // the stage's normal-flow layout height (transform never affects
    // layout) — without this, the stage would stay as tall as the
    // unscaled tree, leaving a large empty gap below the visibly-smaller
    // content. Pin the stage's own height to the scaled result instead.
    stage.style.height = `${tree.offsetHeight * nextScale + 86}px`;

    const base = stage.getBoundingClientRect();

    const point = (el: Element, edge: 'top' | 'bottom'): Point => {
      const r = el.getBoundingClientRect();
      return {
        x: r.left - base.left + stage.scrollLeft + r.width / 2,
        y: (edge === 'bottom' ? r.bottom : r.top) - base.top + stage.scrollTop,
      };
    };

    const ceoBottom = point(ceo, 'bottom');
    const next: Edge[] = [];
    let d = 0;

    agents.forEach((agent) => {
      const mEl = managerRefs.current.get(agent.id);
      if (!mEl) return;
      next.push({
        id: `temo-${agent.id}`,
        from: ceoBottom,
        to: point(mEl, 'top'),
        tone: agent.tone,
        delay: d,
      });
      const mBottom = point(mEl, 'bottom');
      agent.children.forEach((child, i) => {
        const sEl = subRefs.current.get(`${agent.id}:${child.title}`);
        if (!sEl) return;
        next.push({
          id: `${agent.id}-${i}`,
          from: mBottom,
          to: point(sEl, 'top'),
          tone: agent.tone,
          delay: d + (i + 1) * 0.12,
        });
      });
      d += 0.18;
    });
    setEdges(next);

    // Size the SVG to the stage's own visible box — NOT to the computed
    // edge extents. A node's intrinsic content (e.g. a long title) can very
    // slightly exceed its scaled container's nominal width, which previously
    // fed back into the SVG's own width attribute and reintroduced the exact
    // horizontal overflow this scaling logic exists to eliminate. Any edge
    // endpoint marginally outside this box is simply clipped, which is a
    // silent, harmless fallback rather than a page-level scrollbar.
    setSize({ w: stage.clientWidth, h: stage.clientHeight });
  }, [agents]);

  useLayoutEffect(() => {
    measure();
    const t = setTimeout(measure, 300);
    return () => clearTimeout(t);
  }, [measure]);

  useEffect(() => {
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    const ro = new ResizeObserver(() => measure());
    if (stageRef.current) ro.observe(stageRef.current);
    return () => {
      window.removeEventListener('resize', onResize);
      ro.disconnect();
    };
  }, [measure]);

  const path = (e: Edge) => {
    const midY = e.from.y + (e.to.y - e.from.y) / 2;
    return `M ${e.from.x} ${e.from.y} C ${e.from.x} ${midY}, ${e.to.x} ${midY}, ${e.to.x} ${e.to.y}`;
  };

  const childCount = agents.reduce((n, a) => n + a.children.length, 0);

  return (
    <main
      className="org-shell"
      style={{
        backgroundImage: `linear-gradient(rgba(2,7,18,.55),rgba(2,7,18,.9)), url(${SPACE})`,
      }}
    >
      <Starfield />

      <header className="org-topbar">
        <div>
          <p className="org-kicker">TEMO AI OS / INTELLIGENCE COMMAND</p>
          <h1>
            G-BRAIN <span>/ ORGANIZATION CHART</span>
          </h1>
          <p>
            {units.length > 0 ? `${units.length} companies` : 'Chief AI Executive Network'} &middot; {agents.length} managers &middot; Live neural topology
          </p>
        </div>
        <div className="org-topbar-actions">
          <Link href="/dashboard" className="org-dash-link">
            <LayoutDashboard size={14} />
            Main Dashboard
          </Link>
          <div className="org-live">
            <i />
            SYSTEM SYNCHRONIZED <b>99.98%</b>
          </div>
        </div>
      </header>

      {agents.length === 0 ? (
        <div className="loading-state">Initializing G-Brain neural topology...</div>
      ) : (
        <>
          <section className="org-stage" ref={stageRef}>
            <svg
              className="org-lines"
              width={size.w}
              height={size.h}
              viewBox={`0 0 ${size.w || 1} ${size.h || 1}`}
              aria-hidden
            >
              <defs>
                <filter id="neon-glow" x="-40%" y="-40%" width="180%" height="180%">
                  <feGaussianBlur stdDeviation="2.4" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              {edges.map((e) => {
                const color = TONE_COLORS[e.tone];
                const d = path(e);
                return (
                  <g key={e.id}>
                    <path d={d} stroke={color} strokeOpacity={0.2} strokeWidth={1.4} fill="none" />
                    <path
                      d={d}
                      stroke={color}
                      strokeWidth={1.6}
                      fill="none"
                      filter="url(#neon-glow)"
                      strokeLinecap="round"
                      strokeDasharray="7 240"
                      className="org-pulse"
                      style={{ animationDelay: `${e.delay}s` }}
                    />
                    <circle r={2.6} fill={color} filter="url(#neon-glow)">
                      <animateMotion
                        dur="3s"
                        begin={`${e.delay}s`}
                        repeatCount="indefinite"
                        path={d}
                      />
                    </circle>
                  </g>
                );
              })}
            </svg>

            <div
              className="org-tree"
              ref={treeRef}
              style={{
                transform: treeScale < 1 ? `scale(${treeScale})` : undefined,
                transformOrigin: 'top center',
              }}
            >
              <div className="executive-row">
                <div className="executive-flank flank-left">
                  {corporateLeft.map((agent) => (
                    <div className="branch-column" key={agent.id}>
                      <button
                        type="button"
                        className="node-btn"
                        onClick={() => setSelected(agent)}
                        aria-label={`Inspect ${agent.name}`}
                      >
                        <Node
                          level="manager"
                          image={agent.image}
                          fallback={agent.name[0]}
                          tone={agent.tone}
                          size="xl"
                          name={agent.name}
                          title={agent.role}
                          company={corporateBand?.name}
                          description={agent.activity}
                          status={agent.status}
                          active={activeManager === agent.id}
                          avatarRef={(el) => registerManager(agent.id, el)}
                        />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="ceo-wrap">
                  <Node
                    level="ceo"
                    image={TEMO_UI.image}
                    fallback="T"
                    tone={TEMO_UI.tone}
                    size="hero"
                    name={TEMO_UI.name}
                    title={TEMO_UI.role}
                    description={TEMO_UI.activity}
                    kicker="&#9679; READY &middot; ACTIVE LISTENING"
                    active
                    avatarRef={(el) => (ceoRef.current = el)}
                  />
                </div>

                <div className="executive-flank flank-right">
                  {corporateRight.map((agent) => (
                    <div className="branch-column" key={agent.id}>
                      <button
                        type="button"
                        className="node-btn"
                        onClick={() => setSelected(agent)}
                        aria-label={`Inspect ${agent.name}`}
                      >
                        <Node
                          level="manager"
                          image={agent.image}
                          fallback={agent.name[0]}
                          tone={agent.tone}
                          size="xl"
                          name={agent.name}
                          title={agent.role}
                          company={corporateBand?.name}
                          description={agent.activity}
                          status={agent.status}
                          active={activeManager === agent.id}
                          avatarRef={(el) => registerManager(agent.id, el)}
                        />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="business-unit-row">
                {operatingBands.map((band) => {
                  const BandIcon = BAND_ICONS[band.icon];
                  return (
                    <div
                      className={`business-unit-cluster ${band.kind === 'corporate' ? 'cluster-corporate' : ''}`}
                      key={band.id}
                    >
                      {band.name && (
                        <div
                          className="band-header"
                          style={{ ['--tone' as string]: band.themeColor }}
                        >
                          {BandIcon && <BandIcon size={11} />}
                          <span>{band.name}</span>
                        </div>
                      )}
                      <div className="cluster-managers">
                        {band.agents.map((agent) => (
                          <div className="branch-column" key={agent.id}>
                            <button
                              type="button"
                              className="node-btn"
                              onClick={() => setSelected(agent)}
                              aria-label={`Inspect ${agent.name}`}
                            >
                              <Node
                                level="manager"
                                image={agent.image}
                                fallback={agent.name[0]}
                                tone={agent.tone}
                                size="md"
                                name={agent.name}
                                title={agent.role}
                                company={band.name}
                                description={agent.activity}
                                status={agent.status}
                                active={activeManager === agent.id}
                                avatarRef={(el) => registerManager(agent.id, el)}
                              />
                            </button>

                            <div className="subagent-stack">
                              {agent.children.map((child) => (
                                <Node
                                  key={child.title}
                                  level="sub"
                                  image={child.image}
                                  fallback={child.title[0]}
                                  tone={agent.tone}
                                  size="sm"
                                  name={child.title}
                                  title=""
                                  status={child.status}
                                  avatarRef={(el) =>
                                    registerSub(`${agent.id}:${child.title}`, el)
                                  }
                                />
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="org-footer">
            <div>
              <b>G-BRAIN NETWORK</b>
              <span>1 executive core</span>
              {units.length > 0 && <span>{units.length} companies</span>}
              <span>{agents.length} managers</span>
              <span>{childCount} specialist nodes</span>
            </div>
            <p>Click any manager to inspect department telemetry and capabilities.</p>
          </section>
        </>
      )}

      {selected && (
        <DepartmentModal agent={selected} onClose={() => setSelected(null)} />
      )}
    </main>
  );
}
