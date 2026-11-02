// M7-13c-1: the mission acknowledgment must resolve within ~5s no matter what
// the router or providers do, must never reject, and must ask for enough tokens
// that a reasoning model cannot spend the whole budget on hidden reasoning.
// (It was already fire-and-forget; this only bounds and hardens it.)

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

import { generateFastAcknowledgment, ACKNOWLEDGMENT_HARD_CAP_MS } from '@/lib/swarm/unifiedOrchestrator';
import { route } from '@/lib/ai/router';
import { chatWithFallback } from '@/lib/ai/ai-provider';

const routeMock = vi.mocked(route);
const chatMock = vi.mocked(chatWithFallback);
const FALLBACK_START = 'Got it';

beforeEach(() => {
  vi.useFakeTimers();
  routeMock.mockReset();
  chatMock.mockReset();
  routeMock.mockResolvedValue({ candidates: [{ provider: 'groq', model: 'm' }] } as never);
});
afterEach(() => vi.useRealTimers());

describe('generateFastAcknowledgment', () => {
  it('returns the model sentence when it answers in time, asking for 256 tokens under the fast_acknowledgment operation', async () => {
    chatMock.mockResolvedValue({ content: '  On it — searching for open source Jarvis projects.  ' } as never);
    const text = await generateFastAcknowledgment('search for a jarvis', 'tenant');
    expect(text).toBe('On it — searching for open source Jarvis projects.');
    const opts = chatMock.mock.calls[0][1] as Record<string, unknown> & { usageContext: { operation: string } };
    expect(opts.maxTokens).toBe(256);
    expect(opts.usageContext.operation).toBe('fast_acknowledgment');
    expect('reasoning_effort' in opts).toBe(false);
  });

  it('a provider call that never settles resolves to the static fallback at ~5s (not before 4.9s), never rejecting', async () => {
    chatMock.mockImplementation(() => new Promise(() => {}));
    let out: string | undefined;
    void generateFastAcknowledgment('search for a jarvis', 'tenant').then((v) => { out = v; });
    await vi.advanceTimersByTimeAsync(ACKNOWLEDGMENT_HARD_CAP_MS - 100);
    expect(out).toBeUndefined();
    await vi.advanceTimersByTimeAsync(200);
    expect(out?.startsWith(FALLBACK_START)).toBe(true);
    expect(ACKNOWLEDGMENT_HARD_CAP_MS).toBe(5_000);
  });

  it('a router read that never settles is covered by the same cap', async () => {
    routeMock.mockImplementation(() => new Promise(() => {}));
    let out: string | undefined;
    void generateFastAcknowledgment('search for a jarvis', 'tenant').then((v) => { out = v; });
    await vi.advanceTimersByTimeAsync(5_100);
    expect(out?.startsWith(FALLBACK_START)).toBe(true);
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('a failing provider chain resolves to the fallback immediately, and an empty sentence also falls back', async () => {
    chatMock.mockRejectedValueOnce(new Error('AI request failed: 503'));
    expect((await generateFastAcknowledgment('x', 'tenant')).startsWith(FALLBACK_START)).toBe(true);
    chatMock.mockResolvedValueOnce({ content: '   ' } as never);
    expect((await generateFastAcknowledgment('x', 'tenant')).startsWith(FALLBACK_START)).toBe(true);
  });

  it('a late failure of the abandoned attempt (after the cap won) does not become an unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const on = (r: unknown) => { unhandled.push(r); };
    process.on('unhandledRejection', on);
    let rejectLate: (e: Error) => void = () => {};
    chatMock.mockImplementation(() => new Promise((_, rej) => { rejectLate = rej; }));
    const p = generateFastAcknowledgment('x', 'tenant');
    await vi.advanceTimersByTimeAsync(5_100);
    expect((await p).startsWith(FALLBACK_START)).toBe(true);
    rejectLate(new Error('too late'));
    vi.useRealTimers();
    await new Promise((r) => setTimeout(r, 30));
    process.off('unhandledRejection', on);
    expect(unhandled).toEqual([]);
  });
});
