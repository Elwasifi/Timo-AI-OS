import type { Agent } from '@/types';
import type { IntentAnalyzer } from './intent-analyzer';
import { chatWithFallback } from '@/lib/ai/ai-provider';
import { route, classifyTask } from '@/lib/ai/router';
import type { Intent, TaskCategory } from '@/types';

const AGENT_CATEGORY_MAP: Record<string, string> = {
  nova: 'code',
  flow: 'workflow',
  atlas: 'business',
  luna: 'design',
  echo: 'content',
};

/**
 * AIIntentAnalyzer — uses a real LLM (Gemini) to analyze user intent.
 * Falls back to keyword-based analysis if the LLM call fails, so routing
 * still works even when no API key is configured.
 */
export class AIIntentAnalyzer implements IntentAnalyzer {
  private keywordFallback = new KeywordFallbackAnalyzer();

  async analyze(input: string): Promise<Intent> {
    if (!input.trim()) {
      return {
        category: 'general',
        confidence: 0,
        matchedKeywords: [],
        reason: 'Empty input',
        needsClarification: true,
        clarificationQuestion: 'Could you tell me what you would like to build or solve?',
      };
    }

    try {
      // Intent classification is a short-input, structured-JSON,
      // latency-sensitive task — runs on every message before an agent is
      // even selected, so it belongs on the router's FAST_CHAT/
      // STRUCTURED_OUTPUT profile, not whatever model is globally active.
      const decision = await route({
        classification: classifyTask({ text: input, needsStructuredOutput: true }),
        tenantId: null,
      });
      const result = await chatWithFallback(
        [
          {
            role: 'user',
            content: `Analyze the user's request and classify it into exactly one category.

User request: "${input}"

Respond with ONLY a JSON object (no markdown, no backticks) with this exact shape:
{"category":"code|workflow|business|design|content|general|clarification","confidence":0.0-1.0,"reason":"one sentence","needsClarification":true|false,"clarificationQuestion":"optional string"}

Rules:
- "code": programming, debugging, architecture, APIs, databases, deployment
- "workflow": automation, n8n, integrations, webhooks, pipelines
- "business": marketing, sales, strategy, growth, analytics
- "design": UI, UX, branding, visual, typography
- "content": writing, SEO, social media, copywriting, scripts
- "general": doesn't fit any specialty or is a broad coordination request
- "clarification": the request is too vague or ambiguous to route confidently
- confidence is your certainty (0-1) that the chosen category is correct
- needsClarification is true only when you genuinely cannot determine intent`,
          },
        ],
        {
          systemPrompt: 'You are an intent classification engine for an AI crew system. Output only valid JSON.',
          temperature: 0.1,
          maxTokens: 300,
          candidates: decision.candidates,
          usageContext: {
            operation: 'intent_classification',
            tenantId: null,
            metadata: { taskType: decision.taskType, routingMode: decision.mode },
          },
        }
      );

      const parsed = this.parseResponse(result.content);
      if (parsed) return parsed;
      return this.keywordFallback.analyze(input);
    } catch {
      return this.keywordFallback.analyze(input);
    }
  }

  private parseResponse(text: string): Intent | null {
    try {
      const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
      const data = JSON.parse(clean);
      const validCategories: TaskCategory[] = ['code', 'workflow', 'business', 'design', 'content', 'general', 'clarification'];
      const category = validCategories.includes(data.category) ? data.category : 'general';
      return {
        category,
        confidence: typeof data.confidence === 'number' ? Math.max(0, Math.min(1, data.confidence)) : 0.5,
        matchedKeywords: [],
        reason: typeof data.reason === 'string' ? data.reason : 'AI-classified',
        needsClarification: !!data.needsClarification,
        clarificationQuestion: typeof data.clarificationQuestion === 'string' ? data.clarificationQuestion : undefined,
      };
    } catch {
      return null;
    }
  }
}

/**
 * KeywordFallbackAnalyzer — the original keyword-based analyzer kept as a
 * fallback when the LLM is unavailable (no API key, network error).
 */
export class KeywordFallbackAnalyzer implements IntentAnalyzer {
  private keywords: Record<string, string[]> = {
    code: ['code', 'programming', 'debug', 'bug', 'function', 'typescript', 'javascript', 'python', 'react', 'api', 'database', 'sql', 'server', 'deploy', 'architecture', 'endpoint', 'backend', 'frontend'],
    workflow: ['workflow', 'automate', 'n8n', 'zapier', 'webhook', 'integration', 'trigger', 'schedule', 'pipeline', 'connect'],
    business: ['business', 'marketing', 'sales', 'pricing', 'growth', 'analytics', 'strategy', 'revenue', 'competitor', 'market'],
    design: ['design', 'ui', 'ux', 'branding', 'brand', 'graphics', 'presentation', 'logo', 'color', 'layout', 'prototype', 'figma'],
    content: ['content', 'writing', 'write', 'seo', 'youtube', 'social', 'copywriting', 'email', 'blog', 'post', 'article', 'viral', 'headline'],
  };

  async analyze(input: string): Promise<Intent> {
    const lower = input.toLowerCase();
    const scores: { category: string; score: number; matched: string[] }[] = [];

    for (const [cat, kws] of Object.entries(this.keywords)) {
      const matched = kws.filter((k) => lower.includes(k));
      if (matched.length > 0) scores.push({ category: cat, score: matched.length, matched });
    }

    scores.sort((a, b) => b.score - a.score);
    const top = scores[0];

    if (!top) {
      return {
        category: 'general',
        confidence: 0.3,
        matchedKeywords: [],
        reason: 'No domain keywords detected — Temo will coordinate directly',
        needsClarification: false,
      };
    }

    return {
      category: top.category as TaskCategory,
      confidence: Math.min(0.95, 0.6 + top.score * 0.08),
      matchedKeywords: top.matched,
      reason: `Detected ${top.category} terminology: ${top.matched.slice(0, 4).join(', ')}`,
      needsClarification: false,
    };
  }
}

export { AGENT_CATEGORY_MAP };
