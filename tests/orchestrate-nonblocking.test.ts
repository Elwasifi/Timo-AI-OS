// M7-13g (a) + (c): orchestrate()'s runtime bookkeeping writes (runtime_activity
// events, the runtime_state row) must never gate routing or the reply, must keep
// their relative order, and a failing write must only warn — no unhandled
// rejection. The real orchestrate() runs; only its collaborators are stubbed.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/swarm/decisionEngine', () => ({
  makeDecision: () => ({ pipeline: 'simple', reason: 'test', confidence: 1, signals: [], estimatedComplexity: 'low' }),
}));
vi.mock('@/lib/swarm/missionEngine', () => ({ launchMission: vi.fn() }));
vi.mock('@/lib/swarm/executionLayer', () => ({ executeMissionTasks: vi.fn() }));
vi.mock('@/lib/swarm/missionService', () => ({ updateMission: vi.fn(), getTimeline: vi.fn() }));
vi.mock('@/lib/swarm/missionTimeline', () => ({ recordEvent: vi.fn() }));
vi.mock('@/lib/swarm/runtimeStore', () => ({
  emitRuntimeEvent: vi.fn(),
  updateRuntimeState: vi.fn(),
}));
vi.mock('@/lib/ai/router', () => ({ route: vi.fn(), classifyTask: vi.fn() }));
vi.mock('@/lib/ai/ai-provider', () => ({ chatWithFallback: vi.fn() }));
vi.mock('@/lib/ai/conversation-service', () => ({ ConversationService: {} }));
vi.mock('@/lib/crew/crew-coordinator', () => ({
  crewCoordinator: {
    getConversationId: vi.fn(() => 'conv'),
    routeAndRespond: vi.fn(async () => ({
      routing: { selectedAgentId: 'temo', selectedAgentName: 'Temo', confidence: 1 },
      response: 'Hello!',
      task: { id: 'task-1' },
    })),
  },
}));

import { orchestrate } from '@/lib/swarm/unifiedOrchestrator';
import { emitRuntimeEvent, updateRuntimeState } from '@/lib/swarm/runtimeStore';
import { crewCoordinator } from '@/lib/crew/crew-coordinator';

const emit = vi.mocked(emitRuntimeEvent);
const setState = vi.mocked(updateRuntimeState);
const routeAndRespond = vi.mocked(crewCoordinator.routeAndRespond);

beforeEach(() => {
  emit.mockReset();
  setState.mockReset();
  routeAndRespond.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('orchestrate() — runtime writes are non-blocking', () => {
  it('writes that NEVER resolve do not delay routeAndRespond or the reply (no timer advance needed)', async () => {
    vi.useFakeTimers();
    emit.mockImplementation(() => new Promise(() => {}));
    setState.mockImplementation(() => new Promise(() => {}));

    const p = orchestrate('Hi', { tenantId: 't' });
    let done = false;
    void p.then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(0);       // microtasks only — zero simulated time

    expect(routeAndRespond).toHaveBeenCalledTimes(1);
    expect(done).toBe(true);                     // the reply came back while every write is still pending
    expect((await p).response).toBe('Hello!');
  });

  it('relative order is preserved: nothing starts behind a slow first write, then the chain drains in order', async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    let releaseFirst!: () => void;
    emit.mockImplementation(((e: { eventType: string }) => {
      calls.push(`event:${e.eventType}`);
      return calls.length === 1 ? new Promise<void>((resolve) => { releaseFirst = resolve; }) : Promise.resolve();
    }) as never);
    setState.mockImplementation(((patch: { executionState?: string }) => {
      calls.push(`state:${patch.executionState}`);
      return Promise.resolve(null);
    }) as never);

    await orchestrate('Hi', { tenantId: 't' });
    expect(calls).toEqual(['event:thinking']);   // the rest are queued strictly behind the stuck first write

    releaseFirst();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([
      'event:thinking',
      'event:routing',
      'state:routing',
      'state:completed',
      'event:synthesizing',
      'event:speaking',
      'event:completed',
    ]);
  });
});

describe('orchestrate() — a failing runtime write only warns', () => {
  it('a REJECTING write logs a warning, the reply is unaffected, and there is no unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    emit.mockRejectedValue(new Error('boom: REST timeout'));
    setState.mockRejectedValue(new Error('state boom'));

    try {
      const result = await orchestrate('Hi', { tenantId: 't' });
      expect(result.response).toBe('Hello!');

      await new Promise((resolve) => setTimeout(resolve, 30));   // real macrotask turns: let the chain drain and any unhandled rejection surface
      const messages = warn.mock.calls.map((c) => String(c[2]));
      expect(messages.some((m) => m.includes('runtime write failed (event:thinking)') && m.includes('boom: REST timeout'))).toBe(true);
      expect(messages.some((m) => m.includes('runtime write failed (state:routing)') && m.includes('state boom'))).toBe(true);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
