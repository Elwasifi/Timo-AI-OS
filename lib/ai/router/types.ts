// Dynamic Model Router — shared types.
//
// The router decides WHICH provider+model should handle a given request.
// It sits between callers (executionLayer.ts, crew-coordinator.ts,
// voice-manager.ts via orchestrate()) and lib/ai/ai-provider.ts's
// chatWithFallback/streamWithFallback — it never talks to a provider
// directly, it only produces an ordered candidate list that ai-provider.ts
// already knows how to walk through (same fallback/retry mechanics as
// today, just fed a smarter order).

import type { ProviderId } from '@/lib/settings/settings-service';

// ---- Task classification ----

export type TaskType =
  | 'VOICE'
  | 'FAST_CHAT'
  | 'NORMAL_CHAT'
  | 'AGENT_TO_AGENT'
  | 'SMALL_TASK'
  | 'CODING'
  | 'RESEARCH'
  | 'PLANNING'
  | 'COMPLEX_REASONING'
  | 'LARGE_MISSION'
  | 'TOOL_EXECUTION'
  | 'VISION'
  | 'STRUCTURED_OUTPUT';

export type LatencySensitivity = 'low' | 'normal' | 'high';
export type CostSensitivity = 'low' | 'normal' | 'high';
export type ReliabilityRequirement = 'normal' | 'high';

export interface TaskClassification {
  taskType: TaskType;
  complexity: 'simple' | 'medium' | 'complex';
  urgency: 'low' | 'medium' | 'high' | 'critical';
  expectedContextSize: 'small' | 'medium' | 'large';
  needsTools: boolean;
  needsReasoning: boolean;
  needsStructuredOutput: boolean;
  needsVision: boolean;
  latencySensitivity: LatencySensitivity;
  costSensitivity: CostSensitivity;
  reliabilityRequirement: ReliabilityRequirement;
}

// ---- Model capability profile ----
// Every field is either provider-reported (from provider_model_catalog,
// itself sourced from the real listModels() catalog call) or explicitly
// marked unknown. Nothing here is fabricated — see modelCapabilities.ts.

export type TriState = true | false | 'unknown';

export interface ModelCapabilityProfile {
  provider: ProviderId;
  modelId: string;
  displayName?: string;
  /** False when the provider isn't configured, hasn't been validated, or the model isn't in its last known catalog. */
  available: boolean;
  validationStatus: 'connected' | 'stale' | 'never_validated' | 'unavailable';
  lastValidatedAt: string | null;
  free: TriState;
  inputPrice: number | null;
  outputPrice: number | null;
  contextLength: number | null;
  supportsStreaming: TriState;
  supportsTools: TriState;
  supportsStructuredOutput: TriState;
  supportsVision: TriState;
  supportsAudio: TriState;
  /** Inferred from model-name patterns (e.g. "flash"→fast, "pro"/"large"→stronger reasoning) — never a provider-confirmed fact. Explicitly separate from provider-reported fields so callers can tell the difference. */
  inferredReasoningStrength: 'unknown' | 'standard' | 'strong';
  inferredCodingStrength: 'unknown' | 'standard' | 'strong';
  inferredSpeedTier: 'unknown' | 'fast' | 'standard' | 'slow';
  multilingual: TriState;
}

// ---- Provider/model health ----

export interface ModelHealth {
  provider: ProviderId;
  modelId: string;
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
  avgLatencyMs: number | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastStatusCode: number | null;
}

// ---- Routing request/decision ----

export interface RoutingRequest {
  classification: TaskClassification;
  tenantId: string | null;
  /** Manual per-task-type override from app_settings.routing_preferences, if the admin set one. */
  preferredProvider?: ProviderId;
  preferredModel?: string;
  /** Rough token estimate for budget filtering — callers rarely know this precisely, an order-of-magnitude guess is fine. */
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
}

export interface ScoredCandidate {
  provider: ProviderId;
  model: string;
  score: number;
  breakdown: Record<string, number>;
  estimatedCost: number | null;
  capability: ModelCapabilityProfile;
}

export interface RoutingDecision {
  /** Ordered best-first list — ai-provider.ts walks this exactly like it already walks FALLBACK_ORDER today. */
  candidates: { provider: ProviderId; model: string }[];
  taskType: TaskType;
  selected: ScoredCandidate | null;
  scored: ScoredCandidate[];
  /** Human-readable explanation of the top pick, safe to show a user. */
  reason: string;
  /** Routing mode actually applied this call ('manual' when a preference/override was used). */
  mode: 'automatic' | 'manual' | 'fallback_static';
}

export type RoutingStrategy = 'balanced' | 'speed' | 'quality' | 'cost' | 'free_only';
