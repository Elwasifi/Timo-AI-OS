// Intent Detector — deterministic, no LLM call. Analyzes the user's request
// to determine what kind of context is needed before any agent responds.
// This is the gatekeeper: memory-related and tool-related requests are
// detected here and NEVER reach the LLM directly.

import type { Intent } from '@/types';
import type { DetectedIntent, MemoryClassification } from './types';

// ---- Memory Query Patterns (questions about stored facts) ----
const MEMORY_QUERY_PATTERNS = [
  /\bwhat (do|did) i (prefer|like|want|use|choose|configure|have)\b/i,
  /\bwhat (is|are) my (prefer|setting|config|choice|favorite|default|name|email|provider|model|platform|language|project|company|workflow)\b/i,
  /\bwhich .{0,20}\bdo i\b/i,
  /\bwhich .{0,20}\b(i use|have|prefer|like|chose|configured)\b/i,
  /\bmy (prefer|setting|config|choice|favorite|default|name|email|provider|model|platform|language)\b/i,
  /\bwhat (project|app|product|platform|provider) (are|is) (we|i) (building|working|making|using)\b/i,
  /\bwhat (have|did) i (created|made|built|done|used|configured)\b/i,
  // M5-01: was `/\b(what|who) (is|are) .*\b/i` — an unbounded catch-all
  // that matched almost any "what is X" / "who is X" sentence in
  // English, including pure general-knowledge questions ("What is the
  // capital of Spain?"), silently short-circuiting them to "I couldn't
  // find this information in your memory" instead of ever reaching the
  // LLM (Deep Integrity Audit, Section D — live-reproduced). Narrowed to
  // require a possessive ("my"/"our"), which is what actually
  // distinguishes "what is my role?" (a real memory query — see
  // lib/validation/tests.ts's identity-team-01/identity-role-01) from a
  // general-knowledge question with no personal referent at all.
  /\b(what|who) (is|are) (my|our)\b/i,
  /\btell me about\b/i,
  /\bwhat do you (know|remember) (about|of)\b/i,
  /\b(recall|recite|remind me of)\b/i,
  /\bshow my (memor|preferences|settings|config)\b/i,
  /\bwhat (platform|provider|language|workflow|company) (do i|am i|are we)\b/i,
];

// ---- Remember Patterns ----
// Split into two categories so questions are never misclassified as
// "remember" commands. The old single list matched questions like
// "What is my favorite IDE?" because it contained topic patterns such as
// /\bmy favorite\b/i — those are about *what* the sentence discusses, not
// *whether* it's a command to store.

// Imperative patterns always mean "store this", regardless of sentence form.
const IMPERATIVE_REMEMBER_PATTERNS = [
  /\bremember that\b/i,
  /\bremember\b/i,
  /\bstore that\b/i,
  /\bsave that\b/i,
  /\bstore\b/i,
  /\bsave\b/i,
  /\bkeep in mind that\b/i,
  /\bkeep in mind\b/i,
  /\bdon'?t forget that\b/i,
  /\bdon'?t forget\b/i,
  /\bnote that\b/i,
  /\bfrom now on\b/i,
];

// Declarative assignment patterns mean "store this" ONLY when the sentence is
// a statement, NOT a question. A question guard prevents "What is my favorite
// IDE?" from matching /\bmy favorite\b/i.
const DECLARATIVE_ASSIGNMENT_PATTERNS = [
  /\bmy favorite\b/i,
  /\bi prefer\b/i,
  /\bwe are building\b/i,
  /\bour project\b/i,
  /\bmy default\b/i,
  /\buse .{0,15}\bby default\b/i,
  /\bmy preferred\b/i,
  /\bmy deployment platform\b/i,
  /\bmy ai provider\b/i,
  /\bmy language\b/i,
  /\bmy workflow\b/i,
  /\bmy company\b/i,
  /\bi (always|never|normally|usually) (use|prefer|like|want|choose|deploy)\b/i,
  /\bmy (name|email|provider|preference|setting) (is|=|:)\b/i,
];

// Question guard — if the sentence starts with any of these, it's a question
// and declarative assignment patterns must NOT match.
const QUESTION_START_RE = /^\s*(what|which|who|where|when|why|how|do|does|can|is|are|was|were|tell me|show|list|get|could|would|will|am i|are we|do i|did i|have i)\b/i;

function isQuestion(input: string): boolean {
  return QUESTION_START_RE.test(input.trim());
}

// Combined remember check: imperative patterns always match; declarative
// assignment patterns only match when the sentence is NOT a question.
export function asksToRememberInput(input: string): boolean {
  if (IMPERATIVE_REMEMBER_PATTERNS.some((p) => p.test(input))) return true;
  if (isQuestion(input)) return false;
  return DECLARATIVE_ASSIGNMENT_PATTERNS.some((p) => p.test(input));
}

// Strip imperative prefixes and trailing punctuation to produce a clean
// statement suitable for both storage and confirmation messages.
// "Remember that my favorite IDE is VS Code." → "my favorite IDE is VS Code"
export function cleanRememberStatement(input: string): string {
  const cleaned = input
    .replace(/^(remember that|remember|store that|save that|store|save|keep in mind that|keep in mind|don'?t forget that|don'?t forget|note that|from now on)\s*/i, '')
    .replace(/^(i want you to|i want you to remember|please remember|please note)\s*/i, '')
    .replace(/\.$/, '')
    .trim();
  return cleaned || input.trim().replace(/\.$/, '');
}

// ---- Tool Action Patterns ----
const TOOL_ACTION_PATTERNS = [
  { pattern: /\b(list|show|get|view|display)\b.*\bworkflow/i, category: 'n8n' as const },
  { pattern: /\b(run|execute|start|trigger)\b.*\bworkflow/i, category: 'n8n' as const },
  { pattern: /\b(create|make|new|build)\b.*\bworkflow/i, category: 'n8n' as const },
  { pattern: /\b(activate|enable|deactivate|disable|delete|remove)\b.*\bworkflow/i, category: 'n8n' as const },
  { pattern: /\b(sync|synchronize|refresh)\b.*\b(registry|workflows)\b/i, category: 'n8n' as const },
  { pattern: /\bwhat workflows\b/i, category: 'n8n' as const },
  { pattern: /\bwhich workflows\b/i, category: 'n8n' as const },
  { pattern: /\b(list|show|get|view)\b.*\b(repo|repositor|github|project)s?\b/i, category: 'github' as const },
  { pattern: /\b(list|show|read|open|get)\b.*\b(file|folder|directory)/i, category: 'files' as const },
  { pattern: /\b(search|google|look up|find online)\b/i, category: 'web' as const },
  { pattern: /\b(show|list|get|view)\b.*\b(memor|timeline|history|event)/i, category: 'memory' as const },
];

// ---- Timeline Patterns ----
const TIMELINE_PATTERNS = [
  /\b(recent|recent memories|timeline|history|what happened|past events|what did i do)\b/i,
  /\b(show|list|get|view)\b.*\b(memor|timeline|event|history)/i,
];

// ---- Memory Classification Patterns ----
const PROJECT_PATTERNS = [
  /\bwe are building\b/i,
  /\bour project\b/i,
  /\bthe project\b/i,
  /\barchitecture\b/i,
  /\bdesign decision\b/i,
  /\bwe are working on\b/i,
];

const PREFERENCE_PATTERNS = [
  /\bi prefer\b/i,
  /\bmy favorite\b/i,
  /\bmy preferred\b/i,
  /\bmy default\b/i,
  /\bby default\b/i,
  /\balways use\b/i,
  /\bnever use\b/i,
  /\bnormally use\b/i,
  /\busually use\b/i,
  /\bdevelopment preference\b/i,
  /\bdeployment preference\b/i,
  /\bcoding preference\b/i,
  /\bprovider preference\b/i,
  /\blanguage preference\b/i,
];

const LONG_TERM_PATTERNS = [
  /\bremember\b/i,
  /\bremember that\b/i,
  /\bkeep in mind\b/i,
  /\bdon'?t forget\b/i,
  /\bfrom now on\b/i,
];

/**
 * Classify a memory request deterministically — no LLM involved.
 */
export function classifyMemory(input: string): MemoryClassification {
  const isProject = PROJECT_PATTERNS.some((p) => p.test(input));
  const isPreference = PREFERENCE_PATTERNS.some((p) => p.test(input));
  const isLongTerm = LONG_TERM_PATTERNS.some((p) => p.test(input));

  const cleaned = cleanRememberStatement(input);

  if (isPreference) {
    return {
      type: 'long_term',
      category: 'preference',
      label: 'Long-Term Preference',
      confirmationMessage: `Got it — I'll remember that ${cleaned}.`,
      tags: ['preference', 'user'],
      importance: 'high',
    };
  }

  if (isProject) {
    return {
      type: 'long_term',
      category: 'project',
      label: 'Project Memory',
      confirmationMessage: `Got it — I'll remember that ${cleaned}.`,
      tags: ['project', 'architecture'],
      importance: 'high',
    };
  }

  if (isLongTerm) {
    return {
      type: 'long_term',
      category: 'general',
      label: 'Long-Term Memory',
      confirmationMessage: `Got it — I'll remember that ${cleaned}.`,
      tags: ['long-term'],
      importance: 'medium',
    };
  }

  return {
    type: 'long_term',
    category: 'general',
    label: 'Memory',
    confirmationMessage: `Got it — I'll remember that ${cleaned}.`,
    tags: ['memory'],
    importance: 'medium',
  };
}

export function detectIntent(input: string, routingIntent: Intent): DetectedIntent {
  const asksAboutMemory = MEMORY_QUERY_PATTERNS.some((p) => p.test(input));
  const asksAboutTimeline = TIMELINE_PATTERNS.some((p) => p.test(input));
  const asksToRemember = asksToRememberInput(input);

  let asksForToolAction = false;
  let toolCategoryHint: DetectedIntent['toolCategoryHint'] = 'none';

  for (const { pattern, category } of TOOL_ACTION_PATTERNS) {
    if (pattern.test(input)) {
      asksForToolAction = true;
      toolCategoryHint = category;
      break;
    }
  }

  // Memory tool actions (show memories, timeline) are tool actions
  if (toolCategoryHint === 'memory') {
    asksForToolAction = true;
  }

  const confidence = Math.max(
    routingIntent.confidence,
    asksAboutMemory ? 0.85 : 0,
    asksForToolAction ? 0.85 : 0,
    asksToRemember ? 0.9 : 0,
  );

  return {
    routingIntent,
    asksAboutMemory,
    asksForToolAction,
    toolCategoryHint,
    asksAboutTimeline,
    asksToRemember,
    confidence,
  };
}
