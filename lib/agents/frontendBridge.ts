// Frontend Bridge — maps AgentRecord to the shape the new UI components expect.
// This keeps the new visual components decoupled from the backend data model.

import type { AgentRecord } from './types';

export type Tone = 'cyan' | 'amber' | 'emerald' | 'pink' | 'violet' | 'teal' | 'indigo' | 'gold' | 'orange';

export interface SubAgentUI {
  title: string;
  status: 'online' | 'busy' | 'idle';
  image: string;
}

export interface AgentUI {
  id: string;
  name: string;
  role: string;
  tone: Tone;
  status: 'online' | 'busy' | 'idle';
  activity: string;
  image: string;
  children: SubAgentUI[];
  capabilities: string[];
  tools: string[];
}

// Every company-scoped tone below is intentionally set to the EXACT hex
// stored on that company's business_unit row (and its agents' theme_color)
// — not a nearby decorative shade. This is what makes the band header, the
// node border/glow, the connecting neural line, and the Command Deck card
// for a given company all resolve to the identical color, instead of three
// visually-similar-but-different purples/blues.
export const TONE_COLORS: Record<Tone, string> = {
  cyan: '#22d3ee', // Temo (not a company)
  gold: '#facc15', // Corporate Office
  violet: '#7B61FF', // AI Engineering & Technology Company
  emerald: '#22C55E', // AI Automation Company
  indigo: '#3B82F6', // AI Research & Intelligence Company
  pink: '#EC4899', // AI Design & Creative Company
  amber: '#F59E0B', // AI Marketing & Content Company
  orange: '#F97316', // Trading Company
  teal: '#2dd4bf', // reserved for a future company
};

// sub-03.png, sub-05.png, and sub-06.png are truncated/corrupt source files
// (verified: missing PNG IEND trailer) — deliberately excluded here so no
// worker or Corporate Office agent can ever be assigned a broken portrait.
const HOLO_IMAGES = [
  '/agents/sub-01.png',
  '/agents/sub-02.png',
  '/agents/sub-04.png',
  '/agents/sub-07.png',
  '/agents/sub-08.png',
];

const TONE_MAP: Record<string, Tone> = {
  '#00E5FF': 'cyan',
  '#7B61FF': 'violet',
  '#22C55E': 'emerald',
  '#3B82F6': 'indigo',
  '#EC4899': 'pink',
  '#F59E0B': 'amber',
  '#F97316': 'orange',
  '#2DD4BF': 'teal',
  '#facc15': 'gold',
};

function mapStatus(status: string): 'online' | 'busy' | 'idle' {
  if (status === 'available' || status === 'online') return 'online';
  if (status === 'busy') return 'busy';
  return 'idle';
}

function agentImage(id: string): string {
  const known: Record<string, string> = {
    temo: '/agents/temo.jpeg',
    // nova.jpeg is a corrupted/truncated file (verified: missing JPEG EOI
    // marker) — reassigned to social.jpeg, a real, valid, unused portrait
    // (the 'social' agent no longer exists in the registry) rather than a
    // generic worker icon, so Nova keeps a distinct manager-tier portrait.
    nova: '/agents/social.jpeg',
    flow: '/agents/flow.jpeg',
    atlas: '/agents/atlas.jpeg',
    luna: '/agents/luna.jpeg',
    echo: '/agents/echo.jpeg',
    orion: '/agents/orion.jpeg',
    // Corporate Office executives don't have bespoke portraits — reused from
    // the same real specialist-portrait pool workers already use, so each
    // gets a distinct holographic avatar instead of a bare fallback letter.
    vertex: HOLO_IMAGES[0],
    forge: HOLO_IMAGES[1],
    sentinel: HOLO_IMAGES[2],
    cortex: HOLO_IMAGES[3],
    ledger: HOLO_IMAGES[4],
  };
  return known[id] ?? '';
}

// `allRecords` should be the full, already-loaded registry snapshot (from
// the same loadAgents() call that fetched `record`) so children reflect the
// live database — not the static seed data. Falls back to no children when
// omitted, rather than silently reading a different (stale) data source.
export function recordToUI(record: AgentRecord, allRecords: AgentRecord[] = []): AgentUI {
  const tone = TONE_MAP[record.themeColor] ?? 'cyan';
  const children = allRecords
    .filter((c) => c.parentId === record.id && c.level === 'worker' && c.isActive)
    .map((c, i) => ({
      title: c.displayName,
      status: mapStatus(c.status),
      image: c.avatarUrl ?? HOLO_IMAGES[i % HOLO_IMAGES.length],
    }));

  return {
    id: record.id,
    name: record.displayName.toUpperCase(),
    role: record.role,
    tone,
    status: mapStatus(record.status),
    activity: record.description,
    // A real uploaded portrait (Agent Management) always wins over the
    // hardcoded per-id map below, which exists only as a fallback for
    // agents nobody has uploaded a real image for yet.
    image: record.avatarUrl ?? agentImage(record.id),
    children,
    capabilities: record.capabilities,
    tools: record.tools,
  };
}

export const TEMO_UI: AgentUI = {
  id: 'temo',
  name: 'TEMO',
  role: 'Chief AI Executive / CEO',
  tone: 'cyan',
  status: 'online',
  activity: 'Coordinating all departments. Active listening mode.',
  image: '/agents/temo.jpeg',
  children: [],
  capabilities: [],
  tools: [],
};
