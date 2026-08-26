// Role-Based Worker Router
//
// Selects the best Worker for a task using the agent registry's stable
// metadata: roleId, capabilities, department, parentId, and active status.
//
// Hierarchy is enforced: only workers whose parentId matches the assigned
// manager are candidates. This prevents arbitrary cross-department routing.
//
// Capability bridging: the mission planner emits manager-level capabilities
// (e.g. full_stack_development, code_review), but workers have granular
// skills (e.g. react, tailwind, frontend). A bridge map translates manager
// capabilities to the worker skills that satisfy them, so workers are
// actually found and selected.
//
// If no suitable worker is found, the caller falls back to direct manager
// LLM execution — this module never throws, it returns null.

import { loadAgents } from '@/lib/agents/agentRegistryService';
import type { AgentRecord } from '@/lib/agents/types';

export interface WorkerMatch {
  agent: AgentRecord;
  score: number;
  matchedCapabilities: string[];
  reason: string;
}

// Bridge: manager-level capability → worker-level skills that satisfy it.
// This is the ONLY place where the mapping is defined, so both routing
// and display stay consistent.
const CAPABILITY_BRIDGE: Record<string, string[]> = {
  full_stack_development: ['frontend', 'react', 'nextjs', 'tailwind', 'ui_components', 'jsx', 'backend', 'api_design', 'database', 'services', 'integration', 'serverless'],
  code_review: ['frontend', 'react', 'nextjs', 'tailwind', 'ui_components', 'jsx', 'backend', 'api_design', 'database', 'services', 'integration', 'serverless', 'testing', 'debugging', 'validation', 'qa', 'bug_fixing', 'error_handling'],
  architecture_analysis: ['frontend', 'backend', 'api_design', 'database', 'services', 'integration', 'serverless'],
  software_planning: ['frontend', 'backend', 'api_design', 'database', 'services', 'integration', 'serverless', 'testing', 'debugging', 'validation', 'qa'],
  api_design: ['api_design', 'backend', 'services', 'integration', 'serverless'],
  database_modeling: ['database', 'backend'],
  cloud_deployment: ['backend', 'serverless', 'services', 'integration'],
  devops: ['backend', 'serverless', 'services', 'integration'],
  testing: ['testing', 'debugging', 'validation', 'qa', 'bug_fixing', 'error_handling'],
  debugging: ['debugging', 'bug_fixing', 'error_handling', 'testing', 'validation', 'qa'],
};

/**
 * Find the best active Worker belonging to `managerId` whose capabilities
 * overlap with `requiredCapability`.
 *
 * Selection criteria (all sourced from the agent registry):
 *  - level === 'worker'
 *  - isActive === true
 *  - parentId === managerId  (enforces Manager → Worker hierarchy)
 *  - capabilities match the required capability, either directly or via
 *    the CAPABILITY_BRIDGE that translates manager capabilities to worker
 *    skills
 *
 * Returns null when no worker in the manager's hierarchy can handle the
 * task, signaling the caller to use the direct-manager fallback.
 */
export async function findWorkerForTask(
  managerId: string,
  requiredCapability: string,
): Promise<WorkerMatch | null> {
  const agents = await loadAgents();

  const workers = agents.filter(
    (a) =>
      a.level === 'worker' &&
      a.isActive &&
      a.parentId === managerId,
  );

  if (workers.length === 0) return null;

  // Resolve the set of worker skills that satisfy this manager capability
  const acceptableSkills = new Set<string>(
    CAPABILITY_BRIDGE[requiredCapability] ?? [requiredCapability],
  );

  let bestMatch: WorkerMatch | null = null;

  for (const worker of workers) {
    const matched = worker.capabilities.filter((cap) =>
      acceptableSkills.has(cap),
    );

    if (matched.length === 0) continue;

    const score = matched.length;

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = {
        agent: worker,
        score,
        matchedCapabilities: matched,
        reason: `${worker.roleId} has skills: ${matched.join(', ')}`,
      };
    }
  }

  return bestMatch;
}

/**
 * Resolve the stable roleId for an agent, falling back to its id.
 */
export function resolveRoleId(agent: AgentRecord | null | undefined): string {
  return agent?.roleId ?? agent?.id ?? 'unknown';
}
