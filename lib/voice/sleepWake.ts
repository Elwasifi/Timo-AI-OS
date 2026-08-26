// Sleep/Wake phrase detection for voice input.
//
// Deliberately simple pattern matching, not a model call — sleep/wake is a
// local, instant, zero-cost state toggle, not something that should wait on
// a provider round-trip or consume budget. Matches English and Egyptian
// Arabic phrasings. Extend the arrays below to add more phrasings; do not
// add a second mechanism for this.

const SLEEP_PATTERNS = [
  /\btemo,?\s+(go to sleep|sleep now|sleep)\b/i,
  /يا\s*تيمو\s*نام/,
  /نام\s*يا\s*تيمو/,
];

const WAKE_PATTERNS = [
  /\btemo,?\s+(wake up|wake|come back)\b/i,
  /يا\s*تيمو\s*(اصحى|اصحي|قوم)/,
  /(اصحى|اصحي|قوم)\s*يا\s*تيمو/,
];

export type VoiceCommand = 'sleep' | 'wake' | null;

/** Returns which sleep/wake command the transcript matches, if any. */
export function detectSleepWakeCommand(text: string): VoiceCommand {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (WAKE_PATTERNS.some((p) => p.test(trimmed))) return 'wake';
  if (SLEEP_PATTERNS.some((p) => p.test(trimmed))) return 'sleep';
  return null;
}
