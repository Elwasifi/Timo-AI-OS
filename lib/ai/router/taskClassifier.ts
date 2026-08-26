// Dynamic Model Router — task classification.
//
// Deterministic only, per the mission's explicit "do not use an expensive
// LLM call just to classify every request" instruction. Reuses the
// existing complexity/capability/priority classifiers from
// lib/swarm/missionPlanner.ts rather than duplicating that logic — this
// module only adds the extra dimensions (task type, latency/cost/
// reliability sensitivity) those functions don't already produce.

import { classifyComplexity, resolveCapabilities, estimatePriority } from '@/lib/swarm/missionPlanner';
import type { TaskClassification, TaskType } from './types';

export interface ClassifyInput {
  text: string;
  /** True for internal manager/worker/agent coordination messages, not user-facing chat. */
  isAgentToAgent?: boolean;
  /** True when this text originated from a voice turn. */
  isVoice?: boolean;
  /** True when the caller already knows a tool will be invoked (e.g. context-manager's decideTools already fired). */
  needsTools?: boolean;
  /** True when this is one task inside a larger mission (vs. a standalone chat turn). */
  isMissionTask?: boolean;
  /** The mission's overall estimated complexity, when isMissionTask is true — a single task can still be classified on its own merits below, but a LARGE_MISSION-scale mission biases task selection toward stronger models. */
  missionComplexity?: 'simple' | 'medium' | 'complex';
  /** requiredCapability from a mission task/objective, if this came from the Mission Engine. */
  requiredCapability?: string;
  /** True when the caller expects a structured/JSON response (tool-calling, agent coordination payloads). */
  needsStructuredOutput?: boolean;
  /** True when the request includes an image/attachment. */
  hasVisionInput?: boolean;
}

const CODING_CAPABILITIES = new Set([
  'code_review', 'architecture_analysis', 'full_stack_development',
  'api_design', 'database_modeling', 'cloud_deployment', 'devops',
  'n8n', 'webhook_configuration', 'pipeline_architecture',
]);

const RESEARCH_CAPABILITIES = new Set([
  'market_research', 'competitive_intelligence', 'business_analysis',
]);

const PLANNING_CAPABILITIES = new Set([
  'software_planning', 'growth_planning', 'go_to_market_strategy',
  'pricing_strategy', 'workflow_design',
]);

const REASONING_KEYWORDS = /\b(why|analyze|reason|explain in depth|trade-?off|compare and contrast|root cause|evaluate)\b/i;
const SMALL_TASK_WORD_COUNT = 12;

function classifyTaskType(input: ClassifyInput, capabilities: string[]): TaskType {
  if (input.hasVisionInput) return 'VISION';
  if (input.isVoice) return 'VOICE';
  if (input.isAgentToAgent) return 'AGENT_TO_AGENT';
  if (input.needsTools) return 'TOOL_EXECUTION';
  if (input.needsStructuredOutput) return 'STRUCTURED_OUTPUT';

  if (input.isMissionTask && input.missionComplexity === 'complex') return 'LARGE_MISSION';

  if (capabilities.some((c) => CODING_CAPABILITIES.has(c))) return 'CODING';
  if (capabilities.some((c) => RESEARCH_CAPABILITIES.has(c))) return 'RESEARCH';
  if (capabilities.some((c) => PLANNING_CAPABILITIES.has(c))) return 'PLANNING';

  if (REASONING_KEYWORDS.test(input.text)) return 'COMPLEX_REASONING';

  const wordCount = input.text.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount <= SMALL_TASK_WORD_COUNT) return 'FAST_CHAT';
  if (input.isMissionTask) return 'SMALL_TASK';

  return 'NORMAL_CHAT';
}

export function classifyTask(input: ClassifyInput): TaskClassification {
  const complexity = classifyComplexity(input.text);
  const capabilities = input.requiredCapability
    ? [input.requiredCapability, ...resolveCapabilities(input.text)]
    : resolveCapabilities(input.text);
  const priority = estimatePriority(input.text);
  const taskType = classifyTaskType(input, capabilities);

  const needsReasoning =
    taskType === 'COMPLEX_REASONING' ||
    taskType === 'RESEARCH' ||
    taskType === 'PLANNING' ||
    taskType === 'LARGE_MISSION' ||
    complexity === 'complex';

  const latencySensitivity: TaskClassification['latencySensitivity'] =
    taskType === 'VOICE' || taskType === 'FAST_CHAT' || taskType === 'AGENT_TO_AGENT'
      ? 'high'
      : taskType === 'COMPLEX_REASONING' || taskType === 'LARGE_MISSION' || taskType === 'RESEARCH'
        ? 'low'
        : 'normal';

  const costSensitivity: TaskClassification['costSensitivity'] =
    taskType === 'FAST_CHAT' || taskType === 'SMALL_TASK' || taskType === 'AGENT_TO_AGENT' || taskType === 'VOICE'
      ? 'high'
      : taskType === 'LARGE_MISSION' || taskType === 'COMPLEX_REASONING'
        ? 'low'
        : 'normal';

  const reliabilityRequirement: TaskClassification['reliabilityRequirement'] =
    taskType === 'TOOL_EXECUTION' || taskType === 'AGENT_TO_AGENT' || taskType === 'LARGE_MISSION' || priority === 'critical'
      ? 'high'
      : 'normal';

  const expectedContextSize: TaskClassification['expectedContextSize'] =
    taskType === 'RESEARCH' || taskType === 'LARGE_MISSION' || complexity === 'complex'
      ? 'large'
      : taskType === 'FAST_CHAT' || taskType === 'AGENT_TO_AGENT' || taskType === 'VOICE'
        ? 'small'
        : 'medium';

  return {
    taskType,
    complexity,
    urgency: priority,
    expectedContextSize,
    needsTools: !!input.needsTools || taskType === 'TOOL_EXECUTION',
    needsReasoning,
    needsStructuredOutput: !!input.needsStructuredOutput || taskType === 'STRUCTURED_OUTPUT' || taskType === 'AGENT_TO_AGENT',
    needsVision: taskType === 'VISION',
    latencySensitivity,
    costSensitivity,
    reliabilityRequirement,
  };
}
