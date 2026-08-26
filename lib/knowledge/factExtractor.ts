// Fact Extractor — deterministic, rule-based fact extraction.
// Never uses the LLM. Parses user statements into structured triples
// (subject, predicate, object) with category and confidence.

import type { ExtractedFact, FactCategory } from './types';
import { resolveSubject, detectSubjectType } from './entityResolver';

// Extraction rule: pattern → predicate + category
interface ExtractionRule {
  pattern: RegExp;
  predicate: string;
  category: FactCategory;
  extractObject: (match: RegExpMatchArray, text: string) => string | null;
}

const EXTRACTION_RULES: ExtractionRule[] = [
  // "my favorite IDE is VS Code" / "my favourite IDE is VS Code"
  {
    pattern: /\bmy favou?rite (ide|editor|code editor)\s+is\s+(.+?)(?:\.|$)/i,
    predicate: 'PREFERS_IDE',
    category: 'preference',
    extractObject: (m) => m[2].trim(),
  },
  // "I prefer VS Code" / "I prefer using VS Code"
  {
    pattern: /\bi prefer (using )?(.+?)(?:\.|$)/i,
    predicate: 'PREFERS_GENERAL',
    category: 'preference',
    extractObject: (m) => m[2].trim(),
  },
  // "my preferred X is Y" / "my default X is Y"
  {
    pattern: /\bmy (preferred|default) (.+?)\s+is\s+(.+?)(?:\.|$)/i,
    predicate: 'PREFERS_GENERAL',
    category: 'preference',
    extractObject: (m) => m[3].trim(),
  },
  // "I use VS Code" / "I always use VS Code" / "I normally use VS Code"
  {
    pattern: /\bi (always|usually|normally)? ?use (.+?)(?:\.|$)/i,
    predicate: 'USES',
    category: 'habit',
    extractObject: (m) => m[2].trim(),
  },
  // "my company is Timo Labs" / "I work at Timo Labs" / "I work for Timo Labs"
  {
    pattern: /\bmy company is (.+?)(?:\.|$)/i,
    predicate: 'WORKS_FOR',
    category: 'identity',
    extractObject: (m) => m[1].trim(),
  },
  {
    pattern: /\bi work (at|for) (.+?)(?:\.|$)/i,
    predicate: 'WORKS_FOR',
    category: 'identity',
    extractObject: (m) => m[2].trim(),
  },
  // "my name is X" / "I am X" (identity)
  {
    pattern: /\bmy name is (.+?)(?:\.|$)/i,
    predicate: 'HAS_NAME',
    category: 'identity',
    extractObject: (m) => m[1].trim(),
  },
  // "my email is X"
  {
    pattern: /\bmy email is (.+?)(?:\.|$)/i,
    predicate: 'HAS_EMAIL',
    category: 'identity',
    extractObject: (m) => m[1].trim(),
  },
  // "we are building Timo AI OS" / "we're building X"
  {
    pattern: /\bwe'?re? building (.+?)(?:\.|$)/i,
    predicate: 'PROJECT_NAME',
    category: 'project',
    extractObject: (m) => m[1].trim(),
  },
  // "our project is X" / "our project is called X"
  {
    pattern: /\bour project is (called )?(.+?)(?:\.|$)/i,
    predicate: 'PROJECT_NAME',
    category: 'project',
    extractObject: (m) => m[2].trim(),
  },
  // "my deployment platform is Railway"
  {
    pattern: /\bmy deployment platform is (.+?)(?:\.|$)/i,
    predicate: 'PREFERS_DEPLOYMENT_PLATFORM',
    category: 'preference',
    extractObject: (m) => m[1].trim(),
  },
  // "my AI provider is Gemini" / "my ai provider is X"
  {
    pattern: /\bmy ai provider is (.+?)(?:\.|$)/i,
    predicate: 'PREFERS_AI_PROVIDER',
    category: 'preference',
    extractObject: (m) => m[1].trim(),
  },
  // "my (programming) language is X"
  {
    pattern: /\bmy (programming )?language is (.+?)(?:\.|$)/i,
    predicate: 'PREFERS_LANGUAGE',
    category: 'preference',
    extractObject: (m) => m[2].trim(),
  },
  // "I always/never/usually deploy to X"
  {
    pattern: /\bi (always|never|usually|normally) deploy to (.+?)(?:\.|$)/i,
    predicate: 'PREFERS_DEPLOYMENT_PLATFORM',
    category: 'habit',
    extractObject: (m) => m[2].trim(),
  },
  // "my goal is X" / "our goal is X"
  {
    pattern: /\b(my|our) goal is to (.+?)(?:\.|$)/i,
    predicate: 'GOAL',
    category: 'goal',
    extractObject: (m) => m[2].trim(),
  },
];

// Question patterns that map to structured predicates (for recall)
const QUESTION_PATTERNS: { pattern: RegExp; predicate: string }[] = [
  { pattern: /\bwhat (is|are) my (favorite|preferred) (ide|editor|code editor)\b/i, predicate: 'PREFERS_IDE' },
  { pattern: /\bwhat (is|are) my (favorite|preferred) (ai )?provider\b/i, predicate: 'PREFERS_AI_PROVIDER' },
  { pattern: /\bwhat (is|are) my (favorite|preferred|default) (deployment )?platform\b/i, predicate: 'PREFERS_DEPLOYMENT_PLATFORM' },
  { pattern: /\bwhat (is|are) my (favorite|preferred|default) (programming )?language\b/i, predicate: 'PREFERS_LANGUAGE' },
  { pattern: /\bwhat (is|are) my (favorite|preferred|default) database\b/i, predicate: 'PREFERS_DATABASE' },
  { pattern: /\bwhat (is|are) my (favorite|preferred|default) framework\b/i, predicate: 'PREFERS_FRAMEWORK' },
  { pattern: /\bwhat (is|are) my company\b/i, predicate: 'WORKS_FOR' },
  { pattern: /\bwhat (is|are) my name\b/i, predicate: 'HAS_NAME' },
  { pattern: /\bwhat (is|are) my email\b/i, predicate: 'HAS_EMAIL' },
  { pattern: /\bwhat (is|are) (our|the) (project|app|product)\b/i, predicate: 'PROJECT_NAME' },
  { pattern: /\bwhat (is|are) (we|i) building\b/i, predicate: 'PROJECT_NAME' },
  { pattern: /\bwhat (is|are) my goal\b/i, predicate: 'GOAL' },
];

export function extractFacts(input: string): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const subjectType = detectSubjectType(input);
  const subject = subjectType === 'project' ? 'project' : 'user';

  for (const rule of EXTRACTION_RULES) {
    const match = input.match(rule.pattern);
    if (match) {
      const object = rule.extractObject(match, input);
      if (!object || object.length < 1) continue;

      const cleanedStatement = cleanStatement(input);

      facts.push({
        subject,
        predicate: rule.predicate,
        object,
        category: rule.category,
        confidence: 100,
        confidenceSource: 'user',
        confidenceReason: 'Explicit user statement',
        cleanedStatement,
      });
    }
  }

  return facts;
}

export function resolveQuestionAttribute(question: string): { subject: string; predicate: string } | null {
  for (const { pattern, predicate } of QUESTION_PATTERNS) {
    if (pattern.test(question)) {
      const subjectType = detectSubjectType(question);
      const subject = subjectType === 'project' ? 'project' : 'user';
      return { subject, predicate };
    }
  }
  return null;
}

function cleanStatement(input: string): string {
  return input
    .replace(/^(remember that|remember|store that|save that|store|save|keep in mind that|keep in mind|don'?t forget that|don'?t forget|note that|from now on|i want you to|i want you to remember|please remember|please note)\s*/i, '')
    .replace(/\.$/, '')
    .trim();
}
