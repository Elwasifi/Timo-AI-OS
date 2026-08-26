// Dynamic Model Router — capability inference from model ID/name patterns.
//
// IMPORTANT: this module infers a small number of RELATIVE, low-confidence
// signals from naming conventions real providers actually use (e.g.
// "flash" models are consistently faster/cheaper than "pro" models across
// Gemini's own lineup). It does NOT claim a provider-confirmed fact —
// every field this module can set lives under the `inferred*` namespace in
// ModelCapabilityProfile, kept structurally separate from the
// provider-reported fields (free/pricing/context/streaming/tools), which
// only ever come from modelCatalog.ts's real discovery data. Fields this
// module has no genuine signal for (vision, audio, structured-output,
// multilingual, tool-calling) are deliberately left untouched here —
// they stay 'unknown' unless the provider's own catalog says otherwise.

import type { ModelCapabilityProfile } from './types';

type Inferred = Pick<
  ModelCapabilityProfile,
  'inferredReasoningStrength' | 'inferredCodingStrength' | 'inferredSpeedTier'
>;

const CODING_PATTERNS = /coder|code|codestral|starcoder/i;
const STRONG_REASONING_PATTERNS = /\bpro\b|opus|large|405b|70b|72b|235b|ultra/i;
const FAST_PATTERNS = /flash|instant|lite|mini|nano|8b|7b|9b|1b\b|small/i;
const SLOW_PATTERNS = /\bpro\b|opus|large|405b|235b|ultra|thinking/i;

export function inferModelCapabilities(_provider: string, modelId: string): Inferred {
  const id = modelId.toLowerCase();

  const inferredCodingStrength: Inferred['inferredCodingStrength'] = CODING_PATTERNS.test(id)
    ? 'strong'
    : 'unknown';

  const inferredReasoningStrength: Inferred['inferredReasoningStrength'] = STRONG_REASONING_PATTERNS.test(id)
    ? 'strong'
    : FAST_PATTERNS.test(id)
      ? 'standard'
      : 'unknown';

  const inferredSpeedTier: Inferred['inferredSpeedTier'] = FAST_PATTERNS.test(id)
    ? 'fast'
    : SLOW_PATTERNS.test(id)
      ? 'slow'
      : 'unknown';

  return { inferredReasoningStrength, inferredCodingStrength, inferredSpeedTier };
}
