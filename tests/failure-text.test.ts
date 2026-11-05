// M7-13c-2b-1b: failure texts are de-duplicated by ONE shared pure helper (lib/utils/failureText.ts).
// Observed (mission 8d6c845a…): the same quota sentence five times in one task error, repeated again in the mission
// panel and the chat reply. Pure tests — no mocks.

import { describe, it, expect } from 'vitest';
import { dedupeFailureTexts, dedupeJoinedFailureText } from '@/lib/utils/failureText';
import { computeMissionOutcome, cleanReason, type OutcomeTaskInput } from '@/lib/swarm/missionOutcome';
import { buildMissionResponse } from '@/lib/swarm/missionMessages';

const QUOTA = "Gemini's request limit for models gemini-flash-lite-latest and gemini-3.6-flash was reached on this workspace's API key. Try again later, pin another model in Settings → AI Providers, or enable billing in Google AI Studio.";
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

describe('dedupeFailureTexts', () => {
  it('identical sentences collapse to one, with a count suffix', () => {
    expect(dedupeFailureTexts([QUOTA, QUOTA, QUOTA, QUOTA, QUOTA])).toBe(`${QUOTA} (repeated 5 times)`);
    expect(dedupeFailureTexts(['A failed.', 'A failed.'])).toBe('A failed. (repeated 2 times)');
  });
  it('a sentence that occurs once has NO suffix', () => {
    expect(dedupeFailureTexts(['Only once.'])).toBe('Only once.');
  });
  it('case, whitespace and trailing-punctuation variants count as identical; the first spelling is kept', () => {
    expect(dedupeFailureTexts(['Quota  reached.', 'quota reached', '  QUOTA\nREACHED. '])).toBe('Quota reached. (repeated 3 times)');
  });
  it('distinct sentences are all kept, in first-seen order, joined with "; "', () => {
    expect(dedupeFailureTexts(['B went wrong', 'A went wrong', 'C went wrong'])).toBe('B went wrong; A went wrong; C went wrong');
  });
  it('mixed: duplicates collapse in place and the distinct ones keep their order', () => {
    expect(dedupeFailureTexts(['X', 'Y', 'X', 'Z', 'Y', 'X'])).toBe('X (repeated 3 times); Y (repeated 2 times); Z');
  });
  it('empty input, blanks and null/undefined give an empty string', () => {
    expect(dedupeFailureTexts([])).toBe('');
    expect(dedupeFailureTexts(['', '   ', null, undefined])).toBe('');
    expect(dedupeFailureTexts(['', 'Real', '  ', 'Real'])).toBe('Real (repeated 2 times)');
  });
  it('does not merge sentences that merely share a prefix', () => {
    expect(dedupeFailureTexts(['Tool a failed', 'Tool a failed badly'])).toBe('Tool a failed; Tool a failed badly');
  });
});

describe('dedupeJoinedFailureText (already-joined text, as stored in older rows)', () => {
  it('collapses the stored 5x quota text to one sentence + count', () => {
    const stored = Array(5).fill(QUOTA).join('; ');
    expect(dedupeJoinedFailureText(stored)).toBe(`${QUOTA} (repeated 5 times)`);
  });
  it('only "; " (semicolon + space) separates messages: a bare ";" inside a sentence is not a split point', () => {
    expect(dedupeJoinedFailureText('x;y; x;y')).toBe('x;y (repeated 2 times)');
  });
  it('a text with no repeats comes back unchanged', () => {
    expect(dedupeJoinedFailureText('Alpha failed.; Beta failed.')).toBe('Alpha failed.; Beta failed.');
    expect(dedupeJoinedFailureText('One sentence; with a semicolon inside')).toBe('One sentence; with a semicolon inside');
  });
});

describe('the reason shown by the renderers (cleanReason) shows each distinct reason once; the 280 cap stays', () => {
  const stored = Array(5).fill(QUOTA).join('; ');
  it('cleanReason of the observed 1118-character stored text', () => {
    expect(stored.length).toBeGreaterThan(1000);
    const r = cleanReason(stored);
    expect(count(r, 'Gemini\'s request limit')).toBe(1);
    expect(r).toBe(`${QUOTA} (repeated 5 times)`);
    expect(r.length).toBeLessThanOrEqual(280);
  });
  it('distinct reasons are both kept; the cap still applies', () => {
    const r = cleanReason(`${QUOTA}; Another distinct problem happened.`);
    expect(r).toContain('Another distinct problem');
    expect(cleanReason('x'.repeat(500)).length).toBe(280);
  });
});

describe('BRIEF / FULL for the observed scenario: 2 failed tasks, one with the quota sentence stored 5 times', () => {
  const task = (id: string, msg: string): OutcomeTaskInput => ({ id, title: `Task ${id}`, status: 'failed', errorMessage: msg, assignedManager: 'nova' });
  const outcome = computeMissionOutcome([task('1', QUOTA), task('2', Array(5).fill(QUOTA).join('; '))]);

  it('BRIEF shows the reason sentence once per failed task, never five times', () => {
    const msg = buildMissionResponse(outcome, { title: 'jarvis' });
    expect(msg).toContain('Mission failed: 0 of 2 tasks succeeded.');
    expect(count(msg, QUOTA)).toBe(2);              // once for task 1, once for task 2
    expect(msg).toContain(`- Task 2: ${QUOTA} (repeated 5 times)`);
    expect(msg).toContain(`- Task 1: ${QUOTA}`);
  });
  it('FULL also shows the sentence once per failed task', () => {
    const msg = buildMissionResponse(outcome, { title: 'jarvis', detail: 'full' });
    expect(count(msg, QUOTA)).toBe(2);
  });
});
