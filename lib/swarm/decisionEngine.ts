// Phase 3 — Decision Engine
//
// Determines whether a user request should be routed through the simple
// pipeline (Crew Coordinator → direct response) or the mission pipeline
// (Mission Engine → Planner → Task Queue → Swarm → Execution → Response).
//
// The decision is confidence-based, using deterministic signal analysis.
// A future phase can swap in an LLM-backed classifier via the same interface.
//
// Simple requests: questions, explanations, translations, summaries,
//   memory retrieval, knowledge retrieval, single-step interactions.
// Mission requests: build, create, plan, analyze, automate, design,
//   research, multi-step objectives, anything requiring decomposition.

import { classifyComplexity, resolveCapabilities } from './missionPlanner';
import type { DecisionResult, PipelineType } from './executionTypes';

// ---- Signal Detection ----

const MISSION_VERBS = [
  'build', 'create', 'develop', 'implement', 'design', 'architect',
  'automate', 'integrate', 'deploy', 'migrate', 'refactor', 'optimize',
  'plan', 'strategy', 'setup', 'configure', 'generate', 'construct',
];

const MISSION_MULTIPLIERS = [
  'and then', 'after that', 'also', 'finally', 'next', 'step by step',
  'multi-step', 'end to end', 'comprehensive', 'complete', 'full',
  'pipeline', 'workflow', 'system', 'platform',
];

const SIMPLE_INDICATORS = [
  'what is', 'what are', 'explain', 'how does', 'how do', 'why',
  'translate', 'summarize', 'define', 'tell me about', 'describe',
  'who is', 'when did', 'where is', 'can you', 'do you know',
  'remember', 'what do you know', 'recall',
];

const QUESTION_MARKERS = ['?', 'how', 'what', 'why', 'when', 'where', 'who', 'which'];

// ---- Decision Logic ----

export function makeDecision(userRequest: string): DecisionResult {
  const lower = userRequest.toLowerCase();
  const signals: string[] = [];
  let missionScore = 0;
  let simpleScore = 0;

  // Signal 1: Mission verbs
  const matchedVerbs = MISSION_VERBS.filter((v) => lower.includes(v));
  if (matchedVerbs.length > 0) {
    missionScore += matchedVerbs.length * 2;
    signals.push(`mission verbs: ${matchedVerbs.join(', ')}`);
  }

  // Signal 2: Multi-step indicators
  const matchedMultipliers = MISSION_MULTIPLIERS.filter((m) => lower.includes(m));
  if (matchedMultipliers.length > 0) {
    missionScore += matchedMultipliers.length * 2;
    signals.push(`multi-step indicators: ${matchedMultipliers.join(', ')}`);
  }

  // Signal 3: Simple request indicators
  const matchedSimple = SIMPLE_INDICATORS.filter((s) => lower.includes(s));
  if (matchedSimple.length > 0) {
    simpleScore += matchedSimple.length * 2;
    signals.push(`simple indicators: ${matchedSimple.join(', ')}`);
  }

  // Signal 4: Question markers
  const matchedQuestions = QUESTION_MARKERS.filter((q) => lower.includes(q));
  if (matchedQuestions.length > 0 && matchedVerbs.length === 0) {
    simpleScore += 1;
    signals.push('question format detected');
  }

  // Signal 5: Capability count (multiple capabilities → mission)
  const capabilities = resolveCapabilities(userRequest);
  if (capabilities.length >= 2) {
    missionScore += capabilities.length;
    signals.push(`${capabilities.length} capabilities detected`);
  } else if (capabilities.length === 1 && matchedVerbs.length === 0) {
    simpleScore += 1;
  }

  // Signal 6: Length heuristic (longer requests tend to be missions)
  const wordCount = userRequest.trim().split(/\s+/).length;
  if (wordCount > 25) {
    missionScore += 1;
    signals.push(`long request (${wordCount} words)`);
  } else if (wordCount < 8) {
    simpleScore += 1;
    signals.push(`short request (${wordCount} words)`);
  }

  // Signal 7: Complexity classification
  const complexity = classifyComplexity(userRequest);
  if (complexity === 'complex') {
    missionScore += 3;
    signals.push('complexity: complex');
  } else if (complexity === 'medium') {
    missionScore += 1;
    signals.push('complexity: medium');
  } else {
    simpleScore += 1;
    signals.push('complexity: simple');
  }

  // ---- Final Decision ----
  const pipeline: PipelineType = missionScore > simpleScore ? 'mission' : 'simple';
  const totalScore = missionScore + simpleScore;
  const confidence = totalScore > 0
    ? Math.round((Math.max(missionScore, simpleScore) / totalScore) * 100)
    : 50;

  const reason = pipeline === 'mission'
    ? `Mission signals outweigh simple signals (${missionScore} vs ${simpleScore}). Request requires decomposition.`
    : `Simple signals outweigh mission signals (${simpleScore} vs ${missionScore}). Direct response appropriate.`;

  return {
    pipeline,
    confidence: Math.max(confidence, 50),
    reason,
    signals,
    estimatedComplexity: complexity,
  };
}
