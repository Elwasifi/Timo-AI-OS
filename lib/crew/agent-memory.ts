/**
 * AgentMemory — ephemeral per-agent conversation memory.
 * Tracks topics discussed, message counts, and a rolling summary.
 * This is an in-memory abstraction; future persistence would use Supabase.
 */

interface MemoryEntry {
  agentId: string;
  conversationCount: number;
  topics: string[];
  summary: string;
  lastInteraction: number;
}

export class AgentMemory {
  private memories = new Map<string, MemoryEntry>();

  init(agentId: string): MemoryEntry {
    const entry: MemoryEntry = {
      agentId,
      conversationCount: 0,
      topics: [],
      summary: '',
      lastInteraction: Date.now(),
    };
    this.memories.set(agentId, entry);
    return entry;
  }

  get(agentId: string): MemoryEntry | undefined {
    return this.memories.get(agentId);
  }

  recordInteraction(agentId: string, topic: string): void {
    const entry = this.memories.get(agentId);
    if (!entry) return;
    entry.conversationCount += 1;
    entry.lastInteraction = Date.now();
    if (topic && !entry.topics.includes(topic)) {
      entry.topics.push(topic);
      if (entry.topics.length > 10) entry.topics.shift();
    }
    entry.summary = `Discussed ${entry.topics.slice(-3).join(', ')} across ${entry.conversationCount} interactions.`;
  }

  getSummary(agentId: string): string {
    return this.memories.get(agentId)?.summary ?? '';
  }

  getTopics(agentId: string): string[] {
    return this.memories.get(agentId)?.topics ?? [];
  }

  clear(agentId: string): void {
    this.memories.delete(agentId);
  }
}
