// Summarizer — uses the AI provider to summarize, merge, and assess the
// importance of memories. This powers the auto-summarize and auto-remember
// features of the memory engine.

import { chatWithFallback, type ChatMessage } from '@/lib/ai/ai-provider';
import { route, type RoutingDecision } from '@/lib/ai/router';
import { memoryStore } from './memoryStore';
import { loadMemorySettings } from './memorySettings';
import type { MemoryImportance, MemoryRecord } from './types';
import { IMPORTANCE_FROM_SCORE } from './types';

// These are tiny, cheap utility calls (summarize/rate/classify, 5-150 max
// tokens) — genuinely SMALL_TASK candidates, not a reason to reach for the
// strongest configured model every time a memory gets stored. Built
// directly rather than via classifyTask()'s general heuristics, since
// those infer task type from message length/content — these calls are
// always small regardless of how long the memory being summarized is.
async function smallTaskDecision(): Promise<RoutingDecision> {
  return route({
    classification: {
      taskType: 'SMALL_TASK',
      complexity: 'simple',
      urgency: 'low',
      expectedContextSize: 'small',
      needsTools: false,
      needsReasoning: false,
      needsStructuredOutput: false,
      needsVision: false,
      latencySensitivity: 'high',
      costSensitivity: 'high',
      reliabilityRequirement: 'normal',
    },
    tenantId: null,
  });
}

export const summarizer = {
  async summarizeMemory(content: string): Promise<string> {
    const settings = await loadMemorySettings();
    if (!settings.auto_summarize) return '';

    try {
      const messages: ChatMessage[] = [
        {
          role: 'user',
          content: `Summarize the following memory content in 1-2 concise sentences. Focus on the key facts and decisions.\n\n${content}`,
        },
      ];
      const decision = await smallTaskDecision();
      const result = await chatWithFallback(messages, {
        systemPrompt: 'You are a memory summarizer. Produce concise, factual summaries.',
        temperature: 0.3,
        maxTokens: 150,
        candidates: decision.candidates,
        usageContext: {
          operation: 'memory_summarize',
          tenantId: null,
          metadata: { taskType: decision.taskType, routingMode: decision.mode },
        },
      });
      return result.content.trim();
    } catch {
      return '';
    }
  },

  async assessImportance(content: string, title: string): Promise<{ importance: MemoryImportance; score: number }> {
    try {
      const messages: ChatMessage[] = [
        {
          role: 'user',
          content: `Rate the importance of this memory on a scale of 0-100 (100=critical, 80=high, 50=medium, 25=low, 10=temporary). Reply with ONLY the number.\n\nTitle: ${title}\nContent: ${content.slice(0, 500)}`,
        },
      ];
      const decision = await smallTaskDecision();
      const result = await chatWithFallback(messages, {
        systemPrompt: 'You are a memory importance assessor. Reply with only a number 0-100.',
        temperature: 0.1,
        maxTokens: 10,
        candidates: decision.candidates,
        usageContext: {
          operation: 'memory_importance_assessment',
          tenantId: null,
          metadata: { taskType: decision.taskType, routingMode: decision.mode },
        },
      });
      const score = Math.max(0, Math.min(100, parseInt(result.content.trim(), 10) || 50));
      return { importance: IMPORTANCE_FROM_SCORE(score), score };
    } catch {
      return { importance: 'medium', score: 50 };
    }
  },

  async shouldRemember(content: string, title: string): Promise<boolean> {
    const settings = await loadMemorySettings();
    if (!settings.auto_remember) return false;

    // Simple heuristics: always remember critical/high importance signals
    const criticalKeywords = ['important', 'decision', 'preference', 'configuration', 'api key', 'project name', 'goal', 'milestone'];
    const lowerContent = (content + ' ' + title).toLowerCase();
    if (criticalKeywords.some((kw) => lowerContent.includes(kw))) return true;

    // Use AI to decide for ambiguous content
    try {
      const messages: ChatMessage[] = [
        {
          role: 'user',
          content: `Should this information be stored as a long-term memory? Reply with ONLY "yes" or "no".\n\nTitle: ${title}\nContent: ${content.slice(0, 300)}`,
        },
      ];
      const decision = await smallTaskDecision();
      const result = await chatWithFallback(messages, {
        systemPrompt: 'You decide if information is worth remembering long-term. Reply with only "yes" or "no".',
        temperature: 0.1,
        maxTokens: 5,
        candidates: decision.candidates,
        usageContext: {
          operation: 'memory_should_remember',
          tenantId: null,
          metadata: { taskType: decision.taskType, routingMode: decision.mode },
        },
      });
      return result.content.trim().toLowerCase().startsWith('yes');
    } catch {
      return true; // Default to remembering on AI failure
    }
  },

  async mergeMemories(memoryIds: string[]): Promise<MemoryRecord | null> {
    if (memoryIds.length < 2) return null;
    const memories: MemoryRecord[] = [];
    for (const id of memoryIds) {
      const m = await memoryStore.getById(id);
      if (m) memories.push(m);
    }
    if (memories.length < 2) return null;

    const combinedContent = memories.map((m) => `${m.title}: ${m.content}`).join('\n\n');
    const summary = await this.summarizeMemory(combinedContent);
    const title = `Merged: ${memories.map((m) => m.title).join(' + ')}`;

    const merged = await memoryStore.store({
      type: memories[0].type,
      title,
      content: combinedContent,
      summary,
      tags: Array.from(new Set(memories.flatMap((m) => m.tags))),
      importance: 'high',
      source: 'merge',
      agent: memories[0].agent ?? undefined,
      project: memories[0].project ?? undefined,
    });

    // Soft-delete the originals
    for (const id of memoryIds) {
      await memoryStore.softDelete(id);
    }

    return merged;
  },
};
