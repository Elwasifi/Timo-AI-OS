'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { LayoutDashboard, X } from 'lucide-react';
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
  type SubAgentUI,
  type Tone,
} from '@/lib/agents/frontendBridge';
import { Holo, VoiceAura, Node } from './holo';

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

// ---- Radial layout geometry (M3-03) ------------------------------------
//
// Replaces the old top-to-bottom tree (which grew tall fast and needed a
// DOM-measurement pass every render just to draw connector lines) with a
// concentric-ring layout computed entirely from math: Temo fixed at the
// center, three rings around it with radius increasing and node size
// decreasing by depth (Corporate Office → Operating Company managers →
// workers). All positions are pre-computed in a normalized 1000x1000
// coordinate space, so both the SVG connector lines and the HTML node
// overlays read the exact same numbers — no getBoundingClientRect pass
// needed, and it scales responsively via the SVG viewBox alone.

const VB = 1000; // viewBox size (square)
const CENTER = VB / 2;
// Radii are generous rather than tightly computed from avatar sizes: each
// .radial-node is anchored by translate(-50%,-50%) on its FULL bounding box
// (avatar + label stacked below it, per holo.tsx's Node component), not
// just the avatar circle — so the avatar itself sits noticeably closer to
// center than the nominal radius while the label extends further out past
// it. Live-verified at these values with the real hero(198px)/xl(134px)
// avatar sizes: enough clearance that no ring's labels overlap Temo's own
// text or the next ring's avatars.
const RING_CORPORATE_R = 250;
const RING_OPERATING_R = 400;
const RING_WORKER_R = 500;
const WORKER_CLUSTER_SPREAD_DEG = 34; // total angular width a manager's workers fan across

type RadialAgentNode = {
  kind: 'corporate' | 'operating';
  agent: AgentUI;
  x: number;
  y: number;
  angleDeg: number;
  tone: Tone;
  companyName?: string;
};

type RadialWorkerNode = {
  kind: 'worker';
  worker: SubAgentUI;
  parentId: string;
  x: number;
  y: number;
  tone: Tone;
};

type RadialEdge = { id: string; x1: number; y1: number; x2: number; y2: number; tone: Tone; delay: number };

function polar(radius: number, angleDeg: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CENTER + radius * Math.cos(rad), y: CENTER + radius * Math.sin(rad) };
}

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

/** M3-03: lightweight hover preview — appears on hover, distinct from the
 * full click-to-open DepartmentModal below (which stays the definitive
 * "full agent details" view: capabilities, tools, recent tasks). This is
 * the fast at-a-glance card the ticket asks for. */
function HoverCard({
  name,
  role,
  status,
  description,
  tone,
  company,
  placement,
}: {
  name: string;
  role: string;
  status?: 'online' | 'busy' | 'idle';
  description?: string;
  tone: Tone;
  company?: string;
  /** Cards default to appearing below the node — for a node in the upper
   * half of the ring, that lands the card back over Temo/inner rings, so
   * it flips above instead. Computed per-node from its angle, not fixed. */
  placement: 'above' | 'below';
}) {
  return (
    <div className={`radial-hover-card radial-hover-${placement}`} style={{ ['--tone' as string]: TONE_COLORS[tone] }}>
      <div className="radial-hover-head">
        <strong>{name}</strong>
        {status && <i className={`dot dot-${status}`}>&#9679; {status}</i>}
      </div>
      <p className="radial-hover-role">{role}</p>
      {company && <em className="radial-hover-company">{company}</em>}
      {description && <p className="radial-hover-desc">{description}</p>}
      <span className="radial-hover-hint">Click for full details</span>
    </div>
  );
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
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [activeManager, setActiveManager] = useState<string>('');

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

  const corporateAgents = useMemo(() => bands.filter((b) => b.kind === 'corporate').flatMap((b) => b.agents), [bands]);
  const operatingBands = useMemo(() => bands.filter((b) => b.kind !== 'corporate'), [bands]);
  const operatingAgents = useMemo(() => operatingBands.flatMap((b) => b.agents), [operatingBands]);
  const bandByAgentId = useMemo(() => {
    const m = new Map<string, Band>();
    bands.forEach((b) => b.agents.forEach((a) => m.set(a.id, b)));
    return m;
  }, [bands]);

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

  // ---- Radial geometry: computed once from data, no DOM measurement ----
  const { corporateNodes, operatingNodes, workerNodes, edges } = useMemo(() => {
    const corpNodes: RadialAgentNode[] = corporateAgents.map((agent, i) => {
      const angleDeg = -90 + (i * 360) / corporateAgents.length;
      const { x, y } = polar(RING_CORPORATE_R, angleDeg);
      return { kind: 'corporate', agent, x, y, angleDeg, tone: agent.tone, companyName: bandByAgentId.get(agent.id)?.name };
    });

    // Small stagger so the operating ring doesn't visually line up radially
    // with the corporate ring behind it (purely cosmetic, avoids nodes and
    // their connector lines overlapping across rings).
    const operatingStagger = operatingAgents.length > 0 ? 360 / operatingAgents.length / 2 : 0;
    const opNodes: RadialAgentNode[] = operatingAgents.map((agent, i) => {
      const angleDeg = -90 + operatingStagger + (i * 360) / operatingAgents.length;
      const { x, y } = polar(RING_OPERATING_R, angleDeg);
      return { kind: 'operating', agent, x, y, angleDeg, tone: agent.tone, companyName: bandByAgentId.get(agent.id)?.name };
    });

    const allPositioned = [...corpNodes, ...opNodes];
    const workers: RadialWorkerNode[] = [];
    for (const node of allPositioned) {
      const kids = node.agent.children;
      if (kids.length === 0) continue;
      const half = WORKER_CLUSTER_SPREAD_DEG / 2;
      kids.forEach((worker, i) => {
        const offset = kids.length > 1 ? -half + (i * WORKER_CLUSTER_SPREAD_DEG) / (kids.length - 1) : 0;
        const { x, y } = polar(RING_WORKER_R, node.angleDeg + offset);
        workers.push({ kind: 'worker', worker, parentId: node.agent.id, x, y, tone: node.tone });
      });
    }

    const es: RadialEdge[] = [];
    let d = 0;
    for (const node of allPositioned) {
      es.push({ id: `temo-${node.agent.id}`, x1: CENTER, y1: CENTER, x2: node.x, y2: node.y, tone: node.tone, delay: d });
      d += 0.12;
    }
    for (const w of workers) {
      const parent = allPositioned.find((n) => n.agent.id === w.parentId);
      if (!parent) continue;
      es.push({ id: `${w.parentId}-${w.worker.title}`, x1: parent.x, y1: parent.y, x2: w.x, y2: w.y, tone: w.tone, delay: d });
      d += 0.06;
    }

    return { corporateNodes: corpNodes, operatingNodes: opNodes, workerNodes: workers, edges: es };
  }, [corporateAgents, operatingAgents, bandByAgentId]);

  const curvedPath = useCallback((e: RadialEdge) => {
    const mx = (e.x1 + e.x2) / 2;
    const my = (e.y1 + e.y2) / 2;
    return `M ${e.x1} ${e.y1} Q ${mx} ${my}, ${e.x2} ${e.y2}`;
  }, []);

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
          <section className="radial-stage">
            <div className="radial-canvas">
              <svg className="radial-lines" viewBox={`0 0 ${VB} ${VB}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
                <defs>
                  <filter id="neon-glow" x="-40%" y="-40%" width="180%" height="180%">
                    <feGaussianBlur stdDeviation="2.4" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                {/* Faint ring guides so the concentric structure reads even before any node renders */}
                {[RING_CORPORATE_R, RING_OPERATING_R, RING_WORKER_R].map((r) => (
                  <circle key={r} cx={CENTER} cy={CENTER} r={r} fill="none" stroke="rgba(34,211,238,0.08)" strokeWidth={1} strokeDasharray="4 10" />
                ))}
                {edges.map((e) => {
                  const color = TONE_COLORS[e.tone];
                  const d = curvedPath(e);
                  return (
                    <g key={e.id}>
                      <path d={d} stroke={color} strokeOpacity={0.22} strokeWidth={1.4} fill="none" />
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
                        <animateMotion dur="3s" begin={`${e.delay}s`} repeatCount="indefinite" path={d} />
                      </circle>
                    </g>
                  );
                })}
              </svg>

              {/* Temo — fixed at the exact center, largest node */}
              <div className="radial-node radial-node-ceo" style={{ left: `${(CENTER / VB) * 100}%`, top: `${(CENTER / VB) * 100}%` }}>
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
                />
              </div>

              {/* Ring 1 — Corporate Office */}
              {corporateNodes.map((n) => (
                <div
                  key={n.agent.id}
                  className="radial-node"
                  style={{ left: `${(n.x / VB) * 100}%`, top: `${(n.y / VB) * 100}%` }}
                  onMouseEnter={() => setHoveredId(n.agent.id)}
                  onMouseLeave={() => setHoveredId((id) => (id === n.agent.id ? null : id))}
                >
                  <button type="button" className="node-btn" onClick={() => setSelected(n.agent)} aria-label={`Inspect ${n.agent.name}`}>
                    <Node
                      level="manager"
                      image={n.agent.image}
                      fallback={n.agent.name[0]}
                      tone={n.agent.tone}
                      size="xl"
                      name={n.agent.name}
                      title={n.agent.role}
                      company={n.companyName}
                      status={n.agent.status}
                      active={activeManager === n.agent.id}
                    />
                  </button>
                  {hoveredId === n.agent.id && (
                    <HoverCard name={n.agent.name} role={n.agent.role} status={n.agent.status} description={n.agent.activity} tone={n.agent.tone} company={n.companyName} placement={n.y < CENTER ? 'above' : 'below'} />
                  )}
                </div>
              ))}

              {/* Ring 2 — Operating Company managers */}
              {operatingNodes.map((n) => (
                <div
                  key={n.agent.id}
                  className="radial-node"
                  style={{ left: `${(n.x / VB) * 100}%`, top: `${(n.y / VB) * 100}%` }}
                  onMouseEnter={() => setHoveredId(n.agent.id)}
                  onMouseLeave={() => setHoveredId((id) => (id === n.agent.id ? null : id))}
                >
                  <button type="button" className="node-btn" onClick={() => setSelected(n.agent)} aria-label={`Inspect ${n.agent.name}`}>
                    <Node
                      level="manager"
                      image={n.agent.image}
                      fallback={n.agent.name[0]}
                      tone={n.agent.tone}
                      size="md"
                      name={n.agent.name}
                      title={n.agent.role}
                      company={n.companyName}
                      status={n.agent.status}
                      active={activeManager === n.agent.id}
                    />
                  </button>
                  {hoveredId === n.agent.id && (
                    <HoverCard name={n.agent.name} role={n.agent.role} status={n.agent.status} description={n.agent.activity} tone={n.agent.tone} company={n.companyName} placement={n.y < CENTER ? 'above' : 'below'} />
                  )}
                </div>
              ))}

              {/* Ring 3 — workers, smallest, clustered around their manager's angle */}
              {workerNodes.map((w) => (
                <div key={`${w.parentId}-${w.worker.title}`} className="radial-node radial-node-worker" style={{ left: `${(w.x / VB) * 100}%`, top: `${(w.y / VB) * 100}%` }}>
                  <Node level="sub" image={w.worker.image} fallback={w.worker.title[0]} tone={w.tone} size="sm" name={w.worker.title} title="" status={w.worker.status} />
                </div>
              ))}
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
            <p>Hover any node for a quick preview, or click for full department telemetry and capabilities.</p>
          </section>
        </>
      )}

      {selected && (
        <DepartmentModal agent={selected} onClose={() => setSelected(null)} />
      )}
    </main>
  );
}
