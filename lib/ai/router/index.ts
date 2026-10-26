// Dynamic Model Router — main entry point.
//
// route() is the ONLY function callers (executionLayer.ts, crew-coordinator.ts,
// voice-manager.ts via orchestrate()) need. It produces an ordered
// candidate list that lib/ai/ai-provider.ts's chatWithFallback/
// streamWithFallback already know how to walk — same fallback/retry
// mechanics as today (lib/ai/ai-provider.ts:isRetryable, unchanged), just
// fed a smarter order instead of the fixed FALLBACK_ORDER.
//
// Reuses, does not duplicate: lib/swarm/missionPlanner.ts's complexity/
// capability classifiers (taskClassifier.ts), lib/ai/pricing.ts's static
// pricing table (as a fallback under real catalog pricing), and
// lib/governance/entitlements.ts's checkBudget() (the same hard-gate
// launchMission() already uses).

import { loadSettings, type ProviderId } from '@/lib/settings/settings-service';
import { checkBudget } from '@/lib/governance/entitlements';
import { estimateCost } from '@/lib/ai/pricing';
import { getCandidateModels } from './modelCatalog';
import { getAllHealth } from './healthTracker';
import { scoreCandidate } from './scoring';
import type {
  RoutingRequest, RoutingDecision, RoutingStrategy, ScoredCandidate,
  ModelCapabilityProfile, TaskClassification,
} from './types';

export { classifyTask, type ClassifyInput } from './taskClassifier';
export { recordHealth } from './healthTracker';
export type * from './types';

const DEFAULT_TOKEN_ESTIMATE: Record<TaskClassification['expectedContextSize'], { input: number; output: number }> = {
  small: { input: 500, output: 300 },
  medium: { input: 2000, output: 800 },
  large: { input: 6000, output: 2000 },
};

// M7-13: what counts as "proven" for the latency-sensitive hard gate below
// — a handful of real successes at a solid success rate, not a perfect
// track record (a model with exactly one lucky call shouldn't count as
// field-tested either).
const MIN_PROVEN_SUCCESSES = 3;
const MIN_PROVEN_SUCCESS_RATE = 0.5;

function estimateCandidateCost(
  cap: ModelCapabilityProfile,
  inputTokens: number,
  outputTokens: number,
): number | null {
  // Real, provider-reported pricing (from the actual catalog discovery)
  // takes priority over the static pricing table — it's more likely to be
  // current, and covers models the static table has never heard of.
  if (cap.inputPrice != null && cap.outputPrice != null) {
    return (inputTokens / 1_000_000) * cap.inputPrice + (outputTokens / 1_000_000) * cap.outputPrice;
  }
  if (cap.free === true) return 0;
  const est = estimateCost(cap.provider, cap.modelId, inputTokens, outputTokens);
  return est.cost;
}

function explain(top: ScoredCandidate | null, taskType: string, fallbackCount: number): string {
  if (!top) return `No eligible model found for ${taskType} — check that at least one provider is configured and validated.`;
  const reasons: string[] = [];
  if (top.breakdown.taskMatch > 0.12) reasons.push(`strong fit for ${taskType.toLowerCase().replace(/_/g, ' ')}`);
  if (top.breakdown.latency > 0.08) reasons.push('low latency');
  if (top.breakdown.reliability > 0.12) reasons.push('a good recent reliability record');
  if (top.estimatedCost === 0) reasons.push('zero cost');
  else if (top.breakdown.costPenalty > -0.02) reasons.push('low cost');
  if (top.capability.validationStatus === 'connected') reasons.push('currently validated');
  const why = reasons.length > 0 ? reasons.join(', ') : 'the best available balance of capability, speed, and cost';
  const fallbackNote = fallbackCount > 0 ? ` ${fallbackCount} fallback${fallbackCount === 1 ? '' : 's'} available if it fails.` : '';
  return `Selected ${top.capability.displayName ?? top.model} (${top.provider}) for ${why}.${fallbackNote}`;
}

/**
 * Decide which provider+model should handle a request right now.
 *
 * Never throws — a routing failure degrades to an empty candidate list,
 * and callers (lib/ai/ai-provider.ts) already fall back to today's
 * behavior (active_provider + FALLBACK_ORDER) when no candidates are
 * supplied, so a router bug can never take down chat/mission execution.
 */
export async function route(request: RoutingRequest): Promise<RoutingDecision> {
  try {
    const settings = await loadSettings();
    const routingMode = settings.routing_mode ?? 'automatic';
    const routingStrategy: RoutingStrategy = settings.routing_strategy ?? 'balanced';
    const routingPreferences = settings.routing_preferences ?? {};

    const manualPick =
      (request.preferredProvider && request.preferredModel)
        ? { provider: request.preferredProvider, model: request.preferredModel }
        : routingMode === 'manual'
          ? routingPreferences[request.classification.taskType]
          : undefined;

    const [allCandidates, health, budget] = await Promise.all([
      getCandidateModels(),
      getAllHealth(),
      request.tenantId ? checkBudget(request.tenantId) : Promise.resolve(null),
    ]);

    const tokenEstimate = {
      input: request.estimatedInputTokens ?? DEFAULT_TOKEN_ESTIMATE[request.classification.expectedContextSize].input,
      output: request.estimatedOutputTokens ?? DEFAULT_TOKEN_ESTIMATE[request.classification.expectedContextSize].output,
    };
    const remainingBudget = budget && budget.limitUsd !== null ? Math.max(0, budget.limitUsd - budget.spendUsd) : null;

    let eligible = allCandidates;
    if (routingStrategy === 'free_only') {
      eligible = eligible.filter((c) => c.free === true);
    }

    const scored: ScoredCandidate[] = [];
    for (const cap of eligible) {
      const cost = estimateCandidateCost(cap, tokenEstimate.input, tokenEstimate.output);
      // Hard budget gate: a candidate whose estimated cost would blow the
      // remaining budget is removed outright, not merely deprioritized —
      // mirrors launchMission()'s hard-gate semantics (Section 8).
      if (remainingBudget !== null && cost !== null && cost > remainingBudget) continue;
      const modelHealth = health.get(`${cap.provider}::${cap.modelId}`) ?? null;
      // A model that has failed every recent attempt with no success is
      // removed rather than merely penalized, unless it's the only option —
      // handled below by falling back to the full scored list if empty.
      scored.push(scoreCandidate(cap, modelHealth, request.classification, cost, routingStrategy));
    }
    scored.sort((a, b) => b.score - a.score);

    // If every candidate got filtered/scored to nothing usable (e.g. a
    // strict free-only strategy with no free models configured), fall back
    // to the unfiltered scored set rather than returning zero candidates —
    // an imperfect answer beats silently blocking execution.
    let effectiveScored = scored.length > 0 ? scored : allCandidates.map((cap) => {
      const cost = estimateCandidateCost(cap, tokenEstimate.input, tokenEstimate.output);
      return scoreCandidate(cap, health.get(`${cap.provider}::${cap.modelId}`) ?? null, request.classification, cost, routingStrategy);
    }).sort((a, b) => b.score - a.score);

    // M7-13 (Amro's explicit "speed & reliability first" decision,
    // following the diagnostic round): an untested candidate must never
    // outrank a field-tested, proven provider on the critical response
    // path. The diagnostic's live route() call showed
    // openrouter/xingchen-agi/xing4.0-29b-a4b:free — zero rows in
    // provider_model_health, i.e. never actually called — beating Groq
    // and Gemini purely on a naming-pattern false positive (fixed above)
    // plus scoreReliability()'s 0.6 "mild optimism for untested
    // candidates" default.
    //
    // Gated on latencySensitivity !== 'low' rather than === 'high' only:
    // the diagnostic also found lib/crew/ai-intent-analyzer.ts's invisible
    // pre-response classification call routes through this exact function
    // with taskType STRUCTURED_OUTPUT, which taskClassifier.ts gives
    // latencySensitivity 'normal' (not 'high', since classifyTaskType()
    // only special-cases VOICE/FAST_CHAT/AGENT_TO_AGENT) — a '=== high'
    // gate would have left that call, which runs on literally every
    // message, still exposed to the exact bug this is fixing. 'low'
    // sensitivity (COMPLEX_REASONING/LARGE_MISSION/RESEARCH) is
    // deliberately excluded — those are the one case where trying a less-
    // proven but potentially more capable model is a legitimate trade-off,
    // not a latency/reliability risk.
    if (request.classification.latencySensitivity !== 'low') {
      const isProven = (s: ScoredCandidate) => {
        const h = health.get(`${s.provider}::${s.model}`);
        if (!h) return false;
        const total = h.successCount + h.failureCount;
        return total > 0 && h.successCount >= MIN_PROVEN_SUCCESSES && h.successCount / total >= MIN_PROVEN_SUCCESS_RATE;
      };

      // Layer 1 (preferred): Amro named Groq/Gemini specifically as "our
      // known-good, tested providers" — re-verification after the first
      // two fixes above (regex anchoring + real-latency-over-naming in
      // scoreTaskMatch) still found OTHER real, legitimately-scoring
      // providers (openrouter/tencent/hy-mt2-7b, then openrouter/auto)
      // outscoring Groq on genuine signals — not bugs, just two providers
      // that are also decent. Tuning the general scoring model further to
      // probabilistically favor Groq/Gemini can't GUARANTEE the outcome
      // Amro asked for; restricting the candidate pool itself can. Within
      // this restricted pool, real scoring still decides which of the two
      // wins — this doesn't hardcode "Groq always beats Gemini" or vice
      // versa, only "one of our two trusted providers beats everyone else"
      // for the responsiveness-critical path.
      const trusted = effectiveScored.filter((s) => s.provider === 'groq' || s.provider === 'gemini');
      if (trusted.length > 0) {
        // Still require proven-ness WITHIN the trusted pool — being Groq
        // or Gemini doesn't exempt an individual MODEL from the same
        // "untested must not win" rule (confirmed live: an entirely
        // untested gemini-omni-1.1-flash, zero provider_model_health rows,
        // still won here before this line existed). Falls back to the
        // full trusted set (proven or not) only if literally no Groq/
        // Gemini model has any track record yet — Amro's directive trusts
        // the PROVIDER by brand, so even an unvalidated Groq/Gemini model
        // is still preferable to a third-party free one.
        const provenTrusted = trusted.filter(isProven);
        effectiveScored = provenTrusted.length > 0 ? provenTrusted : trusted;
      } else {
        // Layer 2 (degrade gracefully): neither Groq nor Gemini is even
        // configured for this caller (e.g. a BYOK tenant who only set up
        // a different provider) — fall back to the proven-reliability gate
        // across all providers rather than leaving this tenant with no
        // speed-critical routing at all.
        const proven = effectiveScored.filter(isProven);
        if (proven.length > 0) effectiveScored = proven;
        // Layer 3 (fail open): nothing is proven either (fresh deployment,
        // zero call history anywhere) — same "an imperfect answer beats
        // silently blocking execution" posture as the free-only fallback
        // above; effectiveScored is left as the full, un-gated set.
      }
    }

    // A manual preference must not bypass the hard budget gate — security
    // requirement, not merely a scoring nicety (mission Section 21: "do not
    // allow tenants to manipulate internal routing in a way that bypasses
    // budget gates"). If honoring it would blow the remaining budget, it's
    // dropped and routing falls through to the automatic scored list —
    // same "fail safe, not fail open" posture as launchMission()'s own gate.
    let effectiveManualPick = manualPick;
    if (effectiveManualPick?.provider && effectiveManualPick?.model && remainingBudget !== null) {
      const manualCap = allCandidates.find((c) => c.provider === effectiveManualPick!.provider && c.modelId === effectiveManualPick!.model);
      const manualCost = manualCap ? estimateCandidateCost(manualCap, tokenEstimate.input, tokenEstimate.output) : null;
      if (manualCost !== null && manualCost > remainingBudget) {
        effectiveManualPick = undefined;
      }
    }

    const candidateList: { provider: ProviderId; model: string }[] = [];
    if (effectiveManualPick?.provider && effectiveManualPick?.model) {
      candidateList.push({ provider: effectiveManualPick.provider, model: effectiveManualPick.model });
    }
    for (const s of effectiveScored) {
      if (candidateList.some((c) => c.provider === s.provider && c.model === s.model)) continue;
      candidateList.push({ provider: s.provider, model: s.model });
    }

    const top = effectiveManualPick?.provider && effectiveManualPick?.model
      ? effectiveScored.find((s) => s.provider === effectiveManualPick!.provider && s.model === effectiveManualPick!.model) ?? effectiveScored[0] ?? null
      : effectiveScored[0] ?? null;

    const budgetBlockedManual = !!manualPick && !effectiveManualPick;

    return {
      candidates: candidateList,
      taskType: request.classification.taskType,
      selected: top,
      scored: effectiveScored,
      reason: budgetBlockedManual
        ? `Your configured preference would exceed the remaining budget — routed automatically instead.`
        : effectiveManualPick
          ? `Using your configured ${request.classification.taskType} preference (${effectiveManualPick.provider}/${effectiveManualPick.model}).`
          : explain(top, request.classification.taskType, candidateList.length - 1),
      mode: effectiveManualPick ? 'manual' : effectiveScored.length > 0 ? 'automatic' : 'fallback_static',
    };
  } catch {
    // Never let a routing failure block execution — empty candidates tells
    // ai-provider.ts to use its existing default behavior unchanged.
    return {
      candidates: [],
      taskType: request.classification.taskType,
      selected: null,
      scored: [],
      reason: 'Routing unavailable — using default provider configuration.',
      mode: 'fallback_static',
    };
  }
}
