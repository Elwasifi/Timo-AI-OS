// Fact Formatter — converts structured facts into natural-language
// answers. The end user sees conversational text, never raw triples.

import type { StructuredFact } from './types';
import { humanizePredicate } from './entityResolver';

export function formatFactAnswer(fact: StructuredFact, question?: string): string {
  const label = humanizePredicate(fact.predicate);

  // Build a natural answer based on the predicate
  switch (fact.predicate) {
    case 'PREFERS_IDE':
      return `Your ${label} is ${fact.object}.`;
    case 'PREFERS_AI_PROVIDER':
      return `Your ${label} is ${fact.object}.`;
    case 'PREFERS_DEPLOYMENT_PLATFORM':
      return `Your ${label} is ${fact.object}.`;
    case 'PREFERS_LANGUAGE':
      return `Your ${label} is ${fact.object}.`;
    case 'PREFERS_DATABASE':
      return `Your ${label} is ${fact.object}.`;
    case 'PREFERS_FRAMEWORK':
      return `Your ${label} is ${fact.object}.`;
    case 'WORKS_FOR':
      return `You work for ${fact.object}.`;
    case 'HAS_NAME':
      return `Your name is ${fact.object}.`;
    case 'HAS_EMAIL':
      return `Your email is ${fact.object}.`;
    case 'PROJECT_NAME':
      return `Your project is ${fact.object}.`;
    case 'USES':
      return `You use ${fact.object}.`;
    case 'GOAL':
      return `Your goal is to ${fact.object}.`;
    default: {
      // Generic fallback: "Your <label> is <object>."
      const subject = fact.subject === 'user' ? 'Your' : 'The';
      return `${subject} ${label} is ${fact.object}.`;
    }
  }
}

export function formatNotFoundAnswer(question: string): string {
  // Extract the key noun from the question for a more specific answer
  const ideMatch = question.match(/\b(ide|editor)\b/i);
  if (ideMatch) return "I couldn't find your preferred IDE in my knowledge. You can tell me by saying \"My favorite IDE is VS Code.\"";

  const providerMatch = question.match(/\b(ai )?provider\b/i);
  if (providerMatch) return "I couldn't find your preferred AI provider. You can tell me by saying \"My AI provider is Gemini.\"";

  const platformMatch = question.match(/\b(deployment )?platform\b/i);
  if (platformMatch) return "I couldn't find your deployment platform. You can tell me by saying \"My deployment platform is Railway.\"";

  const languageMatch = question.match(/\b(programming )?language\b/i);
  if (languageMatch) return "I couldn't find your preferred programming language. You can tell me by saying \"My language is TypeScript.\"";

  const companyMatch = question.match(/\bcompany\b/i);
  if (companyMatch) return "I couldn't find your company. You can tell me by saying \"My company is Timo Labs.\"";

  return "I couldn't find this information. You can tell me by starting with \"Remember that...\" and I'll store it for next time.";
}

export function formatHistoryAnswer(history: StructuredFact[]): string {
  if (history.length === 0) return "I couldn't find any history for that.";

  const current = history[history.length - 1];
  const label = humanizePredicate(current.predicate);

  if (history.length === 1) {
    return `Your ${label} is ${current.object}.`;
  }

  const previous = history.slice(0, -1);
  const previousList = previous
    .map((f, i) => `${i === 0 ? 'You previously preferred' : 'then'} ${f.object}`)
    .join(', ');

  return `${previousList}. Your current ${label} is ${current.object}.`;
}

export function formatConflictPrompt(conflict: {
  predicate: string;
  oldValue: string;
  newValue: string;
}): string {
  const label = humanizePredicate(conflict.predicate);
  return `Previously you told me your ${label} is ${conflict.oldValue}. Now you said it is ${conflict.newValue}. Would you like me to replace it?`;
}
