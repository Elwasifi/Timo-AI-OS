export type Tone = 'cyan' | 'amber' | 'emerald' | 'pink' | 'violet' | 'teal' | 'indigo'

export type SubAgent = { title: string; status: 'online' | 'busy' | 'idle'; image: string }
export type Agent = {
  id: string
  name: string
  role: string
  tone: Tone
  status: 'online' | 'busy' | 'idle'
  activity: string
  image: string
  children: SubAgent[]
}
export type Mission = { id: string; title: string; owner: string; progress: number; phase: string; updated: string }
export type DashboardSnapshot = { agents: Agent[]; missions: Mission[]; metrics: { activeAgents: number; missions: number; completion: number; uptime: string } }

/* Neon aura per tone — shared by dashboard + org chart */
export const TONE_COLORS: Record<Tone, string> = {
  cyan: '#22d3ee',
  amber: '#f59e0b',
  emerald: '#34d399',
  pink: '#f472b6',
  violet: '#a78bfa',
  teal: '#2dd4bf',
  indigo: '#818cf8',
}

/* Distinct holographic specialist portraits reused across departments */
const HOLO = {
  frontend: '/agents/sub-01.png',
  backend: '/agents/sub-02.png',
  data: '/agents/sub-03.png',
  design: '/agents/sub-04.png',
  content: '/agents/sub-05.png',
  social: '/agents/sub-06.png',
  trading: '/agents/sub-07.png',
  qa: '/agents/sub-08.png',
}

/* Character portraits — all served locally from /public/agents */
export const TEMO = {
  id: 'temo',
  name: 'TEMO',
  role: 'Chief AI Executive / CEO',
  tone: 'cyan' as Tone,
  image: '/agents/temo.jpeg',
}

function sub(title: string, image: string, status: SubAgent['status'] = 'online'): SubAgent {
  return { title, status, image }
}

const agents: Agent[] = [
  {
    id: 'nova',
    name: 'NOVA',
    role: 'Engineering Manager',
    tone: 'cyan',
    status: 'online',
    activity: 'Optimizing deployment pipelines',
    image: '/agents/nova.jpeg',
    children: [
      sub('Frontend Engineer', HOLO.frontend),
      sub('Backend Engineer', HOLO.backend, 'busy'),
      sub('QA Engineer', HOLO.qa),
    ],
  },
  {
    id: 'flow',
    name: 'FLOW',
    role: 'Automation Manager',
    tone: 'amber',
    status: 'busy',
    activity: 'Orchestrating 18 workflow nodes',
    image: '/agents/flow.jpeg',
    children: [
      sub('Workflow Engineer', HOLO.data, 'busy'),
      sub('Integration Engineer', HOLO.frontend),
      sub('Automation QA Engineer', HOLO.qa),
    ],
  },
  {
    id: 'atlas',
    name: 'ATLAS',
    role: 'Research Manager',
    tone: 'emerald',
    status: 'online',
    activity: 'Synthesizing market signals',
    image: '/agents/atlas.jpeg',
    children: [
      sub('Research Analyst', HOLO.data),
      sub('Data Analyst', HOLO.backend, 'busy'),
      sub('Intelligence Analyst', HOLO.trading),
    ],
  },
  {
    id: 'luna',
    name: 'LUNA',
    role: 'Design Manager',
    tone: 'pink',
    status: 'online',
    activity: 'Refining the visual system',
    image: '/agents/luna.jpeg',
    children: [
      sub('UI Designer', HOLO.design),
      sub('UX Designer', HOLO.social),
      sub('Visual Designer', HOLO.content, 'idle'),
    ],
  },
  {
    id: 'echo',
    name: 'ECHO',
    role: 'Marketing Manager',
    tone: 'violet',
    status: 'idle',
    activity: 'Preparing campaign narrative',
    image: '/agents/echo.jpeg',
    children: [
      sub('Content Strategist', HOLO.content),
      sub('Content Writer', HOLO.data, 'busy'),
      sub('SEO Specialist', HOLO.frontend),
      sub('Marketing Analyst', HOLO.trading),
    ],
  },
  {
    id: 'social',
    name: 'SOCIAL',
    role: 'Social Media Manager',
    tone: 'teal',
    status: 'online',
    activity: 'Scheduling multi-channel drops',
    image: '/agents/social.jpeg',
    children: [
      sub('Social Strategist', HOLO.social),
      sub('Content Specialist', HOLO.content, 'busy'),
      sub('Social Designer', HOLO.design),
      sub('Social Analyst', HOLO.backend),
    ],
  },
  {
    id: 'orion',
    name: 'ORION',
    role: 'Trading Manager',
    tone: 'indigo',
    status: 'busy',
    activity: 'Running live risk simulations',
    image: '/agents/orion.jpeg',
    children: [
      sub('Market Analyst', HOLO.trading, 'busy'),
      sub('Strategy Analyst', HOLO.data),
      sub('Risk Manager', HOLO.backend),
      sub('Trade Execution Specialist', HOLO.frontend, 'busy'),
      sub('Portfolio Analyst', HOLO.trading),
    ],
  },
]

let missions: Mission[] = [
  { id: 'm-1', title: 'AI Market Research & Strategy Report', owner: 'ATLAS', progress: 76, phase: 'Validating', updated: '2m ago' },
  { id: 'm-2', title: 'Q3 Automation Blueprint', owner: 'FLOW', progress: 48, phase: 'Executing', updated: '8m ago' },
  { id: 'm-3', title: 'Launch Narrative System', owner: 'LUNA', progress: 22, phase: 'Planning', updated: '14m ago' },
]

export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  return { agents, missions, metrics: { activeAgents: 247, missions: 12, completion: 98.7, uptime: '99.98%' } }
}
export async function createMission(title = 'Untitled Mission'): Promise<Mission> {
  const mission = { id: `m-${Date.now()}`, title, owner: 'TEMO', progress: 4, phase: 'Planning', updated: 'now' }
  missions = [mission, ...missions]
  return mission
}
export async function sendTemoMessage(message: string): Promise<string> {
  return `Command received: ${message}. I have routed this through the Temo intelligence network.`
}
export function subscribeToTelemetry(callback: (metrics: DashboardSnapshot['metrics']) => void) {
  const timer = setInterval(
    () =>
      callback({
        activeAgents: 240 + Math.floor(Math.random() * 12),
        missions: 12 + Math.floor(Math.random() * 3),
        completion: 98 + Math.random() * 1.8,
        uptime: '99.98%',
      }),
    5000,
  )
  return () => clearInterval(timer)
}

export { agents }
export type { DashboardSnapshot as DashboardData }
export default getDashboardSnapshot
