// Phase 2 + 3 — Swarm Orchestration Public API
//
// Barrel export for the mission-oriented orchestration layer.
// Import from '@/lib/swarm' to access any swarm module.

// Types
export type {
  Mission,
  MissionObjective,
  MissionTask,
  MissionPlan,
  MissionStatus,
  MissionComplexity,
  MissionPriority,
  ObjectiveStatus,
  ObjectiveEffort,
  TaskQueueStatus,
  TimelineEventType,
  TimelineEntry,
  ExecutionLogEntry,
  PlannedObjective,
  CapabilityMatch,
  TaskAssignment,
  MissionExecutionResult,
} from './types';

// Phase 3 — Execution Types
export type {
  PipelineType,
  DecisionResult,
  ManagerContext,
  ExecutionResult,
  ExecutionStep,
  ExecutionContext,
  OrchestratorResult,
} from './executionTypes';

// Mission Engine (orchestrator)
export {
  launchMission,
  getMissionStatus,
  completeTask,
  failTask,
  startTask,
} from './missionEngine';
export type { CreateMissionInput } from './missionEngine';

// Mission Planner
export {
  planMission,
  classifyComplexity,
  resolveCapabilities,
  estimatePriority,
} from './missionPlanner';

// Mission Service (DB CRUD)
export {
  createMission,
  getMission,
  updateMission,
  listMissions,
  createObjectives,
  getObjectives,
  createTasks,
  getTasks,
  getReadyTasks,
  updateTask,
  getFullMission,
  getTimeline,
} from './missionService';

// Capability Matcher
export {
  matchCapability,
  matchCapabilities,
  findBestManager,
  findDepartmentForCapability,
} from './capabilityMatcher';

// Swarm Manager
export {
  dispatchTask,
  dispatchTasks,
  findManagerForTask,
} from './swarmManager';
export type { DispatchResult } from './swarmManager';

// Timeline Tracker
export {
  recordEvent,
  recordMissionCreated,
  recordMissionPlanned,
  recordObjectivesGenerated,
  recordTasksCreated,
  recordTaskAssigned,
  recordTaskStarted,
  recordTaskCompleted,
  recordTaskFailed,
  recordMissionCompleted,
  recordMissionFailed,
} from './missionTimeline';

// Phase 3 — Decision Engine
export { makeDecision } from './decisionEngine';

// Phase 3 — Manager Context Builder
export { buildManagerContext } from './managerContext';

// Phase 3 — Execution Layer
export { executeTask, executeMissionTasks } from './executionLayer';

// Phase 3 — Unified Orchestrator
export { orchestrate, getRuntimeState } from './unifiedOrchestrator';
export type { OrchestrateOptions, OrchestrateResult } from './unifiedOrchestrator';

// Phase 4 — Runtime Store
export {
  getRuntimeState as getRuntimeStateDirect,
  updateRuntimeState,
  addRuntimeActivity,
  getRuntimeActivity,
  emitRuntimeEvent,
  type RuntimeState,
  type RuntimeActivityItem,
  type RuntimeEvent,
  type RuntimeEventType,
  type RuntimeEventStatus,
  type ExecutionState,
} from './runtimeStore';
