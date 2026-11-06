// M7-13c-2b-1c (F): launchMission used to write progress = dispatched / total * 50, so a mission whose tasks were only
// ASSIGNED showed 50% with nothing finished. Progress must follow resolved / total (lib/swarm/missionOutcome.ts) only.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  updateMission: vi.fn(async (_id: string, _patch: Record<string, unknown>) => null),
  getFullMission: vi.fn(),
}));

const mission = { id: 'm-1', tenantId: 't-1', title: 'Jarvis', status: 'executing', progress: 0, metadata: {}, isSimulation: false };
const tasks = [
  { id: 'a', status: 'ready', title: 'A', errorMessage: null, result: null, assignedManager: 'nova', assignedWorker: null, retries: 0, objectiveId: 'o1' },
  { id: 'b', status: 'ready', title: 'B', errorMessage: null, result: null, assignedManager: 'echo', assignedWorker: null, retries: 0, objectiveId: 'o2' },
];

vi.mock('@/lib/swarm/missionService', () => ({
  createMission: vi.fn(async () => mission),
  updateMission: h.updateMission,
  createObjectives: vi.fn(async () => [{ id: 'o1', title: 'A', requiredCapability: 'x', dependencies: [] }, { id: 'o2', title: 'B', requiredCapability: 'y', dependencies: [] }]),
  createTasks: vi.fn(async () => tasks),
  getFullMission: h.getFullMission,
  getTasks: vi.fn(async () => tasks),
  updateTask: vi.fn(),
  updateObjective: vi.fn(),
  appendExecutionLog: vi.fn(),
  recordLesson: vi.fn(),
  claimMissionTerminalStatus: vi.fn(async () => true),
}));
vi.mock('@/lib/swarm/swarmManager', () => ({
  dispatchTasks: vi.fn(async (ts: Array<{ id: string }>) => ts.map((t) => ({ assignment: { task: t, assignedManager: { id: 'nova' } } }))),
}));
vi.mock('@/lib/governance/entitlements', () => ({
  checkEntitlement: vi.fn(async () => ({ allowed: true })),
  consumeProjectSlot: vi.fn(async () => {}),
  checkBudget: vi.fn(async () => ({ withinBudget: true, spendUsd: 0, limitUsd: null })),
}));
vi.mock('@/lib/swarm/missionTimeline', () => ({
  recordMissionCreated: vi.fn(async () => {}), recordMissionPlanned: vi.fn(async () => {}), recordObjectivesGenerated: vi.fn(async () => {}),
  recordTasksCreated: vi.fn(async () => {}), recordTaskStarted: vi.fn(async () => {}), recordTaskCompleted: vi.fn(async () => {}),
  recordTaskFailed: vi.fn(async () => {}), recordMissionCompleted: vi.fn(async () => {}), recordMissionFailed: vi.fn(async () => {}),
  recordMissionCancelled: vi.fn(async () => {}),
}));

import { launchMission, recalculateProgress } from '@/lib/swarm/missionEngine';

const patches = () => h.updateMission.mock.calls.map((c) => c[1]);

beforeEach(() => {
  h.updateMission.mockClear();
  h.getFullMission.mockReset();
  h.getFullMission.mockResolvedValue({ mission, objectives: [], tasks, timeline: [] });
});

describe('launchMission — progress', () => {
  it('writes NO progress value at dispatch (it used to write 50 for two assigned tasks)', async () => {
    const result = await launchMission({ userRequest: 'search for an open source code for a Jarvis AI Assistant', tenantId: 't-1' });
    expect(result && 'mission' in result).toBe(true);
    expect(patches().length).toBeGreaterThan(0); // the status updates still happen
    expect(patches().some((p) => 'progress' in p)).toBe(false);
  });
});

describe('recalculateProgress — resolved / total', () => {
  it('0 tasks resolved -> 0%', async () => {
    await recalculateProgress('m-1');
    expect(patches().at(-1)).toMatchObject({ progress: 0, status: 'executing' });
  });

  it('1 of 2 resolved -> 50%, 2 of 2 -> the terminal write', async () => {
    h.getFullMission.mockResolvedValue({ mission, objectives: [], tasks: [{ ...tasks[0], status: 'completed', result: { output: 'ok' } }, tasks[1]], timeline: [] });
    await recalculateProgress('m-1');
    expect(patches().at(-1)).toMatchObject({ progress: 50 });
  });
});
