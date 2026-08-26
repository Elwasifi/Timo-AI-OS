/**
 * Radial neural graph layout for the TEMO G-Brain.
 *
 * Concentric rings: TEMO Core at the center (ring 0), major knowledge domains
 * on ring 1, their child entities on rings 2-3. Each domain gets an angular
 * sector weighted by its child count so crowded domains get more space.
 * Pure math — no React, no DOM, fully deterministic.
 */

export type GBrainNodeKind = 'core' | 'domain' | 'entity' | 'leaf';

export type GBrainNodeStatus = 'idle' | 'available' | 'working' | 'thinking' | 'executing' | 'speaking' | 'completed' | 'error' | 'offline';

export type GBrainNode = {
  id: string;
  kind: GBrainNodeKind;
  label: string;
  ring: number;
  color: string;
  domainId?: string;
  meta?: string;
  /** Agent id if this node represents an agent */
  agentId?: string;
  /** Live status for visual state */
  status?: GBrainNodeStatus;
  /** Mission id if this node is related to an active mission */
  missionId?: string;
  /** Capabilities list for agent nodes */
  capabilities?: string[];
};

export type GBrainEdge = {
  source: string;
  target: string;
  kind: 'domain' | 'entity' | 'leaf';
  /** Whether this edge is part of an active execution path */
  active?: boolean;
};

export type GBrainGraph = {
  nodes: GBrainNode[];
  edges: GBrainEdge[];
};

export type PositionedNode = GBrainNode & { x: number; y: number; angle: number };

export type GBrainLayout = {
  nodes: Map<string, PositionedNode>;
  edges: Array<{ source: PositionedNode; target: PositionedNode; kind: string }>;
};

const SECTOR_FILL = 0.82;

export function radialLayout(
  graph: GBrainGraph,
  width: number,
  height: number,
): GBrainLayout {
  const cx = width / 2;
  const cy = height / 2;
  const m = Math.max(1, Math.min(width, height));
  const ringR = [0, 0.16 * m, 0.28 * m, 0.38 * m];
  const startAngle = -Math.PI / 2;

  const core = graph.nodes.find((n) => n.kind === 'core');
  const domains = graph.nodes.filter((n) => n.kind === 'domain');
  const positions = new Map<string, PositionedNode>();

  if (core) {
    positions.set(core.id, { ...core, x: cx, y: cy, angle: 0 });
  }

  const domainChildren = new Map<string, GBrainNode[]>();
  for (const d of domains) {
    domainChildren.set(
      d.id,
      graph.nodes.filter((n) => n.domainId === d.id),
    );
  }

  const n = Math.max(1, domains.length);
  const weights = domains.map((d) => Math.max(1, (domainChildren.get(d.id) ?? []).length));
  const total = weights.reduce((s, w) => s + w, 0) || 1;
  const spans = weights.map((w) => (w / total) * Math.PI * 2);
  const centers: number[] = [];
  let cum = 0;
  for (let i = 0; i < n; i++) {
    centers[i] = cum + spans[i] / 2;
    cum += spans[i];
  }
  const offset = startAngle - (centers[0] ?? 0);

  const polar = (r: number, a: number) => ({
    x: cx + r * Math.cos(a),
    y: cy + r * Math.sin(a),
  });

  domains.forEach((d, i) => {
    const center = centers[i] + offset;
    const pos = polar(ringR[1], center);
    positions.set(d.id, { ...d, ...pos, angle: center });

    const children = domainChildren.get(d.id) ?? [];
    const half = (spans[i] / 2) * SECTOR_FILL;

    const ring = (nodes: GBrainNode[], r: number) => {
      const k = nodes.length;
      nodes.forEach((node, j) => {
        const t = k <= 1 ? 0 : (j / (k - 1)) * 2 - 1;
        const a = center + t * half;
        const p = polar(r, a);
        positions.set(node.id, { ...node, ...p, angle: a });
      });
    };

    const entities = children.filter((c) => c.ring === 2);
    const leaves = children.filter((c) => c.ring === 3);
    ring(entities, ringR[2]);
    ring(leaves, ringR[3]);
  });

  const edges = graph.edges
    .map((e) => {
      const s = positions.get(e.source);
      const t = positions.get(e.target);
      if (!s || !t) return null;
      return { source: s, target: t, kind: e.kind };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return { nodes: positions, edges };
}

export function edgeArc(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  bow = 0.12,
): string {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const off = bow * len;
  const cx = mx + (-dy / len) * off;
  const cy = my + (dx / len) * off;
  return `M ${ax.toFixed(2)} ${ay.toFixed(2)} Q ${cx.toFixed(2)} ${cy.toFixed(2)}, ${bx.toFixed(2)} ${by.toFixed(2)}`;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
