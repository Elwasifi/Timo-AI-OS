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

// M7-13: these raw digit+"b" patterns (param-count tokens like "8b"/"70b")
// previously matched as unanchored SUBSTRINGS — "9b" matched inside "29b",
// so a real 29-billion-parameter model got misclassified as a small/fast
// model, which (combined with the router's "mild optimism" default for
// untested candidates) caused an unproven free model to outrank Groq/
// Gemini for every FAST_CHAT/VOICE routing decision (M7-13 diagnostic:
// live route() picked openrouter/xingchen-agi/xing4.0-29b-a4b:free over
// both). A digit-bounded helper requires the token to be a standalone
// number (no digit immediately before or after), not a substring of a
// larger one.
function digitBounded(token: string): string {
  return `(?<!\\d)${token}(?!\\d)`;
}

const STRONG_REASONING_PATTERNS = new RegExp(
  `\\bpro\\b|opus|\\blarge\\b|ultra|${digitBounded('405b')}|${digitBounded('70b')}|${digitBounded('72b')}|${digitBounded('235b')}`,
  'i',
);
const FAST_PATTERNS = new RegExp(
  `flash|instant|lite|mini|nano|\\bsmall\\b|${digitBounded('8b')}|${digitBounded('7b')}|${digitBounded('9b')}|${digitBounded('1b')}`,
  'i',
);
const SLOW_PATTERNS = new RegExp(
  `\\bpro\\b|opus|\\blarge\\b|ultra|thinking|${digitBounded('405b')}|${digitBounded('235b')}`,
  'i',
);

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
