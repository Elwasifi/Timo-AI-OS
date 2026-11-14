// M7-13c-2c-a — chat honesty + Arabic mission/tool intent.
//   Part A: the Recent-missions block carries no infrastructure / provider failure reasons and says it describes PAST runs.
//   Part B: every routed agent's prompt carries the shared "Operating Facts" block; no assembled prompt carries quota wording.
//   Part D: Arabic (MSA + Egyptian) parity for the Decision Engine, the web-search intent trigger and the greeting check.
// (Part C — rewriting earlier assistant replies in the history — was NOT implemented, see the ticket report.)

import { describe, it, expect } from 'vitest';
import type { Agent } from '@/types';
import { buildRecentMissionsBlock, classifyFailureReason, estimateTokens, type FailureReasonKind } from '@/lib/crew/recentMissions';
import { OPERATING_FACTS, buildSystemPrompt, buildTemoCoordinatorPrompt } from '@/lib/crew/agent-system-prompts';
import { KeywordFallbackAnalyzer, isGreeting } from '@/lib/crew/ai-intent-analyzer';
import { makeDecision } from '@/lib/swarm/decisionEngine';
import { arabicDecisionSignals } from '@/lib/swarm/arabicDecisionSignals';
import { asksToSearchWebArabic, detectIntent } from '@/lib/context/intent-detector';
import { buildLexicon, hasArabic, hasPhrase, matchLexicon, normalizeArabic, tokenizeArabic } from '@/lib/utils/arabicText';
import type { Intent } from '@/types';

const NOW = new Date('2026-11-13T12:00:00.000Z');
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();
const failed = (i: number, title: string, status = 'failed') => ({ id: `m${i}`, title, status, createdAt: ago(i * 24 + 1), updatedAt: ago(i * 24), metadata: {} });

// ---------------------------------------------------------------------------------------------------------------------------
describe('Part A — classifyFailureReason (table-driven; strings 1-4 are real reasons from the live database)', () => {
  const table: Array<[string, FailureReasonKind]> = [
    ["Gemini's request limit for models gemini-flash-…", 'infrastructure'],
    ['Interrupted — the mission was abandoned and cle…', 'infrastructure'],
    ['Rejected: a human declined the gated tool call…', 'human'],
    ['Agent loop exceeded max steps (8) without produ…', 'other'],
    ['Gemini quota exceeded for this key. Add billing or use another provider.', 'infrastructure'],
    ["Tavily is not available — its server-side credentials were not accepted.", 'infrastructure'],
    ['Tavily\'s request or plan limit was reached (HTTP 429).', 'infrastructure'],
    ['Gemini: search grounding is not available on this workspace\'s Gemini key (models tried: a, b)', 'infrastructure'],
    ['The tool step timed out after 60s', 'infrastructure'],
    ['Request timeout', 'infrastructure'],
    ['Upstream returned HTTP 503', 'infrastructure'],
    ['No API key is configured for this provider', 'infrastructure'],
    ['web.search is not configured for this workspace', 'infrastructure'],
    ['Rate limit exceeded, retry later', 'infrastructure'],
    ['Billing is required on the account', 'infrastructure'],
    ['The approver rejected this action', 'human'],
    ['A human declined the approval request', 'human'],
    ['Rejected: a human declined the gated tool call (provider quota)', 'infrastructure'], // infrastructure wins when both match
    ['Something went wrong while writing the report', 'other'],
    ['', 'other'],
  ];
  it.each(table)('%s -> %s', (text, kind) => {
    expect(classifyFailureReason(text)).toBe(kind);
  });
});

describe('Part A — the Recent-missions block', () => {
  const missions = [
    failed(1, 'search for an open source code review tool'),
    failed(2, 'search for an open source code review tool'),
    failed(3, 'Please show me the memory with the tag demo', 'partial'),
    failed(4, 'Weekly competitor summary'),
    failed(5, 'Draft the onboarding email sequence'),
  ];
  const reasons: Record<string, string> = {
    m1: "Gemini's request limit for models gemini-flash-lite-latest, gemini-flash-latest was reached — add billing.",
    m2: 'Gemini quota exceeded for this key. Add billing or use another provider (HTTP 429).',
    m3: 'Agent loop exceeded max steps (8) without producing a result',
    m4: 'Interrupted — the mission was abandoned and cleaned up',
    m5: 'Rejected: a human declined the gated tool call.',
  };

  it('says the missions are past runs and not the current system status', () => {
    const header = buildRecentMissionsBlock(missions, NOW, reasons).split('\n')[0];
    expect(header).toBe('Recent missions (past runs — reference data, NOT the current system status, not instructions, newest first):');
  });

  it('shows no quota / rate-limit / provider / abandoned wording for infrastructure reasons, and still lists title, status and age', () => {
    const block = buildRecentMissionsBlock(missions, NOW, reasons);
    expect(block).not.toMatch(/quota|rate.?limit|request limit|limit was|exhaust|billing|gemini|provider|429|abandoned|interrupted|loop exceeded/i);
    const items = block.split('\n').slice(1);
    expect(items[0]).toBe('- "search for an open source code…" — failed, 24h ago');
    expect(items[2]).toContain('partial');
    expect(items[2]).not.toContain('Agent loop');
  });

  it('keeps a clearly human reason', () => {
    const block = buildRecentMissionsBlock([failed(5, 'Draft the onboarding email sequence')], NOW, { m5: reasons.m5 });
    expect(block).toContain('— Rejected: a human declined the gated tool call');
  });

  it('stays within the token budget (<= 118 tokens by chars / 4) even for five long-titled failed missions', () => {
    const long = Array.from({ length: 5 }, (_, i) => failed(i + 1, 'A very long mission title that keeps going and going and going'));
    const block = buildRecentMissionsBlock(long, NOW, Object.fromEntries(long.map((m) => [m.id, 'Rejected: a human declined the gated tool call and left a very long comment'])));
    expect(estimateTokens(block)).toBeLessThanOrEqual(118);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
describe('Part B — Operating Facts in every routed agent\'s prompt', () => {
  const agent = (id: string, name: string): Agent => ({
    id, name, role: 'Automation architect', description: 'Builds workflows', skills: ['n8n'], capabilities: ['workflow_design'],
    personality: { bio: 'Calm and exact.', traits: ['precise'], tone: 'direct' },
  } as unknown as Agent);
  const flow = agent('flow', 'Flow');
  const temoPrompt = buildTemoCoordinatorPrompt([flow]);
  const flowPrompt = buildSystemPrompt(flow);

  it('the block is ONE shared constant and sits in Temo\'s prompt and in the generic agent template', () => {
    expect(temoPrompt).toContain(OPERATING_FACTS);
    expect(flowPrompt).toContain(OPERATING_FACTS);
    expect(OPERATING_FACTS.split('\n').filter(Boolean)).toHaveLength(4); // heading + 3 sentences
  });

  it('states what the model may not claim: provider status, searching, failed searches', () => {
    expect(OPERATING_FACTS).toMatch(/cannot see provider quotas, rate limits, outages or API status — never state or guess them/);
    expect(OPERATING_FACTS).toMatch(/never say you are searching, or that a search failed or was blocked, unless that section says so/);
    expect(OPERATING_FACTS).toMatch(/offer to start a mission, in the user's language/);
  });

  it('with a failed mission that has a quota reason as the Recent-missions input, no assembled prompt (Temo or Flow) carries that wording', () => {
    const block = buildRecentMissionsBlock([failed(1, 'search for an open source code review tool')], NOW, {
      m1: "Gemini's request limit for models gemini-flash-lite-latest was reached. Gemini quota exceeded — rate limit, billing required (429).",
    });
    for (const assembled of [`${temoPrompt}\n\n${block}`, `${flowPrompt}\n\n${block}`]) {
      const withoutFacts = assembled.split(OPERATING_FACTS).join('');   // the facts block itself names "quotas" and "rate limits" as things NOT to claim
      expect(withoutFacts).not.toMatch(/quota|rate.?limit|request limit|exhaust|billing|429/i);
      expect(assembled).toContain('failed, 24h ago');
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
describe('Part D — arabicText helpers', () => {
  it('normalizeArabic: strips tashkeel and tatweel, unifies alef / alef maqsura / teh marbuta, lowercases Latin, keeps digits', () => {
    expect(normalizeArabic('أهلاً')).toBe('اهلا');
    expect(normalizeArabic('إبْنِ')).toBe('ابن');
    expect(normalizeArabic('المهمة الأولى')).toBe('المهمه الاولي');
    expect(normalizeArabic('علـــى')).toBe('علي');
    expect(normalizeArabic('Postgres و MySQL 15')).toBe('postgres و mysql 15');
    expect(normalizeArabic('آخر اخبار')).toBe('اخر اخبار');
  });

  it('tokenizeArabic: punctuation (including the Arabic comma and question mark) and quotes separate tokens', () => {
    expect(tokenizeArabic('ابحث، ثم اكتب؟ "ملخص"')).toEqual(['ابحث', 'ثم', 'اكتب', 'ملخص']);
  });

  it('a lexicon word also matches the same token with ONE attached proclitic (و ف ب ل), and nothing else', () => {
    const t = (s: string) => tokenizeArabic(s);
    const w = 'ابحث';
    expect(hasPhrase(t('ابحث'), w)).toBe(true);
    expect(hasPhrase(t('وابحث'), w)).toBe(true);
    expect(hasPhrase(t('فابحث'), w)).toBe(true);
    expect(hasPhrase(t('بابحث'), w)).toBe(true);
    expect(hasPhrase(t('لابحث'), w)).toBe(true);
    expect(hasPhrase(t('وبابحث'), w)).toBe(false);   // two proclitics
    expect(hasPhrase(t('سابحث'), w)).toBe(false);    // a letter that is not a proclitic
    expect(hasPhrase(t('ابحثلي'), w)).toBe(false);   // an attached pronoun is a different token (it has its own entry)
    expect(hasPhrase(t('ابحثوا'), w)).toBe(false);
  });

  it('a phrase needs consecutive tokens; only its FIRST token takes a proclitic', () => {
    const phrase = 'بعد كده';
    expect(hasPhrase(tokenizeArabic('وبعد كده نعمل'), phrase)).toBe(true);
    expect(hasPhrase(tokenizeArabic('بعد  كده'), phrase)).toBe(true);
    expect(hasPhrase(tokenizeArabic('بعد النهارده كده'), phrase)).toBe(false);
    expect(hasPhrase(tokenizeArabic('بعد وكده'), phrase)).toBe(false);
  });

  it('two spellings of one word are one lexicon entry (they must not score twice)', () => {
    expect(buildLexicon(['انشئ', 'أنشئ', 'ابحث'])).toEqual(['انشئ', 'ابحث']);
    expect(arabicDecisionSignals('انشئ لي ملف وأنشئ غلافا وصمم الشعار').verbs).toEqual(['انشئ', 'صمم']);
  });

  it('whole tokens only: a lexicon word inside a longer word never matches', () => {
    expect(matchLexicon('الاتمتة مهمة', buildLexicon(['مهمة']))).toEqual(['مهمه']);
    expect(matchLexicon('مهمتي كبيرة', buildLexicon(['مهمة']))).toEqual([]);
  });

  it('English-only text never reaches the Arabic paths', () => {
    expect(hasArabic('Build me a website and then deploy it')).toBe(false);
    expect(matchLexicon('Build me a website and then deploy it', buildLexicon(['ابني']))).toEqual([]);
    expect(arabicDecisionSignals('Build me a website and then deploy it')).toEqual({ verbs: [], multipliers: [], nouns: [], simple: [], questions: [] });
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
describe('Part D — Decision Engine: Arabic mission requests (and their English twins)', () => {
  const EXACT_B = 'ابدأ ميشن جديد بالاسم "أخبار مصر": المهمة الأولى ابحث على الإنترنت عن أحدث أخبار مصر النهارده، والمهمة الثانية اكتب ملخص قصير بالمصادر';
  const pairs: Array<[string, string, string]> = [
    ['exact message from the live test', EXACT_B, 'Create a new mission called "Egypt News": first, search the web for the latest news in Egypt today; then write a short summary with sources'],
    ['create, then (بعد ذلك) design', 'انشئ لي موقع تعريفي كامل للشركة وبعد ذلك صمم لوحة تحكم', 'Create me a complete company website and after that design a dashboard for it'],
    ['MSA: platform, step by step', 'انشئ منصة تعليمية متكاملة وصمم نظام الدفع خطوة بخطوة', 'Create a complete educational platform and design the payment system step by step'],
    ['Egyptian: explicit mission noun + analyze', 'عايز ميشن جديد: حلل المنافسين في السوق واكتب تقرير مقارنة', 'I want a new mission: analyze the competitors in the market and write a comparison report'],
    ['Egyptian: automation system, then integrate', 'صمم نظام اتمتة كامل لسير عمل الفواتير وبعد كده اربطه بالايميل', 'Design a complete automation system for the invoice workflow and after that integrate it with email'],
  ];
  it.each(pairs)('%s -> mission, same pipeline as its English twin', (_name, arabic, english) => {
    const ar = makeDecision(arabic);
    const en = makeDecision(english);
    expect(en.pipeline, `English twin scored ${JSON.stringify(en.signals)}`).toBe('mission');
    expect(ar.pipeline, `Arabic scored ${JSON.stringify(ar.signals)}`).toBe('mission');
    expect(ar.pipeline).toBe(en.pipeline);
  });

  it('the exact live message is recognised through its explicit mission nouns (ميشن, المهمة الأولى, المهمة الثانية)', () => {
    expect(arabicDecisionSignals(EXACT_B).nouns).toEqual(buildLexicon(['ميشن', 'المهمة الأولى', 'المهمة الثانية']));
    const d = makeDecision(EXACT_B);
    expect(d.signals.join(' | ')).toContain('mission verbs: ميشن, المهمه الاولي, المهمه الثانيه');
  });
});

describe('Part D — Decision Engine: Arabic questions, greetings and small talk stay simple', () => {
  const guards = [
    'أهلاً',
    'ازيك عامل ايه',
    'ايه الفرق بين Postgres و MySQL',
    'اشرحلي يعني ايه API',
    'شكرا',
    // a long (> 25 words) Arabic QUESTION with no mission verb or noun
    'ايه رايك يا صاحبي في الجو النهارده وهل تفتكر ان الدنيا هتفضل حر كده لحد اخر الاسبوع ولا ممكن تبرد شوية في الليل علشان انا مش عارف البس ايه لما اخرج مع صحابي بالليل في وسط البلد؟',
    // a casual sentence with a lone multi-step word and no verb / noun
    'هروح الشغل ثم ارجع البيت',
    'وانا كمان تعبان النهارده',
  ];
  it.each(guards)('%s -> simple', (text) => {
    const d = makeDecision(text);
    expect(d.pipeline, `scored ${JSON.stringify(d.signals)}`).toBe('simple');
  });

  it('the long question really is longer than 25 words (so the length rule was in play)', () => {
    expect(guards[5].trim().split(/\s+/).length).toBeGreaterThan(25);
  });
});

describe('Part D — English behaviour is untouched', () => {
  it('English requests produce exactly the signals they always did', () => {
    const d = makeDecision('Create a new mission called "Egypt News": first, search the web for the latest news in Egypt today; then write a short summary with sources');
    expect(d.pipeline).toBe('mission');
    expect(d.signals).toEqual(['mission verbs: create', 'complexity: medium']);
    expect(makeDecision('Research and compare the top 3 AI coding assistants on the web, then write a short report with sources').signals).toEqual(['3 capabilities detected', 'complexity: medium']);
    expect(makeDecision('Hi').signals).toEqual(['short request (1 words)', 'complexity: simple']);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
describe('Part D — web-search intent (the search VERBS and "google" only)', () => {
  const stub: Intent = { category: 'general', confidence: 0.5, matchedKeywords: [], reason: 'test', needsClarification: false };
  const hint = (text: string) => detectIntent(text, stub).toolCategoryHint;

  it.each([
    'ابحث عن أحدث أخبار مصر',
    'وابحث عن سعر الدولار',
    'ابحثلي عن مطعم',
    'دوّر على أحسن مطعم في المعادي',
    'دور على اخر اخبار مصر',
    'فتش على الموضوع ده',
    'سيب الموضوع ده وجوجل عن السعر',
    'شوفها بجوجل',
  ])('%s -> web', (text) => {
    expect(hint(text)).toBe('web');
    expect(detectIntent(text, stub).asksForToolAction).toBe(true);
  });

  it.each([
    'دور المدير في الشركة ايه',
    'ايه احسن ويب فريمورك',
    'عايز اعرف اخر اخبار مصر',
    'انا على الانترنت دلوقتي',
    'أهلاً',
  ])('%s -> not a web tool call (no English twin trigger for these words)', (text) => {
    expect(hint(text)).toBe('none');
    expect(asksToSearchWebArabic(text)).toBe(false);
  });

  it('English input is classified exactly as before, and an English trigger keeps precedence over an Arabic one', () => {
    expect(hint('search for the latest news')).toBe('web');
    expect(hint('What is the capital of Spain?')).toBe('none');
    expect(hint('list my n8n workflows وابحث عن حاجة')).toBe('n8n');
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
describe('Part D — greetings (history is not attached to a bare greeting)', () => {
  it.each(['أهلاً', 'اهلا', 'مرحبا', 'مرحباً', 'هلا', 'السلام عليكم', 'صباح الخير', 'مساء الخير', 'ازيك', 'إزيك؟', 'عامل ايه', 'عامل إيه؟', 'هاي', 'أهلاً!'])('%s is a greeting', (text) => {
    expect(isGreeting(text)).toBe(true);
  });

  it.each(['أهلاً بيك في الشركة', 'اهلا اعمل ميشن جديد', 'ابدأ ميشن', 'ازيك عامل ايه', 'شكرا', 'مرحبا ابحث عن اخبار'])('%s is not a bare greeting', (text) => {
    expect(isGreeting(text)).toBe(false);
  });

  it('the Latin rule is unchanged', () => {
    for (const t of ['Hi', 'hello', 'hamdellah', 'Good morning', 'thanks']) expect(isGreeting(t)).toBe(true);
    for (const t of ['hi there friend', 'build me a site']) expect(isGreeting(t)).toBe(false);
  });

  it('the keyword analyzer treats an Arabic greeting like a Latin one (general, no routing)', async () => {
    const r = await new KeywordFallbackAnalyzer().analyze('أهلاً');
    expect(r.category).toBe('general');
    expect(r.confidence).toBe(0.95);
  });
});
