// M7-13c-2c-a (Part D) — Arabic (MSA + Egyptian dialect) twins of the Decision Engine's English keyword lists.
// The weights and thresholds are the English ones (decisionEngine.ts: verbs +2 each, multipliers +2 each, simple indicators +2 each,
// question marker +1 when there is no verb); nothing in decisionEngine.ts changed. The one Arabic-only addition is a safety rule:
// verbs, multipliers and nouns count only when the message has an explicit mission noun ("ميشن", "المهمة الأولى", ...) OR at least two
// distinct verb / multiplier matches (see arabicDecisionSignals below). Nouns are scored like verbs. The function returns empty lists
// for text with no Arabic character, so English behaviour is byte-for-byte unchanged.
//
// Not mirrored on purpose (they stay English-only, as they feed mission PLANNING which is out of scope here): resolveCapabilities
// and classifyComplexity (lib/swarm/missionPlanner.ts). "Can you ..." has no Arabic twin either ("ممكن" is a politeness marker,
// not a question).

import { buildLexicon, hasArabic, matchLexicon } from '@/lib/utils/arabicText';

const MISSION_VERBS = buildLexicon([
  'انشئ', 'صمم', 'اتمتة',
]);

// Pruned against tests/arabic-false-positive-stress.test.ts. Removed because they are different words that share their letters once
// tashkeel is gone, or are everyday words in ordinary talk: ابني (my son), طبق (dish), ولد (boy), نفذ (ran out), طور (stage / Tur),
// اعمل / حلل / جهز / خطط (no entry in the English MISSION_VERBS, and common in daily speech), ثم / كمان / وبعدين (bare connectives),
// نظام / النظام (school / diet / transport "system"), مهمة جديدة / خطة عمل. "واخيرا" keeps its attached wa on purpose.
const MISSION_MULTIPLIERS = buildLexicon([
  'بعد كده', 'بعد ذلك', 'وأخيرا', 'خطوة بخطوة', 'سير عمل', 'منصة',
]);

const MISSION_NOUNS = buildLexicon([
  'ميشن', 'المهمة الأولى', 'المهمة الثانية', 'المهمة الثالثة',
]);

// Twins of 'what is', 'explain', 'how do', 'why', 'translate', 'summarize', 'define', 'tell me about', 'who is', 'where is', 'do you know'.
const SIMPLE_INDICATORS = buildLexicon([
  'ما هو', 'ما هي', 'ايه هو', 'ايه هي', 'يعني ايه', 'ايه الفرق', 'اشرح', 'اشرحلي', 'وضح', 'وضحلي', 'ازاي', 'كيف', 'ليه', 'لماذا',
  'ترجم', 'ترجملي', 'لخص', 'لخصلي', 'عرف', 'احكيلي', 'مين هو', 'مين هي', 'من هو', 'من هي', 'فين', 'اين', 'هل تعرف', 'تعرف',
]);

const QUESTION_WORDS = buildLexicon(['ايه', 'ليه', 'ازاي', 'مين', 'فين', 'امتي', 'كام', 'ماذا', 'لماذا', 'كيف', 'اين']);

export interface ArabicDecisionSignals {
  verbs: string[];
  multipliers: string[];
  nouns: string[];
  simple: string[];
  questions: string[];
}

export function arabicDecisionSignals(userRequest: string): ArabicDecisionSignals {
  if (!hasArabic(userRequest)) return { verbs: [], multipliers: [], nouns: [], simple: [], questions: [] };
  const questions = matchLexicon(userRequest, QUESTION_WORDS);
  if (userRequest.indexOf('\u061F') >= 0) questions.push('\u061F');
  const verbs = matchLexicon(userRequest, MISSION_VERBS);
  const multipliers = matchLexicon(userRequest, MISSION_MULTIPLIERS);
  const nouns = matchLexicon(userRequest, MISSION_NOUNS);
  const simple = matchLexicon(userRequest, SIMPLE_INDICATORS);
  // Safety rule (reviewer decision, M7-13c-2c-a delta 2): Arabic mission signals count ONLY when the message has an explicit mission noun,
  // or at least TWO distinct verb / multiplier matches. One everyday word ("بعد كده", "صمم") in a long casual sentence is not a request.
  // The accepted cost: a single-verb request ("صمم لي شعار ...") stays a chat message; the user can say "ميشن" to make it a mission.
  const strong = nouns.length > 0 || verbs.length + multipliers.length >= 2;
  if (!strong) return { verbs: [], multipliers: [], nouns: [], simple, questions };
  return { verbs, multipliers, nouns, simple, questions };
}
