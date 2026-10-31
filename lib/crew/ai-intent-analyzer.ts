import type { Agent } from '@/types';
import type { IntentAnalyzer } from './intent-analyzer';
import { chatWithFallback } from '@/lib/ai/ai-provider';
import { route, classifyTask } from '@/lib/ai/router';
import { useAuthStore } from '@/stores/authStore';
import type { Intent, TaskCategory } from '@/types';

const AGENT_CATEGORY_MAP: Record<string, string> = {
  nova: 'code',
  flow: 'workflow',
  atlas: 'business',
  luna: 'design',
  echo: 'content',
};

// M3-01: this classification call sits in the synchronous hot path of
// EVERY chat message (crew-coordinator.ts's routeAndRespond calls
// engine.route() — which calls this — before the Context Manager or the
// real response even start), so a slow/hanging provider here doubles the
// latency exposure of the entire pipeline, not just routing. A full
// route()+chatWithFallback() round trip has no upper bound on its own
// (up to 5 providers x 3 retries x exponential backoff), so it's given a
// short hard timeout and races it against the keyword fallback — intent
// classification legitimately has to complete before the correct agent's
// system prompt can be built, so this couldn't simply move off the
// critical path without restructuring routing itself (larger change than
// this ticket's scope); a hard timeout bounds the damage instead.
const INTENT_CLASSIFICATION_TIMEOUT_MS = 4000;

// M7-13b: this previously always paid the full LLM round trip (plus its
// own route() call) before EVERY response, even for a plain "hi" or a
// request with unambiguous domain keywords. Flipped to keyword-first:
// the free, instant KeywordFallbackAnalyzer runs first, and the LLM is
// only invoked when its confidence is below this bar. Deliberately
// conservative (per Amro's explicit instruction) — 0.75 requires at
// least 2 matched domain keywords (0.6 + 2*0.08), not just 1, before
// trusting the heuristic alone. This governs which SPECIALIST AGENT a
// simple chat message routes to (code/workflow/business/design/content/
// general/temo) — it does NOT decide mission-vs-simple-chat at all;
// that split happens earlier and separately in
// lib/swarm/decisionEngine.ts's makeDecision(), a non-LLM function this
// class is never consulted by. A wrong agent pick here is a worse
// specialist voice for one reply, recoverable next turn — not an
// unrecoverable action, which is why a moderately conservative bar
// (not a near-certain one) is an acceptable trade for cutting a real,
// measured ~550-650ms route()+LLM round trip on the clear-cut cases.
const KEYWORD_CONFIDENCE_THRESHOLD = 0.75;

/**
 * AIIntentAnalyzer — tries the instant keyword classifier first; only
 * calls the LLM when keyword confidence is below KEYWORD_CONFIDENCE_THRESHOLD.
 * Falls back to keyword-based analysis if the LLM call fails OR takes
 * longer than INTENT_CLASSIFICATION_TIMEOUT_MS, so routing never stalls
 * the whole pipeline waiting on a slow/reasoning-heavy model.
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

    const keywordResult = await this.keywordFallback.analyze(input);
    if (keywordResult.confidence >= KEYWORD_CONFIDENCE_THRESHOLD) {
      return keywordResult;
    }

    // M7-13e: route() reads provider_model_catalog/health over the network and
    // used to run BEFORE the timeout race below was even created — a stalled
    // read hung the whole chat pipeline with no "Trying <provider>" line ever
    // logged. The entire LLM attempt (route + chat) is now inside the race.
    // M7-13e: attribute the call to the REAL tenant. It used to pass
    // tenantId: null, which the ai-chat edge function treats as the INTERNAL
    // tenant — so a client tenant's intent classification ran on (and was
    // billed to) the internal tenant's provider keys, bypassing BYOK. With no
    // resolved tenant there is nobody's key to use: stay on the keyword result.
    const tenantId = useAuthStore.getState().currentTenantId;
    if (!tenantId) return keywordResult;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const classificationPromise = this.classifyWithLlm(input, tenantId);
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Intent classification timed out')), INTENT_CLASSIFICATION_TIMEOUT_MS);
      });
      const result = await Promise.race([classificationPromise, timeout]);

      const parsed = this.parseResponse(result.content);
      if (parsed) return parsed;
      return keywordResult;
    } catch {
      return keywordResult;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async classifyWithLlm(input: string, tenantId: string) {
    const decision = await route({
      classification: classifyTask({ text: input, needsStructuredOutput: true }),
      tenantId,
    });
    return chatWithFallback(
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
        // M3-01: bumped from 300 — too tight a budget for a "thinking"
        // model (confirmed live: gemini-3.6-flash) whose reasoning
        // tokens can consume the whole allowance before any visible
        // JSON is produced, which previously came back as an empty
        // string here (silently swallowed by the catch below).
        maxTokens: 500,
        candidates: decision.candidates,
        usageContext: {
          operation: 'intent_classification',
          tenantId,
          metadata: { taskType: decision.taskType, routingMode: decision.mode },
        },
      }
    );
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

// M7-13b: a short greeting/pleasantry (English and common Arabic/Franco-
// Arabic forms, per the ticket's own test phrases) carries no domain
// signal at all — it previously fell through to the generic "no keywords
// matched" branch below at confidence 0.3, which was always too low to
// skip the LLM call even though there is nothing here an LLM call could
// usefully disambiguate. Matched only when the ENTIRE trimmed message is
// short and is just the greeting (`$` anchor, few trailing words allowed)
// — a message that happens to START with "hi" but then asks something
// substantive must NOT short-circuit here.
// M7-13b: "hamdellah" (the ticket's own test phrase) and its common
// variants are colloquial Arabic transliterations with no single
// standard spelling — (al)?ham[du]*[iael]*llah covers the real spellings
// actually seen (hamdellah, hamdillah, hamdallah, alhamdulillah,
// hamdulillah) by allowing the vowels between "ham-d" and "-llah" to
// vary, rather than listing every transliteration as a separate
// alternative.
const GREETING_PATTERN = /^(hi+|hey+|hello+|yo|sup|howdy|good (morning|afternoon|evening)|what'?s up|how(’|')?s it going|(al)?ham[du]*[iael]*llah|ahlan(?: wa ?sahlan)?|marhaba|sal[ae]{1,2}m(?: ?alaikum)?|thanks?(?: you)?(?: a lot| so much)?|shukr[ae]n)[.!?\s]*$/i;

/** M7-13e: true for a bare greeting/pleasantry ("Hi", "hamdellah", "thanks") — used by the chat pipeline to skip stale conversation history for small talk. */
export function isGreeting(text: string): boolean {
  return GREETING_PATTERN.test(text.trim());
}

/**
 * KeywordFallbackAnalyzer — the original keyword-based analyzer kept as a
 * fallback when the LLM is unavailable (no API key, network error), and
 * now (M7-13b) the primary, instant first pass for every message.
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
    const trimmed = input.trim();
    if (GREETING_PATTERN.test(trimmed)) {
      return {
        category: 'general',
        confidence: 0.95,
        matchedKeywords: [],
        reason: 'Greeting/pleasantry detected — no domain routing needed',
        needsClarification: false,
      };
    }

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
