import { create } from 'zustand';
import type {
  Conversation,
  Workflow,
  ConnectedService,
  QuickAction,
  ActivityItem,
  SystemStatus,
  Provider,
  Agent,
} from '@/types';
import type { Mission } from '@/lib/swarm/types';

interface DashboardState {
  conversations: Conversation[];
  workflows: Workflow[];
  services: ConnectedService[];
  quickActions: QuickAction[];
  activity: ActivityItem[];
  systemStatus: SystemStatus[];
  providers: Provider[];
  agents: Agent[];
  /** True once agents has been replaced by a real agent_registry load — before that, agents holds seed/fallback data only. */
  agentsLoaded: boolean;
  /** M5-07: real error from the last loadAgents() call, or null. Same pattern as missionsError (M4-06) — previously swallowed by an empty catch, leaving stale/fallback state with no user-facing signal. */
  agentsError: string | null;
  missions: Mission[];
  missionsLoaded: boolean;
  /** M4-06: real error from the last loadMissions() call, or null. Previously swallowed by an empty catch, leaving stale/empty state with no user-facing signal. */
  missionsError: string | null;
  currentProviderId: string;
  setCurrentProvider: (id: string) => void;
  updateAgentStatus: (agentId: string, status: Agent['status'], activity?: string) => void;
  /** Real load from agent_registry (agentRegistryService.loadAgents), converted via agentRecordToRuntimeAgent — the single source of truth every agent-consuming surface should call on mount. Safe to call repeatedly; each call re-fetches and replaces `agents`. */
  loadAgents: () => Promise<void>;
  /** Real load from the missions table (missionService.listMissions) — the single source of truth every mission-consuming surface should call on mount. */
  loadMissions: () => Promise<void>;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  currentProviderId: 'gemini',
  setCurrentProvider: (id) => set({ currentProviderId: id }),

  providers: [
    {
      id: 'gemini',
      name: 'Gemini Live',
      model: 'gemini-2.0-flash',
      status: 'active',
      latency: 142,
      color: '#00E5FF',
    },
    {
      id: 'groq',
      name: 'Groq',
      model: 'llama-3.3-70b-versatile',
      status: 'idle',
      latency: 32,
      color: '#F53803',
    },
    {
      id: 'nvidia',
      name: 'NVIDIA NIM',
      model: 'llama-3.1-405b-instruct',
      status: 'idle',
      latency: 180,
      color: '#76B900',
    },
    {
      id: 'openrouter',
      name: 'OpenRouter',
      model: 'gemini-2.0-flash-001',
      status: 'idle',
      latency: 240,
      color: '#6366F1',
    },
    {
      id: 'ollama',
      name: 'Ollama',
      model: 'llama3',
      status: 'idle',
      latency: 12,
      color: '#22C55E',
    },
    {
      id: 'n8n',
      name: 'n8n',
      model: 'workflow-engine',
      status: 'active',
      latency: 96,
      color: '#7B61FF',
    },
  ],

  agents: [
    {
      id: 'temo',
      name: 'Temo',
      role: 'Chief AI',
      icon: 'Sparkles',
      color: '#00E5FF',
      status: 'available',
      description: 'Coordinates every agent. Chooses which specialist should answer. Keeps conversations natural.',
      personality: {
        traits: ['Professional', 'Calm', 'Intelligent', 'Friendly', 'Confident'],
        tone: 'Coordinated and clear — speaks as the leader of the crew.',
        greeting: "Hello Amro.\n\nI'm Temo.\n\nI'll coordinate our AI team.\n\nTell me what you would like to build today.",
        bio: 'Temo is the Chief AI of the crew. He coordinates every specialist, chooses who should answer, and ensures the conversation stays natural and productive. He welcomes you, understands your intent, and routes your request to the right expert.',
      },
      skills: ['Coordination', 'Routing', 'Synthesis', 'Natural Conversation', 'Context Management'],
      capabilities: ['Agent Routing', 'Conversation Orchestration', 'Multi-Agent Synthesis', 'Voice Coordination', 'Crew Management'],
      model: 'Gemini 2.0 Flash',
      voice: { voiceName: 'Google US English', rate: 1.0, pitch: 1.0, lang: 'en-US', accent: 'Neutral US' },
      workflow: { workflowId: 'wf-temo-orchestrator', workflowEndpoint: '/api/workflows/temo-orchestrator', workflowStatus: 'ready', enabled: true },
      memory: { conversationCount: 247, lastInteraction: 'Just now', topics: ['Coordination', 'Routing', 'Synthesis'], summary: 'Coordinated 247 interactions across all specialists.' },
      isFavorite: true,
      currentActivity: 'Coordinating crew',
      level: 'chief',
      parentId: null,
      childrenIds: ['nova', 'flow', 'atlas', 'luna', 'echo'],
      departmentId: undefined,
      priority: 0,
      tools: [],
      isActive: true,
    },
    {
      id: 'nova',
      name: 'Nova',
      role: 'Senior Software Engineer',
      icon: 'Code2',
      color: '#7B61FF',
      status: 'available',
      description: 'Specializes in programming, debugging, architecture, API design, databases, cloud, and automation.',
      personality: {
        traits: ['Energetic', 'Creative', 'Confident', 'Fast'],
        tone: 'Enthusiastic and technical — loves building things quickly and correctly.',
        greeting: "Hey Amro!\n\nNeed code?\nLet's build something amazing.",
        bio: 'Nova is the Senior Software Engineer of the crew. She lives and breathes code — from architecture to deployment. Energetic and creative, she turns ideas into production-ready software with confidence and speed.',
      },
      skills: ['Programming', 'Debugging', 'Architecture', 'API Design', 'Databases', 'Cloud', 'Automation'],
      capabilities: ['Full-Stack Development', 'Code Review', 'System Architecture', 'API Design', 'Database Modeling', 'Cloud Deployment', 'DevOps'],
      model: 'Gemini 2.0 Flash',
      voice: { voiceName: 'Google UK English Female', rate: 1.15, pitch: 1.1, lang: 'en-GB', accent: 'British' },
      workflow: { workflowId: 'wf-nova-code-pipeline', workflowEndpoint: '/api/workflows/nova-code-pipeline', workflowStatus: 'ready', enabled: true },
      memory: { conversationCount: 89, lastInteraction: '5 min ago', topics: ['TypeScript', 'API Design', 'React Components'], summary: 'Built 12 components and designed 3 APIs across 89 sessions.' },
      isFavorite: false,
      currentActivity: 'Reviewing code architecture',
      level: 'manager',
      parentId: 'temo',
      childrenIds: [],
      departmentId: 'engineering',
      priority: 1,
      tools: ['code_review', 'code_search', 'file_read', 'file_write'],
      isActive: true,
    },
    {
      id: 'flow',
      name: 'Flow',
      role: 'Automation Architect',
      icon: 'Workflow',
      color: '#22C55E',
      status: 'available',
      description: 'Expert in n8n, Make, Zapier, APIs, webhooks, integrations, and automation.',
      personality: {
        traits: ['Logical', 'Organized', 'Precise'],
        tone: 'Methodical and structured — designs pipelines step by step.',
        greeting: "Hi Amro.\n\nLet's automate your work.",
        bio: 'Flow is the Automation Architect of the crew. He lives in the space between systems — connecting APIs, designing pipelines, and making things run themselves. Logical, organized, and precise, he turns manual work into automated workflows.',
      },
      skills: ['n8n', 'Make', 'Zapier', 'APIs', 'Webhooks', 'Integrations', 'Automation'],
      capabilities: ['Workflow Design', 'API Integration', 'Webhook Configuration', 'Pipeline Architecture', 'Scheduled Triggers', 'Data Transformation', 'Event Routing'],
      model: 'Gemini 2.0 Flash',
      voice: { voiceName: 'Google US English Male', rate: 0.95, pitch: 0.9, lang: 'en-US', accent: 'Neutral US' },
      workflow: { workflowId: 'wf-flow-automation', workflowEndpoint: '/api/workflows/flow-automation', workflowStatus: 'ready', enabled: true },
      memory: { conversationCount: 56, lastInteraction: '12 min ago', topics: ['n8n Pipelines', 'Webhook Triggers', 'API Integration'], summary: 'Designed 14 automation workflows across 56 sessions.' },
      isFavorite: false,
      currentActivity: 'Designing automation pipeline',
      level: 'manager',
      parentId: 'temo',
      childrenIds: [],
      departmentId: 'automation',
      priority: 2,
      tools: ['n8n_workflow', 'webhook', 'api_call'],
      isActive: true,
    },
    {
      id: 'atlas',
      name: 'Atlas',
      role: 'Business Strategist',
      icon: 'TrendingUp',
      color: '#3B82F6',
      status: 'available',
      description: 'Expert in business, marketing, sales, pricing, growth, and analytics.',
      personality: {
        traits: ['Wise', 'Calm', 'Strategic'],
        tone: 'Thoughtful and measured — speaks with the weight of experience.',
        greeting: "Good to see you again.\n\nLet's grow your business.",
        bio: 'Atlas is the Business Strategist of the crew. He sees the big picture — market trends, competitive positioning, growth levers. Wise and calm, he turns data into strategy and strategy into action.',
      },
      skills: ['Business', 'Marketing', 'Sales', 'Pricing', 'Growth', 'Analytics'],
      capabilities: ['Market Analysis', 'Competitive Intelligence', 'Pricing Strategy', 'Growth Planning', 'Revenue Optimization', 'Go-to-Market Strategy', 'Business Intelligence'],
      model: 'Gemini 2.0 Flash',
      voice: { voiceName: 'Google UK English Male', rate: 0.9, pitch: 0.85, lang: 'en-GB', accent: 'British' },
      workflow: { workflowId: 'wf-atlas-strategy', workflowEndpoint: '/api/workflows/atlas-strategy', workflowStatus: 'ready', enabled: true },
      memory: { conversationCount: 34, lastInteraction: '1 hr ago', topics: ['Market Analysis', 'Pricing Strategy', 'Growth Plan'], summary: 'Analyzed 8 markets and drafted 3 growth plans across 34 sessions.' },
      isFavorite: false,
      currentActivity: 'Analyzing market trends',
      level: 'manager',
      parentId: 'temo',
      childrenIds: [],
      departmentId: 'research',
      priority: 3,
      tools: ['web_search', 'data_analysis'],
      isActive: true,
    },
    {
      id: 'luna',
      name: 'Luna',
      role: 'Creative Designer',
      icon: 'Palette',
      color: '#EC4899',
      status: 'available',
      description: 'Expert in UI, UX, branding, graphics, presentation, and motion.',
      personality: {
        traits: ['Creative', 'Elegant', 'Positive'],
        tone: 'Warm and artistic — speaks in visual concepts and creative direction.',
        greeting: "Hi Amro!\n\nLet's create something beautiful.",
        bio: 'Luna is the Creative Designer of the crew. She sees beauty in every interface — colors, typography, motion, spacing. Creative, elegant, and positive, she transforms ideas into visually stunning experiences.',
      },
      skills: ['UI', 'UX', 'Branding', 'Graphics', 'Presentation', 'Motion'],
      capabilities: ['Interface Design', 'Design Systems', 'Brand Identity', 'Visual Direction', 'Motion Design', 'Prototyping', 'Creative Direction'],
      model: 'Gemini 2.0 Flash',
      voice: { voiceName: 'Google US English Female', rate: 1.0, pitch: 1.2, lang: 'en-US', accent: 'Neutral US' },
      workflow: { workflowId: 'wf-luna-design-system', workflowEndpoint: '/api/workflows/luna-design-system', workflowStatus: 'ready', enabled: true },
      memory: { conversationCount: 41, lastInteraction: '20 min ago', topics: ['UI Design', 'Brand Identity', 'Motion Specs'], summary: 'Designed 9 interfaces and 4 brand systems across 41 sessions.' },
      isFavorite: false,
      currentActivity: 'Designing interface concepts',
      level: 'manager',
      parentId: 'temo',
      childrenIds: [],
      departmentId: 'design',
      priority: 4,
      tools: ['design_review', 'asset_generate'],
      isActive: true,
    },
    {
      id: 'echo',
      name: 'Echo',
      role: 'Content Creator',
      icon: 'PenTool',
      color: '#F59E0B',
      status: 'available',
      description: 'Expert in writing, SEO, YouTube, social media, copywriting, and email.',
      personality: {
        traits: ['Friendly', 'Funny', 'Creative'],
        tone: 'Casual and witty — writes like a friend who happens to be brilliant.',
        greeting: "Ready to create viral content?\n\nLet's go.",
        bio: 'Echo is the Content Creator of the crew. He knows what makes people click, read, and share. Friendly, funny, and creative, he turns ideas into content that connects with audiences and drives results.',
      },
      skills: ['Writing', 'SEO', 'YouTube', 'Social Media', 'Copywriting', 'Email'],
      capabilities: ['Content Strategy', 'SEO Optimization', 'Copywriting', 'Social Media Content', 'Email Campaigns', 'Script Writing', 'Headline Crafting'],
      model: 'Gemini 2.0 Flash',
      voice: { voiceName: 'Google US English Male', rate: 1.1, pitch: 1.05, lang: 'en-US', accent: 'Neutral US' },
      workflow: { workflowId: 'wf-echo-content-pipeline', workflowEndpoint: '/api/workflows/echo-content-pipeline', workflowStatus: 'ready', enabled: true },
      memory: { conversationCount: 28, lastInteraction: '2 hrs ago', topics: ['SEO Articles', 'Social Posts', 'Email Campaigns'], summary: 'Wrote 22 articles and 6 email campaigns across 28 sessions.' },
      isFavorite: false,
      currentActivity: 'Drafting content strategy',
      level: 'manager',
      parentId: 'temo',
      childrenIds: [],
      departmentId: 'marketing',
      priority: 5,
      tools: ['content_write', 'seo_analyze'],
      isActive: true,
    },
  ],

  conversations: [
    {
      id: 'c1',
      title: 'Quarterly revenue synthesis',
      agent: 'Temo',
      agentIcon: 'Sparkles',
      preview: 'Summarized Q3 results across 4 providers and drafted a report...',
      timestamp: '2 min ago',
      unread: true,
    },
    {
      id: 'c2',
      title: 'Workflow: Lead enrichment',
      agent: 'Nova',
      agentIcon: 'Workflow',
      preview: 'Enriched 248 leads with company data and contact info...',
      timestamp: '18 min ago',
    },
    {
      id: 'c3',
      title: 'Competitor pricing analysis',
      agent: 'Atlas',
      agentIcon: 'Globe',
      preview: 'Cross-referenced 12 competitors across 3 regions...',
      timestamp: '1 hr ago',
    },
    {
      id: 'c4',
      title: 'Voice memo — product ideas',
      agent: 'Echo',
      agentIcon: 'Mic',
      preview: 'Transcribed 4:32 of audio into structured action items...',
      timestamp: '3 hrs ago',
    },
  ],

  workflows: [
    {
      id: 'w1',
      name: 'Daily Market Digest',
      status: 'running',
      lastRun: 'Running now',
      steps: 7,
      progress: 64,
    },
    {
      id: 'w2',
      name: 'Lead Enrichment Pipeline',
      status: 'idle',
      lastRun: '12 min ago',
      steps: 5,
      progress: 100,
    },
    {
      id: 'w3',
      name: 'Support Ticket Triage',
      status: 'paused',
      lastRun: 'Paused 1 hr ago',
      steps: 9,
      progress: 38,
    },
    {
      id: 'w4',
      name: 'Social Sentiment Scan',
      status: 'error',
      lastRun: 'Failed 2 hrs ago',
      steps: 6,
      progress: 72,
    },
  ],

  services: [
    { id: 's1', name: 'Gemini Live API', icon: 'Sparkles', status: 'connected', category: 'AI Provider' },
    { id: 's2', name: 'n8n', icon: 'Workflow', status: 'connected', category: 'Automation' },
    { id: 's3', name: 'OpenAI', icon: 'Bot', status: 'connected', category: 'AI Provider' },
    { id: 's4', name: 'Anthropic', icon: 'Brain', status: 'warning', category: 'AI Provider' },
    { id: 's5', name: 'Slack', icon: 'MessageSquare', status: 'connected', category: 'Communication' },
    { id: 's6', name: 'Google Calendar', icon: 'Calendar', status: 'connected', category: 'Productivity' },
    { id: 's7', name: 'Notion', icon: 'FileText', status: 'disconnected', category: 'Knowledge' },
  ],

  quickActions: [
    { id: 'qa1', label: 'New Chat', icon: 'MessageSquare', color: 'primary' },
    { id: 'qa2', label: 'Start Workflow', icon: 'Workflow', color: 'secondary' },
    { id: 'qa3', label: 'Voice Mode', icon: 'Mic', color: 'success' },
    { id: 'qa4', label: 'New Agent', icon: 'Bot', color: 'warning' },
  ],

  activity: [
    { id: 'a1', label: 'Temo completed a synthesis', detail: 'Merged 4 sources into a revenue report', time: '2 min ago', type: 'chat' },
    { id: 'a2', label: 'Workflow started', detail: 'Daily Market Digest — step 4 of 7', time: '6 min ago', type: 'workflow' },
    { id: 'a3', label: 'Voice session ended', detail: '4:32 captured, transcribed, and filed', time: '18 min ago', type: 'voice' },
    { id: 'a4', label: 'Provider switched', detail: 'Active provider → Gemini Live', time: '32 min ago', type: 'system' },
    { id: 'a5', label: 'Atlas finished research', detail: '12 competitors analyzed across 3 regions', time: '1 hr ago', type: 'chat' },
    { id: 'a6', label: 'Workflow paused', detail: 'Support Ticket Triage — awaiting review', time: '1 hr ago', type: 'workflow' },
  ],

  systemStatus: [
    { label: 'AI Providers', value: '4 / 4', status: 'healthy', detail: 'All providers responding' },
    { label: 'Automation Engine', value: 'Online', status: 'healthy', detail: 'n8n connected' },
    { label: 'Voice Pipeline', value: 'Ready', status: 'healthy', detail: 'Gemini Live idle' },
    { label: 'Storage', value: '68% used', status: 'warning', detail: '14.2 GB of 21 GB' },
  ],

  updateAgentStatus: (agentId, status, activity) =>
    set((s) => ({
      agents: s.agents.map((a) =>
        a.id === agentId
          ? { ...a, status, ...(activity ? { currentActivity: activity } : {}) }
          : a,
      ),
    })),

  agentsLoaded: false,
  agentsError: null,
  missions: [],
  missionsLoaded: false,
  missionsError: null,

  loadAgents: async () => {
    const { loadAgentsOrThrow, agentRecordToRuntimeAgent } = await import('@/lib/agents/agentRegistryService');
    try {
      const records = await loadAgentsOrThrow();
      set({ agents: records.map(agentRecordToRuntimeAgent), agentsLoaded: true, agentsError: null });
    } catch (err) {
      // M5-07: previously silent — a query failure left whatever stale
      // (or seed) agents were already in state with zero signal anything
      // went wrong. Agents themselves are left untouched (still the last
      // good snapshot), but the error is now real and visible. Same
      // pattern as M4-06's loadMissions() fix in this same file.
      set({ agentsError: err instanceof Error ? err.message : 'Failed to load agents' });
    }
  },

  loadMissions: async () => {
    const { listMissionsOrThrow } = await import('@/lib/swarm/missionService');
    try {
      const missions = await listMissionsOrThrow(50);
      set({ missions, missionsLoaded: true, missionsError: null });
    } catch (err) {
      // M4-06: previously silent — a query failure left whatever stale
      // (or empty) missions were already in state with zero signal that
      // anything went wrong. Missions themselves are left untouched
      // (still the last good snapshot), but the error is now real and
      // visible to callers.
      set({ missionsError: err instanceof Error ? err.message : 'Failed to load missions' });
    }
  },
}));
