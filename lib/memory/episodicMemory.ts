// Episodic Memory — remembers important events as timeline entries.
// Events like: user imported workflow, created project, generated code,
// connected GitHub, completed task.

import { supabase } from '@/lib/supabase/client';
import { memoryStore } from './memoryStore';
import type { EpisodicEvent, MemoryRecord } from './types';

const TABLE = 'memory_events';

export const episodicMemory = {
  async record(input: {
    eventType: string;
    eventTitle: string;
    eventDetail?: string;
    agent?: string;
    project?: string;
    severity?: 'info' | 'warning' | 'error' | 'success';
    metadata?: Record<string, unknown>;
    memoryId?: string;
  }): Promise<EpisodicEvent> {
    const { data, error } = await supabase.from(TABLE).insert({
      memory_id: input.memoryId ?? null,
      event_type: input.eventType,
      event_title: input.eventTitle,
      event_detail: input.eventDetail ?? null,
      agent: input.agent ?? null,
      project: input.project ?? null,
      severity: input.severity ?? 'info',
      metadata: input.metadata ?? {},
    }).select().single();
    if (error) throw new Error(`Episodic record failed: ${error.message}`);
    return data as EpisodicEvent;
  },

  async recordWithMemory(input: {
    eventType: string;
    eventTitle: string;
    eventDetail?: string;
    content?: string;
    agent?: string;
    project?: string;
    severity?: 'info' | 'warning' | 'error' | 'success';
    tags?: string[];
    tenantId?: string | null;
  }): Promise<{ memory: MemoryRecord; event: EpisodicEvent }> {
    const memory = await memoryStore.store({
      type: 'episodic',
      title: input.eventTitle,
      content: input.content ?? input.eventDetail ?? input.eventTitle,
      tags: input.tags ?? ['episodic', input.eventType],
      importance: 'medium',
      source: 'event',
      agent: input.agent,
      project: input.project,
      tenantId: input.tenantId,
    });

    const event = await this.record({
      eventType: input.eventType,
      eventTitle: input.eventTitle,
      eventDetail: input.eventDetail,
      agent: input.agent,
      project: input.project,
      severity: input.severity,
      memoryId: memory.id,
    });

    return { memory, event };
  },

  async timeline(opts?: {
    agent?: string;
    project?: string;
    eventType?: string;
    limit?: number;
  }): Promise<EpisodicEvent[]> {
    let q = supabase.from(TABLE).select('*').order('created_at', { ascending: false });
    if (opts?.agent) q = q.eq('agent', opts.agent);
    if (opts?.project) q = q.eq('project', opts.project);
    if (opts?.eventType) q = q.eq('event_type', opts.eventType);
    q = q.limit(opts?.limit ?? 50);
    const { data, error } = await q;
    if (error) throw new Error(`Timeline fetch failed: ${error.message}`);
    return (data as EpisodicEvent[]) ?? [];
  },

  async deleteEvent(id: string): Promise<boolean> {
    const { error } = await supabase.from(TABLE).delete().eq('id', id);
    if (error) throw new Error(`Event delete failed: ${error.message}`);
    return true;
  },
};
