// Phase 3 - Manager Context Builder
//
// Builds the minimum required context for a manager to execute a task.
// Each manager receives only the context it needs: role, capabilities,
// department, mission objective, task details, relevant memory, relevant
// knowledge, available tools, and available workflows.
//
// The context builder delegates to existing systems:
// - Memory Service for relevant memories
// - Knowledge Engine for relevant knowledge
// - Tool Registry for available tools
// - n8n Workflow Service for available workflows
//
// It NEVER duplicates functionality; it orchestrates existing modules
// to assemble a focused context package for the manager.

import { getAgentById } from '@/lib/agents/agentRegistryService';
import { memory } from '@/lib/memory/memoryService';
import { knowledge } from '@/lib/knowledge/engine';
import { toolRegistry } from '@/lib/tools/registry';
import { permissionEngine } from '@/lib/tools/permissions';
import { buildSystemPrompt } from '@/lib/crew/agent-system-prompts';
import type { AgentRecord } from '@/lib/agents/types';
import type { Agent } from '@/types';
import type { Mission, MissionObjective, MissionTask } from './types';
import type { ManagerContext, PriorTaskResult } from './executionTypes';

// ---- Workflow listing (lazy import to avoid circular deps) ----

async function listAvailableWorkflows(): Promise<string[]> {
  try {
    const { supabase } = await import('@/lib/supabase/client');
    const { data } = await supabase
      .from('workflow_registry')
      .select('workflow_name')
      .eq('active', true)
      .limit(20);
    return (data ?? []).map((r: { workflow_name: string }) => r.workflow_name);
  } catch {
    return [];
  }
}

// ---- Agent Record -> Agent (for prompt builder compatibility) ----

function toAgentForPrompt(record: AgentRecord): Agent {
  return {
    id: record.id,
    name: record.displayName,
    role: record.role,
    description: record.description,
    color: record.themeColor,
    capabilities: record.capabilities,
    skills: record.capabilities,
    personality: {
      bio: record.description,
      traits: [],
      tone: 'professional',
    },
  } as unknown as Agent;
}

// ---- Prior Results Section Builder ----

function buildPriorResultsSection(priorResults: PriorTaskResult[]): string {
  if (priorResults.length === 0) return '';

  const lines: string[] = [
    '',
    '## Prior Task Results',
    'The following tasks have already been completed in this mission.',
    'Review and build upon their outputs; do not repeat work that is already done.',
    '',
  ];

  for (const r of priorResults) {
    const executedBy = r.workerRoleId
      ? r.managerRoleId + ' -> ' + r.workerRoleId
      : r.managerRoleId;
    lines.push('### ' + r.taskTitle);
    lines.push('**Executed by:** ' + executedBy);
    lines.push('**Status:** ' + r.status);
    lines.push('**Output:**');
    lines.push(r.output);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

// ---- Main Context Builder ----

export async function buildManagerContext(
  task: MissionTask,
  mission: Mission,
  objective: MissionObjective | null,
  priorResults: PriorTaskResult[] = [],
): Promise<ManagerContext | null> {
  const manager = await getAgentById(task.assignedManager ?? 'temo');
  if (!manager) return null;

  // 1. Gather relevant memory (top 3 results for the task title)
  let relevantMemory = '';
  try {
    const results = await memory.search({
      query: task.title,
      mode: 'hybrid',
      topK: 3,
      tenantId: mission.tenantId,
    });
    if (results.length > 0) {
      relevantMemory = results
        .map((r) => '- ' + r.memory.title + ': ' + (r.memory.summary || r.memory.content.slice(0, 200)))
        .join('\n');
    }
  } catch {
    // Memory retrieval failure is non-fatal
  }

  // 2. Gather relevant knowledge
  let relevantKnowledge = '';
  try {
    const answerResult = await knowledge.answer({
      question: task.title,
      agent: manager.id,
      tenantId: mission.tenantId,
    });
    if (answerResult.source !== 'not_found' && answerResult.answer) {
      relevantKnowledge = answerResult.answer;
    }
  } catch {
    // Knowledge retrieval failure is non-fatal
  }

  // 3. List available tools for this manager
  let availableTools: string[] = [];
  try {
    const permissions = permissionEngine.getPermissions(manager.id);
    availableTools = toolRegistry
      .listForAgent(manager.id, permissions)
      .map((t) => t.id + ': ' + t.name);
  } catch {
    // Tool listing failure is non-fatal
  }

  // 4. List available workflows
  const availableWorkflows = await listAvailableWorkflows();

  // 5. Build the system prompt using the existing prompt builder
  const agentForPrompt = toAgentForPrompt(manager);
  const baseSystemPrompt = buildSystemPrompt(agentForPrompt);

  // 6. Augment with mission context
  const priorResultsSection = buildPriorResultsSection(priorResults);

  const missionContext = [
    '## Mission Context',
    'You are executing a task within a larger mission.',
    '',
    '**Mission:** ' + mission.title,
    '**Mission Objective:** ' + mission.objective,
    '**Mission Priority:** ' + mission.priority,
    '**Mission Progress:** ' + mission.progress + '%',
    '',
    objective ? '**Your Objective:** ' + objective.title : '',
    '**Your Task:** ' + task.title,
    '**Task Description:** ' + task.description,
    '**Required Capability:** ' + task.requiredCapability,
    '',
    relevantMemory ? '## Relevant Memory\n' + relevantMemory : '',
    relevantKnowledge ? '## Relevant Knowledge\n' + relevantKnowledge : '',
    availableTools.length > 0 ? '## Available Tools\n' + availableTools.join('\n') : '',
    availableWorkflows.length > 0 ? '## Available Workflows\n' + availableWorkflows.join(', ') : '',
    priorResultsSection,
    '',
    '## Execution Guidelines',
    '- Execute this task as ' + manager.displayName + ', ' + manager.role + '.',
    '- Stay focused on the specific task; do not try to complete the entire mission.',
    '- Use available tools and workflows if they help accomplish the task.',
    '- Reference relevant memory and knowledge if applicable.',
    '- If prior task results are provided, review their outputs and incorporate them.',
    '- Provide a clear, actionable result that contributes to the mission objective.',
    '- Format your response as a complete, self-contained answer.',
  ].filter(Boolean).join('\n');

  const systemPrompt = baseSystemPrompt + '\n' + missionContext;

  // 7. Build the user prompt (the task itself)
  const userPrompt = [
    'Task: ' + task.title,
    '',
    task.description,
    '',
    'Mission context: ' + mission.title,
    'Objective: ' + mission.objective,
  ].join('\n');

  return {
    agent: manager,
    mission,
    objective,
    task,
    role: manager.role,
    capabilities: manager.capabilities,
    department: manager.departmentId ?? 'coordination',
    missionObjective: mission.objective,
    taskContext: task.description,
    relevantMemory,
    relevantKnowledge,
    availableTools,
    availableWorkflows,
    systemPrompt,
    userPrompt,
    priorResults,
  };
}
