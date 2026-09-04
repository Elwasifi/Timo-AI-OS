// Phase 2 — Swarm Orchestration Types
//
// These types define the mission-oriented AI operating system layer.
// They are entirely separate from the existing @/types TaskStatus/TaskRecord
// (which belongs to the single-request routing system in lib/crew/).
// The swarm layer operates at a higher abstraction: Mission → Objective → Task.

import type { AgentRecord } from '@/lib/agents/types';

// ---- Enums (as string literal unions for ergonomics) ----

export type MissionStatus =
  | 'pending'
  | 'planning'
  | 'ready'
  | 'executing'
  | 'reviewing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'paused';

export type MissionComplexity = 'simple' | 'medium' | 'complex';

export type MissionPriority = 'low' | 'medium' | 'high' | 'critical';

export type ObjectiveStatus =
  | 'pending'
  | 'ready'
  | 'in_progress'
  | 'completed'
  | 'failed';

export type ObjectiveEffort = 'low' | 'medium' | 'high';

export type TaskQueueStatus =
  | 'waiting'
  | 'ready'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TimelineEventType =
  | 'mission_created'
  | 'mission_planned'
  | 'objectives_generated'
  | 'tasks_created'
  | 'task_assigned'
  | 'task_started'
  | 'task_completed'
  | 'task_failed'
  | 'mission_completed'
  | 'mission_failed'
  | 'mission_cancelled'
  | 'mission_paused'
  | 'mission_resumed'
  | 'review_started'
  | 'review_completed'
  // Phase 3 — Execution-level events
  | 'decision_made'
  | 'pipeline_selected'
  | 'execution_started'
  | 'tool_selected'
  | 'tool_decision_outcome'
  | 'workflow_executed'
  | 'memory_retrieved'
  | 'knowledge_retrieved'
  | 'provider_selected'
  | 'execution_finished'
  | 'execution_failed'
  | 'execution_retried'
  | 'mission_updated';

// ---- Core Domain Objects ----

export interface Mission {
  id: string;
  title: string;
  objective: string;
  userRequest: string;
  priority: MissionPriority;
  status: MissionStatus;
  progress: number;
  estimatedComplexity: MissionComplexity;
  estimatedTasks: number;
  parentMissionId: string | null;
  metadata: Record<string, unknown>;
  /** V1: owning tenant (Temo Corporate's internal tenant, or a client tenant). */
  tenantId: string;
  /** V1: simulation/R&D missions never trigger real external side effects. */
  isSimulation: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MissionObjective {
  id: string;
  missionId: string;
  title: string;
  requiredCapability: string;
  estimatedEffort: ObjectiveEffort;
  dependencies: string[];
  status: ObjectiveStatus;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface MissionTask {
  id: string;
  missionId: string;
  objectiveId: string | null;
  parentTaskId: string | null;
  assignedManager: string | null;
  assignedWorker: string | null;
  requiredCapability: string;
  title: string;
  description: string;
  priority: MissionPriority;
  status: TaskQueueStatus;
  dependencies: string[];
  retries: number;
  maxRetries: number;
  executionLog: ExecutionLogEntry[];
  result: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  /** M7-01: per-task override for the agent loop's max reasoning steps; null = use the code default. */
  maxLoopSteps: number | null;
  /** M7-01: in-progress agent-loop checkpoint, non-null only while a loop is genuinely mid-flight (interrupted, not finished/failed). */
  loopState: AgentLoopState | null;
}

export interface AgentLoopState {
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[];
  stepsUsed: number;
}

export interface ExecutionLogEntry {
  timestamp: string;
  event: string;
  detail: string;
  agentId?: string;
}

export interface TimelineEntry {
  id: string;
  missionId: string;
  eventType: TimelineEventType;
  entityType: string | null;
  entityId: string | null;
  title: string;
  detail: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// ---- Organizational Learning (Section 3E) ----

export interface Lesson {
  id: string;
  tenantId: string | null;
  missionId: string;
  category: string;
  summary: string;
  detail: string;
  outcome: 'success' | 'failure' | 'partial';
  createdAt: string;
}

// ---- Planner Output ----

export interface PlannedObjective {
  title: string;
  requiredCapability: string;
  estimatedEffort: ObjectiveEffort;
  dependencies: string[];
}

export interface MissionPlan {
  complexity: MissionComplexity;
  estimatedTasks: number;
  objectives: PlannedObjective[];
}

// ---- Capability Matching ----

export interface CapabilityMatch {
  agent: AgentRecord;
  score: number;
  matchedCapabilities: string[];
  reason: string;
}

export interface TaskAssignment {
  task: MissionTask;
  assignedManager: AgentRecord;
  match: CapabilityMatch;
  reason: string;
}

// ---- Mission Engine Result ----

export interface MissionExecutionResult {
  mission: Mission;
  objectives: MissionObjective[];
  tasks: MissionTask[];
  timeline: TimelineEntry[];
  assignments: TaskAssignment[];
  finalStatus: MissionStatus;
  summary: string;
}
