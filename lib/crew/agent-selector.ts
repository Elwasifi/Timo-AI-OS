import type { Agent } from '@/types';

/**
 * AgentSelector — chooses which specialist should handle a given user input.
 * Temo coordinates: if the user is talking to Temo, it routes to the best
 * specialist based on keyword matching against agent skills and capabilities.
 */

type ScoredAgent = { agent: Agent; score: number };

const KEYWORD_MAP: Record<string, string[]> = {
  nova: ['code', 'programming', 'debug', 'architecture', 'api', 'database', 'cloud', 'function', 'typescript', 'javascript', 'python', 'react', 'server', 'deploy', 'bug'],
  flow: ['workflow', 'automate', 'n8n', 'make', 'zapier', 'webhook', 'integration', 'trigger', 'schedule', 'pipeline', 'connect'],
  atlas: ['business', 'marketing', 'sales', 'pricing', 'growth', 'analytics', 'strategy', 'revenue', 'competitor', 'market', 'plan'],
  luna: ['design', 'ui', 'ux', 'branding', 'graphics', 'presentation', 'motion', 'logo', 'color', 'layout', 'prototype', 'figma'],
  echo: ['content', 'writing', 'seo', 'youtube', 'social', 'copywriting', 'email', 'blog', 'post', 'article', 'viral', 'headline'],
};

export class AgentSelector {
  /**
   * Given user text, return the best-matching specialist agent id.
   * Falls back to 'temo' when no specialist clearly matches.
   */
  select(input: string, agents: Agent[]): string {
    const lower = input.toLowerCase();
    const scored: ScoredAgent[] = [];

    for (const agent of agents) {
      if (agent.id === 'temo') continue;
      const keywords = KEYWORD_MAP[agent.id] ?? [];
      let score = 0;
      for (const kw of keywords) {
        if (lower.includes(kw)) score += 1;
      }
      if (agent.skills.some((s) => lower.includes(s.toLowerCase()))) score += 0.5;
      if (score > 0) scored.push({ agent, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.agent.id ?? 'temo';
  }

  /**
   * Return the full routing decision with explanation for Temo's coordination.
   */
  route(input: string, agents: Agent[]): { specialistId: string; specialistName: string; reason: string } {
    const id = this.select(input, agents);
    if (id === 'temo') {
      return { specialistId: 'temo', specialistName: 'Temo', reason: 'general coordination' };
    }
    const agent = agents.find((a) => a.id === id);
    return {
      specialistId: id,
      specialistName: agent?.name ?? 'Temo',
      reason: `matched ${agent?.role ?? 'specialist'} expertise`,
    };
  }
}
