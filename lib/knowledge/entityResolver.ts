// Entity Resolver — canonicalizes subjects and objects, and humanizes
// predicates for natural-language answers. Conservative: only resolves
// known canonical values; unknown values pass through unchanged.

import type { FactCategory } from './types';

// Map user-facing entity names to canonical subject strings
const SUBJECT_ALIASES: Record<string, string> = {
  'i': 'user',
  'me': 'user',
  'my': 'user',
  'user': 'user',
  'we': 'project',
  'our': 'project',
};

// Map predicate enums to human-readable labels
const PREDICATE_LABELS: Record<string, string> = {
  'PREFERS_IDE': 'favorite IDE',
  'PREFERS_EDITOR': 'favorite editor',
  'PREFERS_AI_PROVIDER': 'preferred AI provider',
  'PREFERS_DEPLOYMENT_PLATFORM': 'deployment platform',
  'PREFERS_LANGUAGE': 'preferred programming language',
  'PREFERS_DATABASE': 'preferred database',
  'PREFERS_FRAMEWORK': 'preferred framework',
  'WORKS_FOR': 'company',
  'HAS_NAME': 'name',
  'HAS_EMAIL': 'email',
  'PROJECT_NAME': 'project name',
  'USES': 'uses',
  'LIKES': 'likes',
  'DISLIKES': 'dislikes',
  'BUILDS': 'is building',
  'GOAL': 'goal',
  'ROLE': 'role',
};

// Map category enums to human-readable labels
const CATEGORY_LABELS: Record<FactCategory, string> = {
  preference: 'Preference',
  identity: 'Identity',
  project: 'Project',
  configuration: 'Configuration',
  environment: 'Environment',
  workflow: 'Workflow',
  habit: 'Habit',
  decision: 'Decision',
  rule: 'Rule',
  goal: 'Goal',
  relationship: 'Relationship',
  task: 'Task',
  fact: 'Fact',
  history: 'History',
  temporary: 'Temporary',
};

export function resolveSubject(value: string): string {
  const lower = value.toLowerCase().trim();
  return SUBJECT_ALIASES[lower] ?? lower;
}

export function humanizePredicate(predicate: string): string {
  return PREDICATE_LABELS[predicate] ?? predicate.toLowerCase().replace(/_/g, ' ');
}

export function humanizeCategory(category: FactCategory): string {
  return CATEGORY_LABELS[category] ?? category;
}

// Determine the canonical subject type from a statement
export function detectSubjectType(text: string): 'user' | 'project' | 'unknown' {
  const lower = text.toLowerCase();
  if (/\b(we|our|the project)\b/.test(lower) && !/\bi\b/.test(lower.split(/\b(we|our)\b/)[0])) {
    return 'project';
  }
  if (/\b(i|my|me)\b/.test(lower)) {
    return 'user';
  }
  return 'unknown';
}
