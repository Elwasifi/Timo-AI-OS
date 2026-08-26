// Phase 2 — Mission Planner
//
// Analyzes a user request, classifies complexity, and decomposes it into
// objectives with required capabilities. The planner does NOT execute
// anything — it only produces a plan that the Mission Engine acts on.
//
// Complexity classification is deterministic (regex/keyword-based), not
// LLM-based, to keep it fast and predictable. A future phase can swap in
// an LLM-backed planner via the same interface.

import type {
  MissionComplexity,
  MissionPriority,
  MissionPlan,
  PlannedObjective,
  ObjectiveEffort,
} from './types';

// ---- Complexity Signals ----

const COMPLEX_INDICATORS = [
  'build', 'create', 'design', 'develop', 'implement', 'architect',
  'end-to-end', 'full system', 'platform', 'infrastructure', 'pipeline',
  'complete', 'comprehensive', 'multi-step', 'integrate', 'migrate',
];

const MEDIUM_INDICATORS = [
  'analyze', 'review', 'optimize', 'refactor', 'plan', 'strategy',
  'design system', 'workflow', 'automation', 'research', 'report',
  'compare', 'evaluate', 'audit', 'setup',
];

// ---- Capability → Keyword Map ----
// Maps natural-language keywords to the structured capabilities defined
// in the Agent Registry. This is the bridge between user language and
// capability-based dispatch.

const CAPABILITY_KEYWORDS: Record<string, string[]> = {
  code_review: ['code', 'bug', 'review', 'debug', 'refactor', 'lint', 'quality'],
  architecture_analysis: ['architecture', 'structure', 'design pattern', 'scalable', 'system design'],
  software_planning: ['plan', 'roadmap', 'estimate', 'sprint', 'milestone', 'technical plan'],
  full_stack_development: ['build', 'develop', 'implement', 'create app', 'feature', 'endpoint'],
  api_design: ['api', 'endpoint', 'rest', 'graphql', 'openapi', 'webhook'],
  database_modeling: ['database', 'schema', 'sql', 'table', 'migration', 'query'],
  cloud_deployment: ['deploy', 'cloud', 'aws', 'gcp', 'azure', 'docker', 'kubernetes', 'ci/cd'],
  devops: ['devops', 'pipeline', 'ci', 'cd', 'automation', 'infrastructure'],
  workflow_design: ['workflow', 'pipeline', 'process', 'flow', 'automation'],
  automation: ['automate', 'automation', 'schedule', 'trigger', 'recurring'],
  n8n: ['n8n', 'node', 'integration node'],
  api_integration: ['integrate', 'integration', 'connect', 'api', 'third-party', 'service'],
  webhook_configuration: ['webhook', 'callback', 'event endpoint'],
  pipeline_architecture: ['pipeline', 'data pipeline', 'etl', 'stream'],
  scheduled_triggers: ['schedule', 'cron', 'recurring', 'timer', 'periodic'],
  data_transformation: ['transform', 'map', 'convert', 'format', 'parse'],
  market_research: ['market', 'competitor', 'industry', 'research', 'trends'],
  competitive_intelligence: ['competitor', 'competitive', 'benchmark', 'compare'],
  business_analysis: ['business', 'revenue', 'model', 'unit economics', 'metrics'],
  pricing_strategy: ['pricing', 'price', 'monetize', 'subscription', 'tier'],
  growth_planning: ['growth', 'scale', 'acquisition', 'retention', 'funnel'],
  revenue_optimization: ['revenue', 'monetization', 'upsell', 'ltv', 'arpu'],
  go_to_market_strategy: ['go-to-market', 'gtm', 'launch', 'positioning', 'launch plan'],
  interface_design: ['ui', 'interface', 'layout', 'screen', 'page design'],
  design_systems: ['design system', 'component library', 'tokens', 'theme'],
  brand_identity: ['brand', 'logo', 'identity', 'guidelines', 'visual identity'],
  visual_direction: ['visual', 'aesthetic', 'mood', 'style', 'look and feel'],
  motion_design: ['motion', 'animation', 'transition', 'micro-interaction'],
  prototyping: ['prototype', 'mockup', 'wireframe', 'figma'],
  creative_direction: ['creative', 'concept', 'art direction', 'vision'],
  content_strategy: ['content', 'blog', 'article', 'editorial', 'calendar'],
  seo_optimization: ['seo', 'search', 'keyword', 'ranking', 'organic'],
  copywriting: ['copy', 'copywriting', 'tagline', 'messaging', 'landing page text'],
  social_media_content: ['social', 'twitter', 'linkedin', 'instagram', 'post'],
  email_campaigns: ['email', 'newsletter', 'campaign', 'drip'],
  script_writing: ['script', 'video script', 'youtube', 'narration'],
  headline_crafting: ['headline', 'title', 'hook', 'subject line'],
  agent_routing: ['coordinate', 'orchestrate', 'route', 'assign'],
  conversation_orchestration: ['manage', 'oversee', 'synthesize', 'summarize all'],
};

// ---- Capability Resolution ----

export function resolveCapabilities(text: string): string[] {
  const lower = text.toLowerCase();
  const matched = new Set<string>();

  for (const [capability, keywords] of Object.entries(CAPABILITY_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      matched.add(capability);
    }
  }

  return Array.from(matched);
}

// ---- Complexity Classification ----

export function classifyComplexity(text: string): MissionComplexity {
  const lower = text.toLowerCase();
  const complexScore = COMPLEX_INDICATORS.filter((kw) =>
    lower.includes(kw),
  ).length;
  const mediumScore = MEDIUM_INDICATORS.filter((kw) =>
    lower.includes(kw),
  ).length;
  const capabilities = resolveCapabilities(text);

  if (complexScore >= 2 || (complexScore >= 1 && capabilities.length >= 2)) {
    return 'complex';
  }
  if (complexScore >= 1 || mediumScore >= 2 || capabilities.length >= 2) {
    return 'medium';
  }
  return 'simple';
}

// ---- Objective Generation ----

export function planMission(
  userRequest: string,
  priority: MissionPriority = 'medium',
): MissionPlan {
  const complexity = classifyComplexity(userRequest);
  const capabilities = resolveCapabilities(userRequest);

  if (complexity === 'simple' || capabilities.length === 0) {
    return planSimpleMission(userRequest, capabilities);
  }

  if (complexity === 'medium') {
    return planMediumMission(userRequest, capabilities);
  }

  return planComplexMission(userRequest, capabilities);
}

function planSimpleMission(
  _request: string,
  capabilities: string[],
): MissionPlan {
  const capability = capabilities[0] ?? 'agent_routing';
  return {
    complexity: 'simple',
    estimatedTasks: 1,
    objectives: [
      {
        title: 'Handle the request directly',
        requiredCapability: capability,
        estimatedEffort: 'low',
        dependencies: [],
      },
    ],
  };
}

function planMediumMission(
  request: string,
  capabilities: string[],
): MissionPlan {
  const objectives: PlannedObjective[] = capabilities
    .slice(0, 3)
    .map((cap, i) => ({
      title: deriveObjectiveTitle(cap, request),
      requiredCapability: cap,
      estimatedEffort: 'medium' as ObjectiveEffort,
      dependencies: i > 0 ? [`obj-${i - 1}`] : [],
    }));

  if (objectives.length === 0) {
    objectives.push({
      title: 'Handle the request',
      requiredCapability: 'agent_routing',
      estimatedEffort: 'medium',
      dependencies: [],
    });
  }

  return {
    complexity: 'medium',
    estimatedTasks: objectives.length,
    objectives,
  };
}

function planComplexMission(
  request: string,
  capabilities: string[],
): MissionPlan {
  const objectives: PlannedObjective[] = [];

  // Always start with analysis/planning for complex missions
  if (capabilities.includes('software_planning') || capabilities.includes('business_analysis')) {
    objectives.push({
      title: 'Analyze requirements and define approach',
      requiredCapability: capabilities.includes('software_planning')
        ? 'software_planning'
        : 'business_analysis',
      estimatedEffort: 'medium',
      dependencies: [],
    });
  } else {
    objectives.push({
      title: 'Analyze the request and break down requirements',
      requiredCapability: 'agent_routing',
      estimatedEffort: 'medium',
      dependencies: [],
    });
  }

  // Add each capability as a sequential objective
  const execCapabilities = capabilities.filter(
    (c) => c !== 'software_planning' && c !== 'business_analysis',
  );

  execCapabilities.slice(0, 5).forEach((cap, i) => {
    objectives.push({
      title: deriveObjectiveTitle(cap, request),
      requiredCapability: cap,
      estimatedEffort: 'high' as ObjectiveEffort,
      dependencies: [`obj-${objectives.length - 1}`],
    });
    void i;
  });

  // Always end with review/synthesis
  objectives.push({
    title: 'Review and synthesize all outputs',
    requiredCapability: 'agent_routing',
    estimatedEffort: 'medium',
    dependencies: [`obj-${objectives.length - 1}`],
  });

  return {
    complexity: 'complex',
    estimatedTasks: objectives.length,
    objectives,
  };
}

function deriveObjectiveTitle(capability: string, request: string): string {
  const capLabels: Record<string, string> = {
    code_review: 'Review code quality and identify issues',
    architecture_analysis: 'Analyze architecture and structural concerns',
    software_planning: 'Create a technical implementation plan',
    full_stack_development: 'Implement the required functionality',
    api_design: 'Design the API interface and contracts',
    database_modeling: 'Model the database schema',
    cloud_deployment: 'Plan deployment and infrastructure',
    devops: 'Set up DevOps pipelines and automation',
    workflow_design: 'Design the automation workflow',
    automation: 'Build the automation logic',
    n8n: 'Configure n8n workflow nodes',
    api_integration: 'Integrate external APIs and services',
    webhook_configuration: 'Configure webhooks and event endpoints',
    pipeline_architecture: 'Architect the data pipeline',
    scheduled_triggers: 'Set up scheduled triggers',
    data_transformation: 'Transform and map data formats',
    market_research: 'Research market trends and landscape',
    competitive_intelligence: 'Analyze competitors and positioning',
    business_analysis: 'Analyze business metrics and model',
    pricing_strategy: 'Develop pricing strategy',
    growth_planning: 'Create a growth plan',
    revenue_optimization: 'Optimize revenue streams',
    go_to_market_strategy: 'Define go-to-market strategy',
    interface_design: 'Design the user interface',
    design_systems: 'Establish the design system',
    brand_identity: 'Define brand identity',
    visual_direction: 'Set visual direction and aesthetic',
    motion_design: 'Design motion and interactions',
    prototyping: 'Create prototypes and mockups',
    creative_direction: 'Provide creative direction',
    content_strategy: 'Develop content strategy',
    seo_optimization: 'Optimize for search engines',
    copywriting: 'Write compelling copy',
    social_media_content: 'Create social media content',
    email_campaigns: 'Design email campaign',
    script_writing: 'Write scripts and narratives',
    headline_crafting: 'Craft headlines and hooks',
    agent_routing: 'Coordinate and synthesize',
    conversation_orchestration: 'Orchestrate the response',
  };

  return capLabels[capability] ?? `Execute ${capability}`;
}

export function estimatePriority(text: string): MissionPriority {
  const lower = text.toLowerCase();
  if (lower.match(/urgent|asap|critical|emergency|immediately|now/)) {
    return 'critical';
  }
  if (lower.match(/important|priority|need this|must|should/)) {
    return 'high';
  }
  if (lower.match(/maybe|could|optional|whenever|low priority/)) {
    return 'low';
  }
  return 'medium';
}
