// Knowledge Graph — creates relationships between memories.
// Everything can be linked: Temo → Project → Workflow → GitHub Repository → etc.

import { supabase } from '@/lib/supabase/client';
import type { MemoryLink, LinkType } from './types';

const TABLE = 'memory_links';

export const knowledgeGraph = {
  async link(input: {
    sourceId: string;
    targetId: string;
    linkType?: LinkType;
    weight?: number;
    metadata?: Record<string, unknown>;
  }): Promise<MemoryLink> {
    const { data, error } = await supabase.from(TABLE).insert({
      source_id: input.sourceId,
      target_id: input.targetId,
      link_type: input.linkType ?? 'relates_to',
      weight: input.weight ?? 1.0,
      metadata: input.metadata ?? {},
    }).select().single();
    if (error) throw new Error(`Link creation failed: ${error.message}`);
    return {
      id: data.id as string,
      sourceId: data.source_id as string,
      targetId: data.target_id as string,
      linkType: data.link_type as LinkType,
      weight: data.weight as number,
      metadata: (data.metadata as Record<string, unknown>) ?? {},
      createdAt: data.created_at as string,
    };
  },

  async unlink(sourceId: string, targetId: string): Promise<boolean> {
    const { error } = await supabase
      .from(TABLE)
      .delete()
      .eq('source_id', sourceId)
      .eq('target_id', targetId);
    if (error) throw new Error(`Link removal failed: ${error.message}`);
    return true;
  },

  async getLinks(memoryId: string): Promise<MemoryLink[]> {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .or(`source_id.eq.${memoryId},target_id.eq.${memoryId}`)
      .order('created_at', { ascending: false });
    if (error) throw new Error(`Link fetch failed: ${error.message}`);
    return (data as Array<Record<string, unknown>>)?.map((row) => ({
      id: row.id as string,
      sourceId: row.source_id as string,
      targetId: row.target_id as string,
      linkType: row.link_type as LinkType,
      weight: row.weight as number,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      createdAt: row.created_at as string,
    })) ?? [];
  },

  async getNeighbors(memoryId: string, depth = 1): Promise<string[]> {
    // BFS up to `depth` levels
    const visited = new Set<string>([memoryId]);
    let frontier = [memoryId];
    for (let d = 0; d < depth; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        const links = await this.getLinks(id);
        for (const link of links) {
          const neighbor = link.sourceId === id ? link.targetId : link.sourceId;
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            next.push(neighbor);
          }
        }
      }
      frontier = next;
    }
    return Array.from(visited).filter((id) => id !== memoryId);
  },

  async deleteAllLinks(memoryId: string): Promise<boolean> {
    const { error } = await supabase
      .from(TABLE)
      .delete()
      .or(`source_id.eq.${memoryId},target_id.eq.${memoryId}`);
    if (error) throw new Error(`Link cleanup failed: ${error.message}`);
    return true;
  },
};
