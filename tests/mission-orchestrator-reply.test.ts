// M7-13c-2b-1: what the orchestrator does after the tasks have run.
//   - it does NOT decide the mission's status (recalculateProgress does, once): no updateMission call, and the
//     runtime execution state is derived from the outcome;
//   - the chat reply is the BRIEF report built from the outcome (observed bug: 0 of 2 succeeded was announced as
//     "completed with partial results");
//   - the final reply is persisted to the conversation, fire-and-forget: a failure there never fails the mission.
// Real orchestrate() + real outcome/message builders; everything around them is stubbed (no network).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  conversationId: 'conv-1' as string | null,
  dbMission: null as Record<string, any> | null,
  dbTasks: [] as Array<Record<string, any>>,
  executionResults: [] as Array<Record<string, any>>,
  addMessage: vi.fn(async (..._a: unknown[]) => undefined as unknown),
  updateMission: vi.fn(async () => null),
  runtimeStates: [] as Array<Record<string, any>>,
}));

vi.mock('@/lib/swarm/decisionEngine', () => ({
  makeDecision: vi.fn(() => ({ pipeline: 'mission', confidence: 0.9, reason: 'multi-step', signals: [], estimatedComplexity: 'medium' })),
}));
vi.mock('@/lib/swarm/missionEngine', () => ({
  launchMission: vi.fn(async () => ({
    mission: { id: 'm-1', title: 'Find a Jarvis', objective: 'o', status: 'executing', estimatedComplexity: 'medium', priority: 'medium', tenantId: 't' },
    objectives: [],
    tasks: [
      { id: 'a', title: 'Optimize for search engines', status: 'ready', result: null, errorMessage: null, assignedManager: 'nova', assignedWorker: null, retries: 0 },
      { id: 'b', title: 'Review code quality', status: 'ready', result: null, errorMessage: null, assignedManager: 'nova', assignedWorker: null, retries: 0 },
    ],
  })),
}));
vi.mock('@/lib/swarm/executionLayer', () => ({ executeMissionTasks: vi.fn(async () => h.executionResults) }));
vi.mock('@/lib/swarm/missionService', () => ({
  getFullMission: vi.fn(async () => ({ mission: h.dbMission, tasks: h.dbTasks, objectives: [] })),
  getTimeline: vi.fn(async () => []),
  updateMission: h.updateMission,
}));
vi.mock('@/lib/swarm/missionTimeline', () => ({ recordEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/swarm/runtimeStore', () => ({
  updateRuntimeState: vi.fn(async (patch: Record<string, any>) => { h.runtimeStates.push(patch); }),
  emitRuntimeEvent: vi.fn(async () => {}),
}));
vi.mock('@/lib/ai/router', () => ({ route: vi.fn(), classifyTask: vi.fn(() => ({})) }));
vi.mock('@/lib/ai/ai-provider', () => ({ chatWithFallback: vi.fn() }));
vi.mock('@/lib/crew/crew-coordinator', () => ({ crewCoordinator: { getConversationId: vi.fn(() => h.conversationId) } }));
vi.mock('@/lib/ai/conversation-service', () => ({ ConversationService: { addMessage: (...a: unknown[]) => h.addMessage(...a) } }));

import { orchestrate } from '@/lib/swarm/unifiedOrchestrator';

const QUOTA = "Gemini's request limit for models gemini-flash-lite-latest and gemini-3.6-flash was reached on this workspace's API key. Try again later, pin another model in Settings → AI Providers, or enable billing in Google AI Studio.";
const failedTask = (id: string, title: string) => ({ id, title, status: 'failed', errorMessage: QUOTA, result: { failure: { kind: 'quota_exceeded', deterministic: true, attempts: 1 }, agent: { manager: 'nova', worker: 'nova-frontend' } }, assignedManager: 'nova', assignedWorker: 'nova-frontend', retries: 0 });
const doneTask = (id: string, title: string, output: string) => ({ id, title, status: 'completed', errorMessage: null, result: { output, tools: ['web.search'], steps: [{ step: 'Tool Execution', status: 'completed', detail: '' }], agent: { manager: 'nova', worker: 'nova-frontend' } }, assignedManager: 'nova', assignedWorker: 'nova-frontend', retries: 0, startedAt: '2026-11-03T10:00:00Z', completedAt: '2026-11-03T10:00:05Z' });

const run = () => orchestrate('search for an open source Jarvis and optimise it', { tenantId: 't', announce: false });
const assistantReplies = () => h.addMessage.mock.calls.filter((c) => c[1] === 'assistant' && c[3] === 'temo' && !String(c[2]).startsWith('Mission started'));
const finalRuntimeState = () => [...h.runtimeStates].reverse().find((p) => Array.isArray(p.runningTaskIds) && p.runningTaskIds.length === 0)!;

beforeEach(() => {
  h.conversationId = 'conv-1';
  h.dbMission = { id: 'm-1', status: 'failed' };
  h.dbTasks = [failedTask('a', 'Optimize for search engines'), failedTask('b', 'Review code quality')];
  h.executionResults = [];
  h.addMessage.mockReset(); h.addMessage.mockResolvedValue(undefined);
  h.updateMission.mockClear();
  h.runtimeStates.length = 0;
});

describe('the reply is the BRIEF report of the outcome', () => {
  it('THE OBSERVED CASE: 0 of 2 succeeded -> "Mission failed: 0 of 2 tasks succeeded", each reason, never "partial results"', async () => {
    const r = await run();
    expect(r.response).toContain('## Mission: Find a Jarvis');
    expect(r.response).toContain('Mission failed: 0 of 2 tasks succeeded.');
    expect(r.response).toContain(`- Optimize for search engines: ${QUOTA}`);
    expect(r.response).toContain(`- Review code quality: ${QUOTA}`);
    expect(r.response).not.toMatch(/partial|completed with/i);
  });

  it('it is BRIEF: no agent names, workers, tool ids or step names', async () => {
    h.dbMission = { id: 'm-1', status: 'completed' };
    h.dbTasks = [doneTask('a', 'Optimize for search engines', 'Use semantic HTML.'), failedTask('b', 'Review code quality')];
    const r = await run();
    for (const hidden of ['nova', 'nova-frontend', 'web.search', 'Tool Execution', 'Executed by']) expect(r.response).not.toContain(hidden);
    expect(r.response).toContain('Mission partially done: 1 of 2 tasks succeeded.');
    expect(r.response).toContain('Use semantic HTML.');
  });

  it('if the mission cannot be read back, the outcome is built from this run\'s own results', async () => {
    h.dbMission = null;
    h.executionResults = [
      { taskId: 'a', status: 'failed', error: 'No matching tool could be planned or matched for this request.', result: {}, managerId: 'nova', workerId: null, retries: 0 },
      { taskId: 'b', status: 'failed', error: 'No matching tool could be planned or matched for this request.', result: {}, managerId: 'nova', workerId: null, retries: 0 },
    ];
    const r = await run();
    expect(r.response).toContain('Mission failed: 0 of 2 tasks succeeded.');
    expect(r.response).toContain('No matching tool could be planned or matched for this request.');
  });
});

describe('the orchestrator no longer decides the mission status', () => {
  it('never writes the mission row itself (recalculateProgress is the single writer)', async () => {
    await run();
    h.dbMission = { id: 'm-1', status: 'completed' };
    h.dbTasks = [doneTask('a', 'A', 'ok'), doneTask('b', 'B', 'ok')];
    await run();
    expect(h.updateMission).not.toHaveBeenCalled();
  });

  it.each([
    ['failed', () => [failedTask('a', 'A'), failedTask('b', 'B')], 'failed', 100],
    ['partial', () => [doneTask('a', 'A', 'ok'), failedTask('b', 'B')], 'completed', 100],
    ['completed', () => [doneTask('a', 'A', 'ok'), doneTask('b', 'B', 'ok')], 'completed', 100],
    ['in progress', () => [doneTask('a', 'A', 'ok'), { ...doneTask('b', 'B', ''), status: 'awaiting_approval', result: null }], 'executing', 50],
  ])('runtime execution state is derived from the outcome: %s', async (_label, make, state, progress) => {
    h.dbTasks = make();
    await run();
    const s = finalRuntimeState();
    expect(s.executionState).toBe(state);
    expect(s.missionProgress).toBe(progress);
  });
});

describe('the final reply is persisted to the conversation', () => {
  it('addMessage(conversationId, "assistant", <the BRIEF response>, "temo") is called once with exactly the reply', async () => {
    const r = await run();
    const replies = assistantReplies();
    expect(replies).toHaveLength(1);
    expect(replies[0]).toEqual(['conv-1', 'assistant', r.response, 'temo']);
  });

  it('a rejected addMessage does not fail the mission — the reply is still returned', async () => {
    h.addMessage.mockImplementation(async (...a: unknown[]) => { if (a[1] === 'assistant' && !String(a[2]).startsWith('Mission started')) throw new Error('db down'); });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await run();
    expect(r.response).toContain('Mission failed: 0 of 2 tasks succeeded.');
    expect(r.missionId).toBe('m-1');
    await Promise.resolve();
    expect(errors.mock.calls.some((c) => String(c[0]).includes('persist mission reply'))).toBe(true);
    errors.mockRestore();
  });

  it('an addMessage that throws SYNCHRONOUSLY does not fail the mission either', async () => {
    h.addMessage.mockImplementation((...a: unknown[]) => { if (a[1] === 'assistant' && !String(a[2]).startsWith('Mission started')) throw new Error('boom'); return Promise.resolve(); });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await run();
    expect(r.response).toContain('Mission failed');
    expect(r.missionId).toBe('m-1');
    errors.mockRestore();
  });

  it('with no conversation id nothing is persisted', async () => {
    h.conversationId = null;
    const r = await run();
    expect(r.response).toContain('Mission failed');
    expect(h.addMessage).not.toHaveBeenCalled();
  });
});
