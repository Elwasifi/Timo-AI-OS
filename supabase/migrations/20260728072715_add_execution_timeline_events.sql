/*
# Phase 3 — Execution Layer Timeline Events

## Purpose
Extends the `mission_timeline_event` enum with execution-level events
that the Execution Layer emits during task execution. These events
capture the granular steps of each task's execution — tool selection,
workflow execution, memory/knowledge retrieval, provider selection,
retries, and failures — making the timeline the complete data source
for the future cinematic dashboard.

## Changes
- Adds 11 new event types to the existing `mission_timeline_event` enum:
  decision_made, pipeline_selected, execution_started, tool_selected,
  workflow_executed, memory_retrieved, knowledge_retrieved,
  provider_selected, execution_finished, execution_failed,
  execution_retried, mission_updated

- Adds `task_timeout_ms` column to `mission_tasks` for per-task
  timeout configuration (nullable, defaults to 30000ms = 30s).

## Safety
- ALTER TYPE ... ADD VALUE is non-destructive — existing rows keep
  their existing enum values.
- The new column is nullable with a default, so existing rows get
  the default automatically.
- No data is dropped or renamed.
*/

-- ============================================================
-- 1. ADD EXECUTION-LEVEL TIMELINE EVENT TYPES
-- ============================================================

ALTER TYPE mission_timeline_event ADD VALUE IF NOT EXISTS 'decision_made';
ALTER TYPE mission_timeline_event ADD VALUE IF NOT EXISTS 'pipeline_selected';
ALTER TYPE mission_timeline_event ADD VALUE IF NOT EXISTS 'execution_started';
ALTER TYPE mission_timeline_event ADD VALUE IF NOT EXISTS 'tool_selected';
ALTER TYPE mission_timeline_event ADD VALUE IF NOT EXISTS 'workflow_executed';
ALTER TYPE mission_timeline_event ADD VALUE IF NOT EXISTS 'memory_retrieved';
ALTER TYPE mission_timeline_event ADD VALUE IF NOT EXISTS 'knowledge_retrieved';
ALTER TYPE mission_timeline_event ADD VALUE IF NOT EXISTS 'provider_selected';
ALTER TYPE mission_timeline_event ADD VALUE IF NOT EXISTS 'execution_finished';
ALTER TYPE mission_timeline_event ADD VALUE IF NOT EXISTS 'execution_failed';
ALTER TYPE mission_timeline_event ADD VALUE IF NOT EXISTS 'execution_retried';
ALTER TYPE mission_timeline_event ADD VALUE IF NOT EXISTS 'mission_updated';

-- ============================================================
-- 2. ADD TASK TIMEOUT COLUMN
-- ============================================================

ALTER TABLE mission_tasks
  ADD COLUMN IF NOT EXISTS task_timeout_ms integer DEFAULT 30000;
