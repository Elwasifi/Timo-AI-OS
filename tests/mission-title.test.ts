// M7-13c-2e-a Part B: the mission title is the name the user gave the mission, else the first clause cut at a WORD boundary.
// Pure helper (no LLM, no translation). Only new missions are affected.

import { describe, it, expect } from 'vitest';
import { deriveMissionTitle, explicitMissionName, cutAtWordBoundary, MAX_MISSION_TITLE_CHARS, EMPTY_MISSION_TITLE } from '@/lib/utils/missionTitle';

describe('an explicit name is used', () => {
  it.each([
    ['Please run a mission called Jarvis Research and then summarise it', 'Jarvis Research'],
    ['create a mission named "Q4 Launch Plan" for the new product', 'Q4 Launch Plan'],
    ['research open source assistants, name it Open Assistants Scan', 'Open Assistants Scan'],
    ['Find three competitors. Call it Competitor Sweep.', 'Competitor Sweep'],
    ['I want a mission "Brand Audit 2026" to look at our site', 'Brand Audit 2026'],
    ['mission: "Weekly Digest"', 'Weekly Digest'],
  ])('English: %s', (req, name) => {
    expect(explicitMissionName(req)).toBe(name);
    expect(deriveMissionTitle(req)).toBe(name);
  });

  it.each([
    ['ابحث عن مساعدين مفتوحة المصدر في ميشن اسمه بحث جارفيس', 'بحث جارفيس'],
    ['اعمل ميشن اسمها خطة الإطلاق الجديدة', 'خطة الإطلاق الجديدة'],
    ['عايز ميشن باسم دراسة المنافسين', 'دراسة المنافسين'],
    ['ابحث عن منافسينا وسمّيه مسح المنافسين', 'مسح المنافسين'],
    ['ابحث عن منافسينا وسميها مسح السوق ثم لخص النتائج', 'مسح السوق'],
    ['اسم الميشن تقرير الأسبوع', 'تقرير الأسبوع'],
    ['ابدأ ميشن "مراجعة العلامة التجارية" لموقعنا', 'مراجعة العلامة التجارية'],
    ['اعمل ميشن اسمه جارفيس، وابحث عن المشاريع', 'جارفيس'], // stops at the Arabic comma
  ])('Arabic: %s', (req, name) => {
    expect(deriveMissionTitle(req)).toBe(name);
  });

  it('a name with tashkeel is matched (the pattern ignores diacritics) and the "then ..." tail is not part of the name', () => {
    expect(deriveMissionTitle('ابحث وسَمِّيه مسح الأسواق ثم لخص')).toBe('مسح الأسواق');
    expect(deriveMissionTitle('mission called Alpha Plan then write a summary')).toBe('Alpha Plan');
  });

  it('a very long explicit name is also cut at a word boundary within 60', () => {
    const t = deriveMissionTitle('mission called ' + 'Alpha '.repeat(30));
    expect(Array.from(t).length).toBeLessThanOrEqual(MAX_MISSION_TITLE_CHARS);
    expect(t.endsWith('…')).toBe(true);
    expect(t).not.toMatch(/Alph…$/);
  });
});

describe('no explicit name: first clause, word-boundary cut', () => {
  it('a short request stays whole (minus the trailing full stop)', () => {
    expect(deriveMissionTitle('Find open source Jarvis projects.')).toBe('Find open source Jarvis projects');
  });

  it('takes only the first sentence', () => {
    expect(deriveMissionTitle('Research the top 5 CRM tools. Then compare their pricing and write a summary.')).toBe('Research the top 5 CRM tools');
    expect(deriveMissionTitle('ابحث عن أفضل خمس أدوات. بعد ذلك قارن الأسعار.')).toBe('ابحث عن أفضل خمس أدوات');
  });

  it('strips trivial leading politeness only (English and Arabic)', () => {
    expect(deriveMissionTitle('Please research the competitors of Acme')).toBe('research the competitors of Acme');
    expect(deriveMissionTitle('Could you please build a landing page for the shop')).toBe('build a landing page for the shop');
    expect(deriveMissionTitle('من فضلك ابحث عن مساعدين مفتوحة المصدر')).toBe('ابحث عن مساعدين مفتوحة المصدر');
    expect(deriveMissionTitle('Please')).toBe('Please'); // nothing real would remain: not stripped
  });

  it('a long request is cut at a word boundary within 60 characters, with an ellipsis, never mid-word', () => {
    const req = 'Research the leading open source voice assistants and compare their architecture, licences and community activity in detail';
    const t = deriveMissionTitle(req);
    expect(Array.from(t).length).toBeLessThanOrEqual(MAX_MISSION_TITLE_CHARS);
    expect(t.endsWith('…')).toBe(true);
    const body = t.slice(0, -1);
    expect(req.startsWith(body)).toBe(true);
    expect(req.charAt(body.length)).toBe(' '); // the cut falls on a word boundary
    expect(t).toBe('Research the leading open source voice assistants and…');
  });

  it('works for Arabic (cut at a word boundary within 60)', () => {
    const req = 'ابحث عن أفضل المساعدين الصوتيين مفتوحة المصدر وقارن بين بنيتهم وتراخيصهم ونشاط مجتمعهم بالتفصيل';
    const t = deriveMissionTitle(req);
    expect(Array.from(t).length).toBeLessThanOrEqual(MAX_MISSION_TITLE_CHARS);
    expect(t.endsWith('…')).toBe(true);
    const body = t.slice(0, -1);
    expect(req.startsWith(body)).toBe(true);
    expect(req.charAt(body.length)).toBe(' ');
  });

  it('never splits a surrogate pair (emoji) and never leaves a lone surrogate', () => {
    const t = deriveMissionTitle('🚀'.repeat(80));
    expect(Array.from(t).length).toBeLessThanOrEqual(MAX_MISSION_TITLE_CHARS);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(t)).toBe(false);
    expect(Array.from(cutAtWordBoundary('word '.repeat(40))).length).toBeLessThanOrEqual(MAX_MISSION_TITLE_CHARS);
  });

  it('a single very long word (a URL) is hard-cut because there is no word boundary', () => {
    const t = deriveMissionTitle('https://example.com/' + 'a'.repeat(100));
    expect(Array.from(t).length).toBe(MAX_MISSION_TITLE_CHARS);
    expect(t.endsWith('…')).toBe(true);
  });
});

describe('never empty', () => {
  it('an empty or whitespace request gets a fixed title; punctuation-only falls back to the old cut', () => {
    expect(deriveMissionTitle('')).toBe(EMPTY_MISSION_TITLE);
    expect(deriveMissionTitle('   \n ')).toBe(EMPTY_MISSION_TITLE);
    expect(deriveMissionTitle('...')).toBe('...');
    expect(deriveMissionTitle('?!')).toBe('?!');
  });

  it('"call it a day" style text without a real name still yields a title (not empty)', () => {
    expect(deriveMissionTitle('call it').length).toBeGreaterThan(0);
  });
});
