// Phase 2 — Capability Matcher
//
// Matches a required capability against the Agent Registry to find the
// best manager for a task. This is the core of capability-driven dispatch:
// NO hardcoded agent names. The matcher reads from the Agent Registry
// and scores agents by capability overlap.
//
// Scoring:
// - Exact capability match: +1.0
// - Multiple capability matches: score increases (best overall fit)
// - Only active managers are considered for task assignment
// - Chief (Temo) is always a fallback when no manager matches

import { loadAgents } from '@/lib/agents/agentRegistryService';
import type { AgentRecord } from '@/lib/agents/types';
import type { CapabilityMatch } from './types';

export async function matchCapability(
  requiredCapability: string,
): Promise<CapabilityMatch | null> {
  const agents = await loadAgents();
  const managers = agents.filter(
    (a) => a.level === 'manager' && a.isActive,
  );

  let bestMatch: CapabilityMatch | null = null;

  for (const agent of managers) {
    const match = scoreAgent(agent, [requiredCapability]);
    if (match && (!bestMatch || match.score > bestMatch.score)) {
      bestMatch = match;
    }
  }

  if (bestMatch && bestMatch.score > 0) {
    return bestMatch;
  }

  // Fallback: no manager has this capability — route to Temo (chief)
  const chief = agents.find((a) => a.level === 'chief' && a.isActive);
  if (chief) {
    return {
      agent: chief,
      score: 0.1,
      matchedCapabilities: [],
      reason: `No manager matched capability "${requiredCapability}" — routing to chief coordinator`,
    };
  }

  return null;
}

export async function matchCapabilities(
  requiredCapabilities: string[],
): Promise<CapabilityMatch[]> {
  const agents = await loadAgents();
  const managers = agents.filter(
    (a) => a.level === 'manager' && a.isActive,
  );

  const results: CapabilityMatch[] = [];

  for (const agent of managers) {
    const match = scoreAgent(agent, requiredCapabilities);
    if (match && match.score > 0) {
      results.push(match);
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

export async function findBestManager(
  requiredCapability: string,
): Promise<AgentRecord | null> {
  const match = await matchCapability(requiredCapability);
  return match?.agent ?? null;
}

function scoreAgent(
  agent: AgentRecord,
  requiredCapabilities: string[],
): CapabilityMatch | null {
  const matched = requiredCapabilities.filter((cap) =>
    agent.capabilities.includes(cap),
  );

  if (matched.length === 0) return null;

  const score = matched.length / requiredCapabilities.length;
  const capList = matched.join(', ');
  const reason =
    matched.length === 1
      ? `agent '${agent.id}' has capability: ${capList}`
      : `agent '${agent.id}' has ${matched.length} matching capabilities: ${capList}`;

  return {
    agent,
    score,
    matchedCapabilities: matched,
    reason,
  };
}

// ---- Department Resolution ----

export async function findDepartmentForCapability(
  capability: string,
): Promise<string | null> {
  const match = await matchCapability(capability);
  return match?.agent.departmentId ?? null;
}
