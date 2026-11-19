// M7-13c-2e-a Part C: the transient mission acknowledgment is produced BEFORE the plan exists (generateFastAcknowledgment runs in
// parallel with planning), so it must be plan-independent: it never promises a step, summary or follow-up. A model-written sentence
// that does is replaced by the generic template (English, or Arabic for an Arabic request). No network.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/swarm/decisionEngine', () => ({ makeDecision: vi.fn() }));
vi.mock('@/lib/swarm/missionEngine', () => ({ launchMission: vi.fn() }));
vi.mock('@/lib/swarm/executionLayer', () => ({ executeMissionTasks: vi.fn() }));
vi.mock('@/lib/swarm/missionService', () => ({ updateMission: vi.fn(), getTimeline: vi.fn() }));
vi.mock('@/lib/swarm/missionTimeline', () => ({ recordEvent: vi.fn() }));
vi.mock('@/lib/swarm/runtimeStore', () => ({ emitRuntimeEvent: vi.fn(), updateRuntimeState: vi.fn() }));
vi.mock('@/lib/ai/router', () => ({ route: vi.fn(), classifyTask: vi.fn() }));
vi.mock('@/lib/ai/ai-provider', () => ({ chatWithFallback: vi.fn() }));
vi.mock('@/lib/ai/conversation-service', () => ({ ConversationService: {} }));
vi.mock('@/lib/crew/crew-coordinator', () => ({ crewCoordinator: {} }));

import {
  generateFastAcknowledgment, isHonestAcknowledgment, fallbackAcknowledgment, ACKNOWLEDGMENT_HARD_CAP_MS,
  FALLBACK_ACKNOWLEDGMENT, FALLBACK_ACKNOWLEDGMENT_AR,
} from '@/lib/swarm/unifiedOrchestrator';
import { route } from '@/lib/ai/router';
import { chatWithFallback } from '@/lib/ai/ai-provider';

const routeMock = vi.mocked(route);
const chatMock = vi.mocked(chatWithFallback);
const PROMISES = /summar|\bthen\b|after that|\bnext\b|report|follow[- ]?up|ملخص|تقرير|ثم|بعد ذلك/i;

beforeEach(() => {
  vi.useFakeTimers();
  routeMock.mockReset();
  chatMock.mockReset();
  routeMock.mockResolvedValue({ candidates: [{ provider: 'groq', model: 'm' }] } as never);
});
afterEach(() => vi.useRealTimers());

describe('the templates promise nothing', () => {
  it('English and Arabic templates say a mission is opening and that the actual steps and result will be posted — no summary/then/report', () => {
    expect(FALLBACK_ACKNOWLEDGMENT).toBe("Got it — I'm opening a mission for this. I'll post the actual steps and the result here.");
    expect(FALLBACK_ACKNOWLEDGMENT).not.toMatch(PROMISES);
    expect(FALLBACK_ACKNOWLEDGMENT_AR).not.toMatch(PROMISES);
    expect(/[؀-ۿ]/.test(FALLBACK_ACKNOWLEDGMENT_AR)).toBe(true);
    expect(fallbackAcknowledgment('search for a jarvis')).toBe(FALLBACK_ACKNOWLEDGMENT);
    expect(fallbackAcknowledgment('ابحث عن جارفيس')).toBe(FALLBACK_ACKNOWLEDGMENT_AR);
  });
});

describe('a model sentence is kept only when it promises nothing', () => {
  it('keeps one short plain sentence (the 2b-3 behaviour for a normal acknowledgment)', async () => {
    chatMock.mockResolvedValue({ content: '  On it — opening a mission to search for open source Jarvis projects.  ' } as never);
    expect(await generateFastAcknowledgment('search for a jarvis', 'tenant')).toBe('On it — opening a mission to search for open source Jarvis projects.');
  });

  it.each([
    'Sure — I will research the competitors and then prepare a summary for you.',
    "On it — I'll dig into the market, then write up a report.",
    'Got it, researching Jarvis projects and a summary will follow.',
    'Starting now. After that I will compile the findings.',
    "I'll prepare a deliverable with the results.",
  ])('replaces a sentence that promises a step or summary: %s', async (promise) => {
    chatMock.mockResolvedValue({ content: promise } as never);
    expect(await generateFastAcknowledgment('research the competitors of Acme', 'tenant')).toBe(FALLBACK_ACKNOWLEDGMENT);
  });

  it('replaces a multi-sentence or overlong reply', async () => {
    chatMock.mockResolvedValue({ content: 'Got it. I am opening a mission. It will take a while.' } as never);
    expect(await generateFastAcknowledgment('x', 'tenant')).toBe(FALLBACK_ACKNOWLEDGMENT);
    chatMock.mockResolvedValue({ content: 'On it — ' + 'opening a mission '.repeat(30) } as never);
    expect(await generateFastAcknowledgment('x', 'tenant')).toBe(FALLBACK_ACKNOWLEDGMENT);
  });

  it('an empty reply and a provider failure both give the template', async () => {
    chatMock.mockResolvedValue({ content: '   ' } as never);
    expect(await generateFastAcknowledgment('x', 'tenant')).toBe(FALLBACK_ACKNOWLEDGMENT);
    chatMock.mockRejectedValue(new Error('boom'));
    expect(await generateFastAcknowledgment('x', 'tenant')).toBe(FALLBACK_ACKNOWLEDGMENT);
  });
});

describe('Arabic requests', () => {
  it('a promising Arabic sentence is replaced by the Arabic template; an honest Arabic sentence is kept', async () => {
    chatMock.mockResolvedValue({ content: 'تمام — هبحث عن المنافسين وبعد كده هجهز ملخص لك.' } as never);
    expect(await generateFastAcknowledgment('ابحث عن منافسينا', 'tenant')).toBe(FALLBACK_ACKNOWLEDGMENT_AR);
    chatMock.mockResolvedValue({ content: 'تمام — بفتح ميشن للبحث عن المنافسين.' } as never);
    expect(await generateFastAcknowledgment('ابحث عن منافسينا', 'tenant')).toBe('تمام — بفتح ميشن للبحث عن المنافسين.');
  });

  it('the time cap resolves to the Arabic template for an Arabic request and to the English one otherwise', async () => {
    chatMock.mockImplementation(() => new Promise(() => {}));
    let ar: string | undefined;
    let en: string | undefined;
    void generateFastAcknowledgment('ابحث عن منافسينا', 'tenant').then((v) => { ar = v; });
    void generateFastAcknowledgment('search competitors', 'tenant').then((v) => { en = v; });
    await vi.advanceTimersByTimeAsync(ACKNOWLEDGMENT_HARD_CAP_MS + 100);
    expect(ar).toBe(FALLBACK_ACKNOWLEDGMENT_AR);
    expect(en).toBe(FALLBACK_ACKNOWLEDGMENT);
  });
});

describe('the model is told not to promise steps', () => {
  it('the system prompt forbids steps/summary/follow-up and no longer asks to "acknowledge specifically"', async () => {
    chatMock.mockResolvedValue({ content: 'On it.' } as never);
    await generateFastAcknowledgment('search for a jarvis', 'tenant');
    const prompt = (chatMock.mock.calls[0][1] as { systemPrompt: string }).systemPrompt;
    expect(prompt).toMatch(/plan does not exist yet/i);
    expect(prompt).toMatch(/do NOT mention, list or promise any step/i);
    expect(prompt).toMatch(/language of the request/i);
    expect(prompt).not.toMatch(/acknowledge specifically/i);
  });

  it('isHonestAcknowledgment pins the rule', () => {
    expect(isHonestAcknowledgment('Opening a mission for this now.')).toBe(true);
    expect(isHonestAcknowledgment('Opening a mission, then preparing a summary.')).toBe(false);
    expect(isHonestAcknowledgment('')).toBe(false);
    expect(isHonestAcknowledgment('Context matters here.')).toBe(true); // "next"/"then" are whole words only
  });
});
