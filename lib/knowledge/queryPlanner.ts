// Query Planner — classifies a query before retrieval to determine which
// providers should be consulted. Simple preference lookups go directly to
// the structured provider; timeline questions go to the timeline provider;
// only complex questions use the full pipeline.

import type { FactCategory } from './types';

export type QueryPlanType =
  | 'structured_lookup'    // O(1) subject+predicate lookup
  | 'structured_browse'    // all facts for a subject
  | 'timeline'             // episodic events
  | 'semantic'             // vector search
  | 'complex';             // multi-provider fan-out

export interface QueryPlan {
  type: QueryPlanType;
  providers: ProviderName[];
  reason: string;
  structuredQuery?: {
    subject?: string;
    predicate?: string;
    categories?: FactCategory[];
    searchText?: string;
  };
}

export type ProviderName = 'structured' | 'semantic' | 'graph' | 'timeline';

// Patterns that indicate a structured preference/identity lookup
const STRUCTURED_LOOKUP_PATTERNS = [
  /\bwhat (is|are) my (prefer|setting|config|choice|favorite|default|name|email|provider|model|platform|language|project|company|workflow|ide|editor|database|framework|deployment)\b/i,
  /\bwhich (ide|editor|provider|platform|language|database|framework)\b.*\bdo i\b/i,
  /\bmy (favorite|preferred|default) (ide|editor|provider|platform|language|database|framework|deployment)\b/i,
];

// Patterns that indicate a timeline query
const TIMELINE_PATTERNS = [
  /\b(recent|timeline|history|what happened|past events|what did i do)\b/i,
  /\b(show|list|get|view)\b.*\b(timeline|event|history|memor)/i,
];

// Patterns that indicate a semantic search (open-ended question)
const SEMANTIC_PATTERNS = [
  /\btell me about\b/i,
  /\bwhat do you (know|remember) (about|of)\b/i,
  /\bexplain\b/i,
  /\bhow do\b/i,
  /\bwhy do\b/i,
];

// Map question words to likely predicates for structured lookup
const PREDICATE_MAP: Record<string, string> = {
  'favorite ide': 'PREFERS_IDE',
  'preferred ide': 'PREFERS_IDE',
  'default ide': 'PREFERS_IDE',
  'ide': 'PREFERS_IDE',
  'editor': 'PREFERS_IDE',
  'favorite editor': 'PREFERS_IDE',
  'preferred editor': 'PREFERS_IDE',
  'favorite provider': 'PREFERS_AI_PROVIDER',
  'preferred provider': 'PREFERS_AI_PROVIDER',
  'ai provider': 'PREFERS_AI_PROVIDER',
  'provider': 'PREFERS_AI_PROVIDER',
  'favorite platform': 'PREFERS_DEPLOYMENT_PLATFORM',
  'preferred platform': 'PREFERS_DEPLOYMENT_PLATFORM',
  'deployment platform': 'PREFERS_DEPLOYMENT_PLATFORM',
  'platform': 'PREFERS_DEPLOYMENT_PLATFORM',
  'favorite language': 'PREFERS_LANGUAGE',
  'preferred language': 'PREFERS_LANGUAGE',
  'language': 'PREFERS_LANGUAGE',
  'favorite database': 'PREFERS_DATABASE',
  'preferred database': 'PREFERS_DATABASE',
  'database': 'PREFERS_DATABASE',
  'favorite framework': 'PREFERS_FRAMEWORK',
  'preferred framework': 'PREFERS_FRAMEWORK',
  'framework': 'PREFERS_FRAMEWORK',
  'company': 'WORKS_FOR',
  'name': 'HAS_NAME',
  'email': 'HAS_EMAIL',
  'project': 'PROJECT_NAME',
};

export function planQuery(question: string): QueryPlan {
  const lower = question.toLowerCase().trim();

  // Check structured lookup first (highest priority, O(1))
  for (const pattern of STRUCTURED_LOOKUP_PATTERNS) {
    if (pattern.test(lower)) {
      const predicate = resolvePredicate(lower);
      return {
        type: 'structured_lookup',
        providers: ['structured'],
        reason: 'Direct preference/identity question — O(1) structured lookup',
        structuredQuery: {
          subject: 'user',
          predicate,
        },
      };
    }
  }

  // Check timeline
  for (const pattern of TIMELINE_PATTERNS) {
    if (pattern.test(lower)) {
      return {
        type: 'timeline',
        providers: ['timeline'],
        reason: 'Timeline/history question — episodic events only',
      };
    }
  }

  // Check semantic
  for (const pattern of SEMANTIC_PATTERNS) {
    if (pattern.test(lower)) {
      return {
        type: 'semantic',
        providers: ['semantic', 'structured'],
        reason: 'Open-ended question — semantic search with structured fallback',
      };
    }
  }

  // Default: complex — fan out to multiple providers
  return {
    type: 'complex',
    providers: ['structured', 'semantic', 'graph', 'timeline'],
    reason: 'Complex question — multi-provider fan-out',
  };
}

function resolvePredicate(lowerQuestion: string): string | undefined {
  for (const [phrase, predicate] of Object.entries(PREDICATE_MAP)) {
    if (lowerQuestion.includes(phrase)) {
      return predicate;
    }
  }
  return undefined;
}
