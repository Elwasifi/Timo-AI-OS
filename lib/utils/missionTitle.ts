// M7-13c-2e-a — the mission title.
//
// It used to be the first 57 characters of the user's message plus "...", cut mid-word. Now: (a) the name the user gave the mission,
// when they gave one ("mission called X", "name it X", "call it X", "mission \"X\"", ميشن اسمه X, سمّيه X, اسم الميشن X, ميشن "X");
// otherwise (b) the first clause of the request, minus trivial leading politeness, cut at a WORD boundary. Pure and deterministic:
// no LLM, no translation. Only the title of NEW missions is affected.

export const MAX_MISSION_TITLE_CHARS = 60;
export const EMPTY_MISSION_TITLE = 'Untitled mission';

const TASHKEEL_AND_TATWEEL = /[ً-ٰٟـ]/g;
const QUOTE_OPEN = '"“”«‘\'';
const NAME_STOP = /\s+(?:and then|then|ثم)\s+/i;
const TRAILING_JUNK = /[\s,;:\-–—،؛.!?؟]+$/;
const LEADING_JUNK = /^[\s,;:\-–—،؛]+/;

/** `name` = the quoted text, or the rest of the clause. */
const QUOTED = `["“«'‘]([^"”»'’\\n]{1,200})["”»'’]`;
const UNQUOTED = '([^\\n.!?؟،؛]{1,200})';
const NAME = `(?:${QUOTED}|${UNQUOTED})`;

const EXPLICIT_PATTERNS: RegExp[] = [
  new RegExp(`\\b(?:mission|project)\\s+(?:called|named)\\s+${NAME}`, 'i'),
  new RegExp(`\\b(?:name|call)\\s+it\\s+${NAME}`, 'i'),
  new RegExp(`\\bmission\\s*:?\\s+${QUOTED}`, 'i'),
  // Arabic (matched on a copy without tashkeel/tatweel): ميشن اسمه X / ميشن باسم X / سميه X / سميها X / اسم الميشن (هو) X / ميشن "X"
  new RegExp(`ميشن\\s+(?:اسمه|اسمها|باسم)\\s+${NAME}`),
  new RegExp(`سميه\\s+${NAME}`),
  new RegExp(`سميها\\s+${NAME}`),
  new RegExp(`اسم\\s+(?:ال)?ميشن\\s*(?:هو|هي|:)?\\s*${NAME}`),
  new RegExp(`ميشن\\s*:?\\s+${QUOTED}`),
];

const FILLER_PREFIXES: RegExp[] = [
  /^(?:hey|hi|hello)\s+temo\s*[,:!-]*\s+/i,
  /^(?:please|pls|kindly)\s*[,:]?\s+/i,
  /^(?:can|could|would|will)\s+you\s+(?:please\s+)?/i,
  /^i\s+(?:want|need|would like)\s+you\s+to\s+/i,
  /^(?:يا\s*)?تيمو\s*[,:،!-]*\s+/,
  /^(?:لو\s+سمحت|من\s+فضلك|ممكن)\s*[,،:]?\s+/,
];

/** Cuts to <= max code points at a word boundary, adding "…" when something was cut (the result, "…" included, is <= max). */
export function cutAtWordBoundary(text: string, max: number = MAX_MISSION_TITLE_CHARS): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  const room = max - 1; // the ellipsis takes one
  let end = room;
  if (!/\s/.test(chars[room] ?? '')) {
    let i = room;
    while (i > 0 && !/\s/.test(chars[i - 1])) i -= 1;
    if (i > 0) end = i; // cut back to the last whitespace; a single very long word (no whitespace at all) is hard-cut
  }
  const body = chars.slice(0, end).join('').replace(TRAILING_JUNK, '');
  return `${body}…`;
}

function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').replace(LEADING_JUNK, '').replace(TRAILING_JUNK, '').trim();
}

/** The name the user gave the mission, or null. */
export function explicitMissionName(userRequest: string): string | null {
  const text = userRequest.replace(TASHKEEL_AND_TATWEEL, '');
  for (const re of EXPLICIT_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const quoted = m[1];
    let raw = quoted ?? m[2] ?? '';
    if (quoted === undefined) raw = raw.split(NAME_STOP)[0];
    const name = tidy(raw.replace(new RegExp(`^[${QUOTE_OPEN}]+|[${QUOTE_OPEN}]+$`, 'g'), ''));
    if (name) return name;
  }
  return null;
}

/** The first sentence/clause with trivial leading politeness removed (only if something real remains). */
function firstClause(userRequest: string): string {
  const flat = userRequest.trim();
  const sentence = flat.split(/(?<=[.!?؟])\s+|\n+/)[0] ?? flat;
  let text = tidy(sentence);
  for (let pass = 0; pass < 2; pass += 1) {
    let changed = false;
    for (const re of FILLER_PREFIXES) {
      const stripped = text.replace(re, '');
      if (stripped !== text && tidy(stripped).length >= 3) { text = tidy(stripped); changed = true; }
    }
    if (!changed) break;
  }
  return text;
}

export function deriveMissionTitle(userRequest: string): string {
  const request = typeof userRequest === 'string' ? userRequest : '';
  const named = explicitMissionName(request);
  const base = named ?? firstClause(request);
  if (base) return cutAtWordBoundary(base);
  const old = request.trim();
  if (!old) return EMPTY_MISSION_TITLE;
  return old.length <= 60 ? old : `${old.slice(0, 57)}...`;
}
