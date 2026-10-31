// Dynamic Model Router — scoring engine.
//
// A configurable weighted sum, not a hardcoded if/else tree (per the
// mission's explicit instruction). Every term is normalized to roughly
// [0,1] before weighting so the weights below are genuinely comparable —
// tune WEIGHTS to change routing behavior without touching the scoring
// logic itself.

import type { ModelCapabilityProfile, ModelHealth, ScoredCandidate, TaskClassification, RoutingStrategy } from './types';

export const WEIGHTS = {
  capabilityMatch: 0.20,
  taskMatch: 0.18,
  reliability: 0.15,
  latency: 0.12,
  contextFit: 0.08,
  providerHealth: 0.10,
  validationRecency: 0.07,
  structuredToolFit: 0.10,
  costPenalty: 0.20,
  rateLimitPenalty: 0.15,
  failurePenalty: 0.20,
};

// Strategy presets bias the weights toward one dimension without
// discarding the others entirely — e.g. "speed" still cares a little
// about cost, it just cares much more about latency.
const STRATEGY_MULTIPLIERS: Record<RoutingStrategy, Partial<typeof WEIGHTS>> = {
  balanced: {},
  speed: { latency: 2.2, taskMatch: 1.3, costPenalty: 0.6 },
  quality: { taskMatch: 1.8, capabilityMatch: 1.5, costPenalty: 0.4, latency: 0.6 },
  cost: { costPenalty: 2.5, latency: 0.7, taskMatch: 0.8 },
  free_only: { costPenalty: 3.0 }, // free-only filtering happens before scoring; this just reinforces cheap-among-free ordering
};

function effectiveWeights(strategy: RoutingStrategy): typeof WEIGHTS {
  const mult = STRATEGY_MULTIPLIERS[strategy];
  const out = { ...WEIGHTS };
  for (const k of Object.keys(mult) as (keyof typeof WEIGHTS)[]) {
    out[k] = WEIGHTS[k] * (mult[k] ?? 1);
  }
  return out;
}

const CONTEXT_FLOOR: Record<TaskClassification['expectedContextSize'], number> = {
  small: 4_000,
  medium: 32_000,
  large: 100_000,
};

function scoreCapabilityMatch(cap: ModelCapabilityProfile, task: TaskClassification): number {
  let score = 0.5; // neutral baseline — most fields are legitimately unknown
  let signals = 0;
  const check = (need: boolean, value: ModelCapabilityProfile[keyof ModelCapabilityProfile]) => {
    if (!need) return;
    signals++;
    if (value === true) score += 0.5;
    else if (value === false) score -= 0.5;
    // 'unknown' contributes nothing — genuine uncertainty, not a penalty
  };
  check(task.needsTools, cap.supportsTools);
  check(task.needsStructuredOutput, cap.supportsStructuredOutput);
  check(task.needsVision, cap.supportsVision);
  if (signals === 0) return 0.5;
  return Math.max(0, Math.min(1, score));
}

// M7-13: fast-chat fit used to be judged purely by inferredSpeedTier — a
// naming-pattern guess (modelCapabilities.ts's FAST_PATTERNS, e.g. "8b"/
// "flash"). That's a real blind spot for Groq specifically: Groq's speed
// comes from its hardware (LPU inference), not from running small models,
// so a legitimate Groq chat model like openai/gpt-oss-120b never matches
// any "small model" naming pattern and scored only a neutral 0.5 here —
// while an actually-slow model (confirmed: a real 4.1s avg latency) that
// merely has "7b" in its name scored 0.9, enough on its own to beat Groq's
// real, measured, sub-2.5s performance (M7-13 diagnostic + re-verification:
// openrouter/tencent/hy-mt2-7b outscored groq/openai/gpt-oss-120b despite
// being over 2x slower in practice). Mirrors scoreLatency()'s own already-
// documented principle — "real measured data always wins over inference" —
// by preferring real avg_latency_ms over the naming guess whenever it's
// available; the naming heuristic now only applies to genuinely untested
// candidates, which the route()-level proven-reliability gate already
// keeps out of fast-chat/voice routing in the first place.
function scoreTaskMatch(cap: ModelCapabilityProfile, task: TaskClassification, health: ModelHealth | null): number {
  let score = 0.5;
  if (task.taskType === 'CODING') {
    if (cap.inferredCodingStrength === 'strong') score = 0.9;
    else if (cap.inferredCodingStrength === 'unknown') score = 0.5;
  } else if (task.needsReasoning) {
    if (cap.inferredReasoningStrength === 'strong') score = 0.9;
    else if (cap.inferredReasoningStrength === 'standard') score = 0.5;
  } else if (task.latencySensitivity === 'high') {
    if (health?.avgLatencyMs != null) {
      if (health.avgLatencyMs <= 1500) score = 0.9;
      else if (health.avgLatencyMs >= 4000) score = 0.2;
      // else: genuinely middling real latency — stays at the neutral 0.5 default
    } else if (cap.inferredSpeedTier === 'fast') score = 0.9;
    else if (cap.inferredSpeedTier === 'slow') score = 0.2;
  }
  return score;
}

function scoreReliability(health: ModelHealth | null): number {
  if (!health || health.successCount + health.failureCount === 0) return 0.6; // mild optimism for untested candidates — don't starve new models
  const total = health.successCount + health.failureCount;
  return health.successCount / total;
}

function scoreLatency(health: ModelHealth | null, cap: ModelCapabilityProfile, sensitivity: TaskClassification['latencySensitivity']): number {
  if (health?.avgLatencyMs != null) {
    // 500ms→~1.0, 3000ms→~0.2, roughly — real measured data always wins over inference.
    const norm = Math.max(0, Math.min(1, 1 - (health.avgLatencyMs - 500) / 2500));
    return sensitivity === 'low' ? 0.5 + norm * 0.5 : norm;
  }
  if (cap.inferredSpeedTier === 'fast') return 0.75;
  if (cap.inferredSpeedTier === 'slow') return 0.3;
  return 0.5;
}

function scoreContextFit(cap: ModelCapabilityProfile, task: TaskClassification): number {
  if (cap.contextLength == null) return 0.5; // unknown — don't penalize
  const floor = CONTEXT_FLOOR[task.expectedContextSize];
  return cap.contextLength >= floor ? 1 : cap.contextLength >= floor / 2 ? 0.4 : 0.1;
}

function scoreProviderHealth(cap: ModelCapabilityProfile): number {
  if (cap.validationStatus === 'connected') return 1;
  if (cap.validationStatus === 'stale') return 0.6;
  return 0.4; // never_validated — still usable, just unproven
}

function scoreValidationRecency(cap: ModelCapabilityProfile): number {
  if (!cap.lastValidatedAt) return 0.4;
  const ageMs = Date.now() - new Date(cap.lastValidatedAt).getTime();
  const ageHours = ageMs / (60 * 60 * 1000);
  if (ageHours < 1) return 1;
  if (ageHours < 24) return 0.8;
  if (ageHours < 24 * 7) return 0.5;
  return 0.3;
}

function scoreStructuredToolFit(cap: ModelCapabilityProfile, task: TaskClassification): number {
  if (!task.needsTools && !task.needsStructuredOutput) return 0.5;
  if (cap.supportsTools === true) return 1;
  if (cap.supportsTools === false) return 0.1;
  return 0.5;
}

function costPenalty(estimatedCost: number | null, task: TaskClassification): number {
  if (estimatedCost === null) return 0.3; // unknown pricing — mild caution, not a hard penalty
  if (estimatedCost === 0) return 0;
  const scaleByTaskSensitivity = task.costSensitivity === 'high' ? 8 : task.costSensitivity === 'low' ? 2 : 4;
  return Math.max(0, Math.min(1, estimatedCost * scaleByTaskSensitivity));
}

function rateLimitPenalty(health: ModelHealth | null): number {
  if (!health?.lastFailureAt || health.lastStatusCode !== 429) return 0;
  const minutesSince = (Date.now() - new Date(health.lastFailureAt).getTime()) / 60_000;
  if (minutesSince < 1) return 1;
  if (minutesSince < 5) return 0.6;
  if (minutesSince < 15) return 0.3;
  return 0;
}

// M7-13b: this used to be a flat Math.min(1, consecutiveFailures * 0.35)
// with no regard for how much history backs that streak — 2 consecutive
// failures scored identically whether the model had 3 total calls or 196.
// Confirmed live: groq/allam-2-7b's 2 consecutive failures out of 196
// calls (99% historical success rate) cost it a -0.14 weighted penalty,
// almost exactly canceling its real, measured ~1.1s latency advantage
// over the router's actual pick — a model with a far thinner track
// record. Two changes: (1) scale the raw penalty down by sqrt(totalCalls)
// — a couple of recent misses in a long, mostly-successful history should
// weigh far less than the same couple of misses in a tiny sample, while a
// model with few total calls still gets a meaningful penalty from a
// failure streak (sqrt grows slowly: 196 calls -> /14, 6 calls -> /2.4);
// (2) decay the penalty by how long ago the last failure was — a streak
// from an hour-plus ago matters less than one from the last few minutes,
// since "consecutiveFailures" as stored is a raw counter with no time
// dimension of its own.
export function failurePenalty(health: ModelHealth | null): number {
  if (!health || health.consecutiveFailures <= 0) return 0;
  // M7-13e: scale by SUCCESSES, not total calls. Total calls includes the
  // failures themselves, so a permanently broken model (0 successes, N
  // failures — e.g. nvidia returning 404 on every call) saw its penalty
  // SHRINK as it kept failing (N=100 -> /10), making it retried MORE, the
  // opposite of the intent. A track record of successes is what earns
  // leniency for a couple of recent misses; a model with none gets the
  // full, unscaled penalty.
  const raw = Math.min(1, health.consecutiveFailures * 0.35);
  const sampleScaled = raw / Math.sqrt(Math.max(1, health.successCount));
  const minutesSinceFailure = health.lastFailureAt
    ? (Date.now() - new Date(health.lastFailureAt).getTime()) / 60_000
    : 0;
  const decay = minutesSinceFailure > 60 ? 0.3 : minutesSinceFailure > 15 ? 0.6 : 1;
  return sampleScaled * decay;
}

export function scoreCandidate(
  cap: ModelCapabilityProfile,
  health: ModelHealth | null,
  task: TaskClassification,
  estimatedCost: number | null,
  strategy: RoutingStrategy,
): ScoredCandidate {
  const w = effectiveWeights(strategy);
  const breakdown = {
    capabilityMatch: scoreCapabilityMatch(cap, task) * w.capabilityMatch,
    taskMatch: scoreTaskMatch(cap, task, health) * w.taskMatch,
    reliability: scoreReliability(health) * w.reliability,
    latency: scoreLatency(health, cap, task.latencySensitivity) * w.latency,
    contextFit: scoreContextFit(cap, task) * w.contextFit,
    providerHealth: scoreProviderHealth(cap) * w.providerHealth,
    validationRecency: scoreValidationRecency(cap) * w.validationRecency,
    structuredToolFit: scoreStructuredToolFit(cap, task) * w.structuredToolFit,
    costPenalty: -costPenalty(estimatedCost, task) * w.costPenalty,
    rateLimitPenalty: -rateLimitPenalty(health) * w.rateLimitPenalty,
    failurePenalty: -failurePenalty(health) * w.failurePenalty,
  };
  const score = Object.values(breakdown).reduce((a, b) => a + b, 0);

  return {
    provider: cap.provider,
    model: cap.modelId,
    score,
    breakdown,
    estimatedCost,
    capability: cap,
  };
}
