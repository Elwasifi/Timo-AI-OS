// M1-07: mission lifecycle happy path — the status/progress rollup that a
// real M1-01-era session bug once left permanently stuck at 'executing'
// even after every task resolved. Exercises recalculateProgress() (the
// real fix) against a real mission/tasks in the database, without
// depending on a live AI provider call (which would make this test slow
// and flaky) — tasks are moved to terminal states directly, exactly as
// executeTask() would have left them.

import { describe, it, expect, afterAll } from 'vitest';
import { recalculateProgress } from '@/lib/swarm/missionEngine';
import { INTERNAL_TENANT_ID, serviceRoleClient } from './helpers';

describe('mission lifecycle happy path', () => {
  let missionId: string;

  afterAll(async () => {
    if (!missionId) return;
    const svc = serviceRoleClient();
    await svc.from('mission_timeline').delete().eq('mission_id', missionId);
    await svc.from('mission_tasks').delete().eq('mission_id', missionId);
    await svc.from('missions').delete().eq('id', missionId);
  });

  it('rolls a mission up to completed once every task resolves', async () => {
    const svc = serviceRoleClient();

    const { data: mission, error: missionErr } = await svc
      .from('missions')
      .insert({
        title: '[M1-07 TEST] mission lifecycle happy path',
        objective: 'test', user_request: 'test', status: 'executing',
        estimated_complexity: 'simple', estimated_tasks: 2,
        tenant_id: INTERNAL_TENANT_ID, is_simulation: false,
      })
      .select().single();
    expect(missionErr).toBeNull();
    missionId = mission!.id;

    const { data: tasks, error: tasksErr } = await svc
      .from('mission_tasks')
      .insert([
        { mission_id: missionId, required_capability: 'general', title: 'Task 1', status: 'ready' },
        { mission_id: missionId, required_capability: 'general', title: 'Task 2', status: 'ready' },
      ])
      .select();
    expect(tasksErr).toBeNull();
    expect(tasks).toHaveLength(2);

    // Sanity: before any task resolves, the mission should still read as non-terminal.
    await recalculateProgress(missionId);
    let current = await svc.from('missions').select('status, progress').eq('id', missionId).single();
    expect(current.data?.status).not.toBe('completed');

    // Simulate executeTask() having completed both tasks for real.
    for (const t of tasks!) {
      await svc.from('mission_tasks').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', t.id);
    }

    await recalculateProgress(missionId);
    current = await svc.from('missions').select('status, progress').eq('id', missionId).single();
    expect(current.data?.status).toBe('completed');
    expect(current.data?.progress).toBe(100);

    // recalculateProgress() should have recorded a real mission_completed timeline event.
    const { data: timeline } = await svc
      .from('mission_timeline')
      .select('event_type')
      .eq('mission_id', missionId)
      .eq('event_type', 'mission_completed');
    expect(timeline?.length ?? 0).toBeGreaterThan(0);
  });
});
