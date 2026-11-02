// M7-13c-1: (1) Temo's chat prompt asks for the user's own language, and the
// tenant's Client Preferences directive (appended later by withIdentity) still
// comes after it. (2) Evidence test: common greetings do not score as missions.

import { describe, it, expect } from 'vitest';
import { buildTemoCoordinatorPrompt } from '@/lib/crew/agent-system-prompts';
import { buildIdentityDirective, type ClientProfile } from '@/lib/governance/clientProfile';
import { makeDecision } from '@/lib/swarm/decisionEngine';

const prompt = buildTemoCoordinatorPrompt([]);
const LANGUAGE_LINE = "Reply in the language the user's LATEST message is mainly written in";

describe('Temo coordinator prompt — reply language', () => {
  it('contains the language guideline, keeping code and technical terms untranslated', () => {
    expect(prompt).toContain(LANGUAGE_LINE);
    expect(prompt).toMatch(/lone borrowed word does not change the language/);
    expect(prompt).toMatch(/Keep code, commands and technical terms as they are/);
  });

  it('sits in the Guidelines list, before the Voice section with the Egyptian-Arabic guidance, which is still there', () => {
    const lang = prompt.indexOf(LANGUAGE_LINE);
    expect(lang).toBeGreaterThan(prompt.indexOf('## Guidelines'));
    expect(lang).toBeLessThan(prompt.indexOf('## Voice'));
    expect(prompt).toContain('If the user writes in Arabic, that\'s a separate, stronger signal');
  });

  it('says a Client Preferences language overrides it, and that block (appended by withIdentity) comes AFTER the guideline', () => {
    expect(prompt).toMatch(/"Client Preferences" section below names a language, that overrides this/);
    const profile = { assistantName: 'Temo', preferredLanguage: 'ar' } as unknown as ClientProfile;
    const full = prompt + buildIdentityDirective(profile);
    expect(full.indexOf('## Client Preferences')).toBeGreaterThan(full.indexOf(LANGUAGE_LINE));
    expect(full.startsWith(prompt)).toBe(true);
  });

  it('without a client language the prompt carries no Client Preferences block at all', () => {
    expect(prompt + buildIdentityDirective(null)).not.toContain('## Client Preferences');   // (the Voice section only MENTIONS the name)
  });
});

describe('decision engine — greetings and small talk are NOT missions', () => {
  it.each([
    'Hi',
    'Hello Temo',
    'How are you doing today?',
    "Who's available from the team now?",
    "How's available from the team now?",
    'hey',
    'thanks',
    'Good morning',
    'What can you do?',
  ])('%s -> simple', (text) => {
    const d = makeDecision(text);
    expect(d.pipeline, `${text} scored ${JSON.stringify(d.signals)}`).toBe('simple');
  });
});
