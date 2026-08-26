// Phase 3 — Extended Swarm Types
//
// Adds Decision Engine and Execution Layer types on top of the Phase 2
// swarm types. These are separate from the existing @/types TaskRecord
// which belongs to the single-request routing system.

import type { AgentRecord } from '@/lib/agents/types';
import type { MissionTask, Mission, MissionObjective } from './types';

// ---- Decision Engine ----

export type PipelineType = 'simple' | 'mission';

export interface DecisionResult {
  pipeline: PipelineType;
  confidence: number;
  reason: string;
  signals: string[];
  estimatedComplexity: 'simple' | 'medium' | 'complex';
}

// ---- Manager Context ----

export interface PriorTaskResult {
  taskId: string;
  taskTitle: string;
  managerId: string;
  managerRoleId: string;
  workerId: string | null;
  workerRoleId: string | null;
  output: string;
  status: 'completed' | 'failed';
}

export interface ManagerContext {
  agent: AgentRecord;
  mission: Mission;
  objective: MissionObjective | null;
  task: MissionTask;
  role: string;
  capabilities: string[];
  department: string;
  missionObjective: string;
  taskContext: string;
  relevantMemory: string;
  relevantKnowledge: string;
  availableTools: string[];
  availableWorkflows: string[];
  systemPrompt: string;
  userPrompt: string;
  /** Outputs from tasks that completed before this one in the same mission */
  priorResults: PriorTaskResult[];
}

// ---- Execution Layer ----

export interface ExecutionResult {
  taskId: string;
  missionId: string;
  managerId: string;
  managerName: string;
  managerRoleId: string;
  workerId: string | null;
  workerRoleId: string | null;
  delegated: boolean;
  status: 'completed' | 'failed' | 'partial' | 'cancelled';
  output: string;
  result: Record<string, unknown>;
  error: string | null;
  retries: number;
  durationMs: number;
  steps: ExecutionStep[];
}

export interface ExecutionStep {
  step: string;
  status: 'started' | 'completed' | 'failed' | 'skipped';
  detail: string;
  durationMs: number;
}

export interface ExecutionContext {
  task: MissionTask;
  mission: Mission;
  objective: MissionObjective | null;
  manager: AgentRecord;
  timeoutMs: number;
  onEvent?: (event: string, detail: string) => void;
}

// ---- Unified Orchestrator ----

export interface OrchestratorResult {
  decision: DecisionResult;
  pipeline: PipelineType;
  response: string;
  missionId: string | null;
  execution: ExecutionResult[] | null;
  timeline: unknown[] | null;
  durationMs: number;
}
