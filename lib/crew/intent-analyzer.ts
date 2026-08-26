import type { Intent, TaskCategory } from '@/types';

/**
 * IntentAnalyzer — pluggable interface for analyzing user input.
 *
 * The current implementation is a mock keyword-based analyzer. This interface
 * is designed so a real LLM-backed analyzer (Gemini, OpenAI, Claude) can be
 * dropped in without changing any routing architecture — only the analyze()
 * implementation changes.
 */

export interface IntentAnalyzer {
  analyze(input: string): Promise<Intent>;
}

// ---- Mock Implementation (keyword + heuristic based) ----

const CATEGORY_KEYWORDS: Record<Exclude<TaskCategory, 'general' | 'clarification'>, string[]> = {
  code: [
    'code', 'programming', 'debug', 'bug', 'function', 'typescript', 'javascript',
    'python', 'react', 'api', 'rest', 'graphql', 'database', 'sql', 'server',
    'deploy', 'architecture', 'component', 'class', 'interface', 'type', 'compile',
    'build', 'test', 'unit test', 'refactor', 'algorithm', 'data structure',
    'endpoint', 'middleware', 'backend', 'frontend', 'fullstack', 'devops',
    'docker', 'kubernetes', 'ci/cd', 'pipeline', 'git', 'npm', 'package',
  ],
  workflow: [
    'workflow', 'automate', 'automation', 'n8n', 'make', 'zapier', 'webhook',
    'integration', 'trigger', 'schedule', 'pipeline', 'connect', 'sync',
    'ifttt', 'integromat', 'flow', 'event', 'cron', 'queue', 'retry',
    'webhooks', 'api gateway', 'orchestrate',
  ],
  business: [
    'business', 'marketing', 'sales', 'pricing', 'growth', 'analytics',
    'strategy', 'revenue', 'competitor', 'market', 'plan', 'roi', 'kpi',
    'metric', 'conversion', 'funnel', 'customer', 'segment', 'positioning',
    'brand strategy', 'go-to-market', 'gtm', 'launch', 'monetize', 'profit',
    'cost', 'budget', 'forecast', 'demand', 'supply', 'b2b', 'b2c', 'saas',
  ],
  design: [
    'design', 'ui', 'ux', 'branding', 'brand', 'graphics', 'presentation',
    'motion', 'logo', 'color', 'colour', 'layout', 'prototype', 'figma',
    'sketch', 'wireframe', 'mockup', 'interface', 'user experience',
    'user interface', 'visual', 'aesthetic', 'typography', 'font', 'spacing',
    'design system', 'component library', 'icon', 'illustration', 'animation',
  ],
  content: [
    'content', 'writing', 'write', 'seo', 'youtube', 'social', 'social media',
    'copywriting', 'copy', 'email', 'blog', 'post', 'article', 'viral',
    'headline', 'caption', 'newsletter', 'script', 'podcast', 'tweet',
    'instagram', 'linkedin', 'facebook', 'tiktok', 'thumbnail', 'description',
    'keyword research', 'ranking', 'serp', 'backlink', 'engagement',
  ],
};

const CLARIFICATION_TRIGGERS = ['help', 'what', 'how do i', 'can you', 'is it possible', 'maybe', 'not sure', 'confused'];

export class MockIntentAnalyzer implements IntentAnalyzer {
  async analyze(input: string): Promise<Intent> {
    const lower = input.toLowerCase().trim();

    if (!lower) {
      return {
        category: 'general',
        confidence: 0,
        matchedKeywords: [],
        reason: 'Empty input',
        needsClarification: true,
        clarificationQuestion: 'Could you tell me what you would like to build or solve?',
      };
    }

    const scores: { category: Exclude<TaskCategory, 'general' | 'clarification'>; score: number; keywords: string[] }[] = [];

    for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      const matched: string[] = [];
      let score = 0;
      for (const kw of keywords) {
        if (lower.includes(kw)) {
          matched.push(kw);
          score += 1;
        }
      }
      if (score > 0) {
        scores.push({ category: cat as Exclude<TaskCategory, 'general' | 'clarification'>, score, keywords: matched });
      }
    }

    scores.sort((a, b) => b.score - a.score);

    const top = scores[0];
    const second = scores[1];

    if (!top) {
      const needsClarification = CLARIFICATION_TRIGGERS.some((t) => lower.includes(t));
      return {
        category: 'general',
        confidence: 0.3,
        matchedKeywords: [],
        reason: needsClarification ? 'Ambiguous request — no domain keywords detected' : 'No specific domain detected — Temo will coordinate directly',
        needsClarification,
        clarificationQuestion: needsClarification ? 'I want to make sure I route this to the right specialist. Could you give me a bit more detail about what you are trying to achieve?' : undefined,
      };
    }

    // Confidence: ratio of top score to total, with a boost for dominance
    const totalScore = scores.reduce((sum, s) => sum + s.score, 0);
    let confidence = top.score / totalScore;
    if (second && second.score === top.score) {
      confidence *= 0.7; // tie reduces confidence
    }
    // Scale: more keywords = higher confidence, capped
    confidence = Math.min(0.98, 0.5 + confidence * 0.3 + Math.min(top.score * 0.06, 0.18));

    return {
      category: top.category,
      confidence: Math.round(confidence * 100) / 100,
      matchedKeywords: top.keywords,
      reason: `Detected ${top.category} terminology: ${top.keywords.slice(0, 4).join(', ')}`,
      needsClarification: false,
    };
  }
}
