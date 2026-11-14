// M7-13c-2c-a (Part D) — matching-only Arabic text helpers (MSA + Egyptian dialect). Used by the Decision Engine, the intent
// detector and the greeting check so an Arabic request is understood like its English twin. NEVER used to rewrite text that is
// stored, shown or sent to a model: the normalized form exists only to be compared against normalized lexicon entries.
//
// Normalization: lowercase Latin, strip tashkeel (U+064B-U+065F, U+0670) and tatweel (U+0640), unify the alef forms to bare alef,
// alef maqsura -> yeh, teh marbuta -> heh. Digits and Latin letters are kept as they are.
// Matching is by whole token (not substring, unlike the English lists), and a lexicon word also matches the same token with ONE
// attached proclitic (wa, fa, bi, li) in front: "وابحث" matches "ابحث". Only the first token of a phrase takes a proclitic.

const TASHKEEL_AND_TATWEEL = /[\u064B-\u065F\u0670\u0640]/g;
const ALEF_FORMS = /[\u0622\u0623\u0625\u0671]/g;
const TOKEN = /[a-z0-9\u0621-\u064A\u0660-\u0669]+/g;
const ARABIC_LETTER = /[\u0600-\u06FF]/;
const PROCLITICS = '\u0648\u0641\u0628\u0644';

/** True when the text contains at least one Arabic-script character. English-only text never reaches the Arabic paths. */
export function hasArabic(text: string): boolean {
  return ARABIC_LETTER.test(text);
}

export function normalizeArabic(text: string): string {
  return text
    .toLowerCase()
    .replace(TASHKEEL_AND_TATWEEL, '')
    .replace(ALEF_FORMS, '\u0627')
    .replace(/\u0649/g, '\u064A')
    .replace(/\u0629/g, '\u0647');
}

/** Normalized text split into word tokens (punctuation, quotes and Arabic comma / question mark are separators). */
export function tokenizeArabic(text: string): string[] {
  return normalizeArabic(text).match(TOKEN) ?? [];
}

function tokenMatches(token: string, word: string, allowProclitic: boolean): boolean {
  if (token === word) return true;
  return allowProclitic && token.length === word.length + 1 && PROCLITICS.indexOf(token.charAt(0)) >= 0 && token.slice(1) === word;
}

/** True when `phrase` (already normalized, space-separated words) occurs in `tokens` as consecutive tokens. */
export function hasPhrase(tokens: readonly string[], phrase: string): boolean {
  const words = phrase.split(' ');
  for (let i = 0; i + words.length <= tokens.length; i++) {
    if (!tokenMatches(tokens[i], words[0], true)) continue;
    let ok = true;
    for (let j = 1; j < words.length; j++) {
      if (!tokenMatches(tokens[i + j], words[j], false)) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

/**
 * Normalizes a lexicon once, so entries can be written in natural spelling (with hamza, teh marbuta, ...). Entries that become
 * identical after normalization are kept once: two spellings of one word must not score twice.
 */
export function buildLexicon(entries: readonly string[]): string[] {
  const normalized = entries.map((e) => normalizeArabic(e).replace(/\s+/g, ' ').trim());
  return normalized.filter((e, i) => normalized.indexOf(e) === i);
}

/** The lexicon entries (as given in `normalized`) that occur in the text. */
export function matchLexicon(text: string, normalized: readonly string[]): string[] {
  if (!hasArabic(text)) return [];
  const tokens = tokenizeArabic(text);
  return normalized.filter((phrase) => hasPhrase(tokens, phrase));
}
