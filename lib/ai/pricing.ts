// Provider/Model Pricing — Sprint 3 Cost Governance Foundation
//
// Static, manually maintained pricing data. No network calls are made to
// fetch live pricing. Figures are approximate USD list prices per 1M
// tokens, gathered from each provider's public pricing page at the time
// this table was written — they will drift from live pricing over time
// and should be updated by hand as needed. Every cost this module
// produces is therefore always treated as an ESTIMATE, never an exact
// bill reconciliation.
//
// Unknown provider/model pairs (e.g. arbitrary OpenRouter-routed models,
// or a newly added provider) are not an error: estimateCost() returns a
// null cost so the caller can still record token usage without a price.

import type { ProviderId } from '@/lib/settings/settings-service';

export interface ModelPricing {
  /** USD per 1,000,000 input tokens */
  inputPerMillion: number;
  /** USD per 1,000,000 output tokens */
  outputPerMillion: number;
  /** USD per 1,000,000 cached-input tokens, if the provider distinguishes them */
  cachedInputPerMillion?: number;
  /** USD per 1,000,000 cache-creation tokens, if the provider distinguishes them */
  cacheCreationPerMillion?: number;
}

// Only covers the models currently selectable in lib/settings/settings-service.ts
// (PROVIDER_MODELS). Extend this table — do not hardcode a single universal
// price — when new models are added there.
const PRICING: Partial<Record<ProviderId, Record<string, ModelPricing>>> = {
  gemini: {
    'gemini-2.0-flash': { inputPerMillion: 0.10, outputPerMillion: 0.40 },
    'gemini-2.0-flash-lite': { inputPerMillion: 0.075, outputPerMillion: 0.30 },
    'gemini-1.5-flash': { inputPerMillion: 0.075, outputPerMillion: 0.30 },
    'gemini-1.5-pro': { inputPerMillion: 1.25, outputPerMillion: 5.00 },
    'gemini-2.5-flash': { inputPerMillion: 0.30, outputPerMillion: 2.50 },
    'gemini-2.5-pro': { inputPerMillion: 1.25, outputPerMillion: 10.00 },
  },
  groq: {
    'llama-3.3-70b-versatile': { inputPerMillion: 0.59, outputPerMillion: 0.79 },
    'llama-3.1-8b-instant': { inputPerMillion: 0.05, outputPerMillion: 0.08 },
    'llama-3.1-70b-versatile': { inputPerMillion: 0.59, outputPerMillion: 0.79 },
    'mixtral-8x7b-32768': { inputPerMillion: 0.24, outputPerMillion: 0.24 },
    'gemma2-9b-it': { inputPerMillion: 0.20, outputPerMillion: 0.20 },
  },
  nvidia: {
    // NVIDIA NIM hosted-endpoint pricing varies by deployment/agreement and
    // is not publicly listed per-token the way the other providers are —
    // left empty so estimateCost() returns null rather than a guess.
  },
  openrouter: {
    // OpenRouter prices vary per routed underlying model. Only entries
    // matching PROVIDER_MODELS' preset list are filled in; anything else
    // (arbitrary model strings) intentionally falls through to null.
    'google/gemini-2.0-flash-001': { inputPerMillion: 0.10, outputPerMillion: 0.40 },
    'openai/gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.60 },
    'anthropic/claude-3.5-sonnet': { inputPerMillion: 3.00, outputPerMillion: 15.00 },
    'meta-llama/llama-3.3-70b-instruct': { inputPerMillion: 0.13, outputPerMillion: 0.39 },
    'google/gemini-flash-1.5': { inputPerMillion: 0.075, outputPerMillion: 0.30 },
    'groq/llama-3.3-70b-versatile': { inputPerMillion: 0.59, outputPerMillion: 0.79 },
  },
  ollama: {
    // Self-hosted — no per-token API cost. Handled as a special case in
    // estimateCost() below rather than listing every local model here.
  },
};

export interface CostEstimate {
  cost: number | null;
  isEstimated: boolean;
}

/**
 * Estimate the USD cost of a completion from static pricing data.
 * Returns { cost: null, isEstimated: true } when no pricing entry exists
 * for the given provider/model — callers should store the usage anyway
 * and simply leave cost unknown, per Sprint 3's cost-governance design.
 */
export function estimateCost(
  provider: ProviderId,
  model: string,
  inputTokens: number,
  outputTokens: number,
): CostEstimate {
  if (provider === 'ollama') {
    // Self-hosted: zero marginal API cost is a known fact, not an estimate.
    return { cost: 0, isEstimated: false };
  }

  const pricing = PRICING[provider]?.[model];
  if (!pricing) {
    return { cost: null, isEstimated: true };
  }

  const cost =
    (inputTokens / 1_000_000) * pricing.inputPerMillion +
    (outputTokens / 1_000_000) * pricing.outputPerMillion;

  return { cost: Number(cost.toFixed(6)), isEstimated: true };
}
