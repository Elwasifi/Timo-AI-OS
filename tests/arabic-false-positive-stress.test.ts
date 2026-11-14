// M7-13c-2c-a (delta): false-positive stress test for the Arabic Decision Engine lists. Every casual (non-mission) Egyptian / MSA
// sentence must stay on the simple pipeline — including sentences that use a mission-list word in its ordinary sense. When one of
// them flips, the fix is in the LISTS or the Arabic-only safety rule (lib/swarm/arabicDecisionSignals.ts), never in the thresholds.

import { describe, it, expect } from 'vitest';
import { makeDecision } from '@/lib/swarm/decisionEngine';
import { arabicDecisionSignals } from '@/lib/swarm/arabicDecisionSignals';
import { CASUAL_SENTENCES, KNOWN_SINGLE_SIGNAL_FALSE_POSITIVES } from './arabic-casual-sentences';

describe('Arabic casual sentences stay simple', () => {
  it('the corpus is large and varied enough to mean something (at least 40 sentences, 9 groups)', () => {
    expect(CASUAL_SENTENCES.length).toBeGreaterThanOrEqual(40);
    expect(new Set(CASUAL_SENTENCES.map(([group]) => group)).size).toBeGreaterThanOrEqual(9);
  });

  it.each(CASUAL_SENTENCES.map(([group, text]) => [group, text] as [string, string]))('[%s] %s -> simple', (_group, text) => {
    const d = makeDecision(text);
    expect(d.pipeline, `scored ${JSON.stringify(d.signals)}`).toBe('simple');
  });

  it('words removed from the lists are NOT on any list (they would otherwise count next to two real mission words)', () => {
    // Paired with a real verb and a real multiplier the two-signal rule is satisfied, so a word that is (wrongly) on a list shows up.
    // homographs: طبق = dish, ولد = boy, نفذ = ran out, ابني = my son, طور = stage / Tur; everyday words: اعمل حلل جهز خطط ثم كمان وبعدين نظام
    for (const word of ['طبق', 'ولد', 'نفذ', 'ابني', 'طور', 'اعمل', 'حلل', 'جهز', 'خطط', 'ثم', 'كمان', 'وبعدين', 'نظام']) {
      const s = arabicDecisionSignals(`${word} انشئ بعد ذلك`);
      expect([...s.verbs, ...s.multipliers, ...s.nouns], `${word} is on a mission list`).toEqual(['انشئ', 'بعد ذلك']);
    }
  });
});

// Documented limitation, not a goal: see the comment on KNOWN_SINGLE_SIGNAL_FALSE_POSITIVES. These assertions PIN today's behaviour (they
// say "mission"); the day a scoring fix makes one of these sentences simple, the test fails and whoever fixes it moves the sentence into
// CASUAL_SENTENCES.
describe('known single-signal false positives (pinned, same behaviour as the English rule)', () => {
  it.each(KNOWN_SINGLE_SIGNAL_FALSE_POSITIVES.map(([group, text]) => [group, text] as [string, string]))('[%s] %s currently scores as a mission', (_group, text) => {
    expect(makeDecision(text).pipeline).toBe('mission');
  });
});

describe('Arabic two-signal safety rule (explicit mission noun, OR at least two distinct verb / multiplier matches)', () => {
  const sig = (t: string) => arabicDecisionSignals(t);

  it('(a) ONE verb in a long (8+ words) casual sentence -> simple, and the verb is not reported', () => {
    const t = 'اخويا صمم على رايه ومفيش حد قدر يقنعه حتى لو اتكلمنا ساعات';
    expect(t.split(/\s+/).length).toBeGreaterThanOrEqual(8);
    expect(sig(t).verbs).toEqual([]);
    expect(makeDecision(t).pipeline).toBe('simple');
  });

  it('(b) ONE multiplier in a long (8+ words) casual sentence -> simple, and the multiplier is not reported', () => {
    const t = 'بعد كده هنروح السينما ونتعشى برة ونرجع متأخر شوية';
    expect(t.split(/\s+/).length).toBeGreaterThanOrEqual(8);
    expect(sig(t).multipliers).toEqual([]);
    expect(makeDecision(t).pipeline).toBe('simple');
  });

  it('(c) two verbs, or a verb + a multiplier -> mission', () => {
    const twoVerbs = makeDecision('انشئ لي ملف وصمم الغلاف');
    expect(twoVerbs.pipeline, JSON.stringify(twoVerbs.signals)).toBe('mission');
    const verbAndMultiplier = makeDecision('صمم الصفحة بعد كده');
    expect(verbAndMultiplier.pipeline, JSON.stringify(verbAndMultiplier.signals)).toBe('mission');
    expect(sig('صمم الصفحة بعد كده')).toMatchObject({ verbs: ['صمم'], multipliers: ['بعد كده'] });
  });

  it('(d) ONE explicit mission noun alone -> mission', () => {
    const t = 'عايز ميشن جديد اتابعه كل يوم علشان اعرف الاخبار';
    expect(t.split(/\s+/).length).toBeGreaterThanOrEqual(8);
    expect(sig(t).nouns).toEqual(['ميشن']);
    expect(makeDecision(t).pipeline).toBe('mission');
  });

  it('(e) a mixed English + Arabic message keeps its English signals, and a lone Arabic word adds nothing', () => {
    const d = makeDecision('Build me a website وصمم الشعار');
    expect(d.signals[0]).toBe('mission verbs: build');
    expect(d.signals.join(' | ')).not.toContain('صمم');
    expect(d.pipeline).toBe('mission');
    // two Arabic matches next to English words still count
    expect(makeDecision('Build me a website وصمم الشعار وبعد كده انشئ الصفحة').signals[0]).toBe('mission verbs: build, انشئ, صمم');
  });

  it('(f) ACCEPTED under-trigger: a single-verb request stays a chat message (the user can say "ميشن" to make it a mission)', () => {
    const t = 'صمم لي شعار لشركتي الجديدة اللي هفتحها السنة الجاية';
    expect(makeDecision(t).pipeline).toBe('simple');
    expect(makeDecision(`ميشن جديد: ${t}`).pipeline).toBe('mission');
  });
});
