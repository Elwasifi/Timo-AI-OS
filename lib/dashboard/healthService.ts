// Phase 4 — Runtime Health Service
//
// Exposes health status for every subsystem in Temo AI OS.
// This data will later power the cinematic HUD.
//
// Health checks are non-invasive — they test connectivity and
// configuration without executing expensive operations.

import { supabase } from '@/lib/supabase/client';
import { loadSettings, FALLBACK_ORDER, PROVIDER_KEY_FIELD } from '@/lib/settings/settings-service';
import { toolRegistry } from '@/lib/tools/registry';
import { AGENT_DEFINITIONS } from '@/lib/agents/definitions';
import { listMissions } from '@/lib/swarm/missionService';
import { getRuntimeState } from '@/lib/swarm/runtimeStore';

// ---- Types ----

export type HealthStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

export interface HealthCheck {
  name: string;
  status: HealthStatus;
  detail: string;
  latencyMs: number | null;
}

export interface SystemHealth {
  overall: HealthStatus;
  checks: HealthCheck[];
  timestamp: string;
}

// ---- Individual Health Checks ----

async function checkProviderHealth(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const settings = await loadSettings();
    const configuredProviders = FALLBACK_ORDER.filter((id) => {
      if (id === 'ollama') return !!settings.ollama_base_url;
      const keyField = PROVIDER_KEY_FIELD[id] as keyof typeof settings;
      return !!settings[keyField];
    });

    if (configuredProviders.length === 0) {
      return { name: 'AI Providers', status: 'degraded', detail: 'No providers configured', latencyMs: null };
    }

    return {
      name: 'AI Providers',
      status: 'healthy',
      detail: `${configuredProviders.length} provider(s) configured: ${configuredProviders.join(', ')}`,
      latencyMs: Date.now() - start,
    };
  } catch (e) {
    return { name: 'AI Providers', status: 'down', detail: 'Failed to load provider settings', latencyMs: null };
  }
}

async function checkWorkflowHealth(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const { count, error } = await supabase
      .from('workflow_registry')
      .select('*', { count: 'exact', head: true })
      .eq('active', true);

    if (error) {
      return { name: 'Workflow Engine', status: 'degraded', detail: 'Database query failed', latencyMs: null };
    }

    return {
      name: 'Workflow Engine',
      status: 'healthy',
      detail: `${count ?? 0} active workflows registered`,
      latencyMs: Date.now() - start,
    };
  } catch {
    return { name: 'Workflow Engine', status: 'down', detail: 'Unreachable', latencyMs: null };
  }
}

async function checkMemoryHealth(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const { count, error } = await supabase
      .from('memories')
      .select('*', { count: 'exact', head: true })
      .limit(1);

    if (error) {
      return { name: 'Memory Engine', status: 'degraded', detail: 'Database query failed', latencyMs: null };
    }

    return {
      name: 'Memory Engine',
      status: 'healthy',
      detail: `${count ?? 0} memories stored`,
      latencyMs: Date.now() - start,
    };
  } catch {
    return { name: 'Memory Engine', status: 'down', detail: 'Unreachable', latencyMs: null };
  }
}

async function checkKnowledgeHealth(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const { count, error } = await supabase
      .from('structured_facts')
      .select('*', { count: 'exact', head: true })
      .limit(1);

    if (error) {
      return { name: 'Knowledge Engine', status: 'degraded', detail: 'Database query failed', latencyMs: null };
    }

    return {
      name: 'Knowledge Engine',
      status: 'healthy',
      detail: `${count ?? 0} structured facts stored`,
      latencyMs: Date.now() - start,
    };
  } catch {
    return { name: 'Knowledge Engine', status: 'down', detail: 'Unreachable', latencyMs: null };
  }
}

async function checkToolHealth(): Promise<HealthCheck> {
  try {
    const count = toolRegistry.count();
    return {
      name: 'Tool Engine',
      status: count > 0 ? 'healthy' : 'degraded',
      detail: `${count} tools registered`,
      latencyMs: null,
    };
  } catch {
    return { name: 'Tool Engine', status: 'down', detail: 'Registry unavailable', latencyMs: null };
  }
}

async function checkMissionEngineHealth(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const missions = await listMissions(10);
    const running = missions.filter((m) => m.status === 'executing').length;
    return {
      name: 'Mission Engine',
      status: 'healthy',
      detail: `${missions.length} missions tracked, ${running} running`,
      latencyMs: Date.now() - start,
    };
  } catch {
    return { name: 'Mission Engine', status: 'down', detail: 'Unreachable', latencyMs: null };
  }
}

async function checkSwarmHealth(): Promise<HealthCheck> {
  try {
    const managers = AGENT_DEFINITIONS.filter((a) => a.level === 'manager' && a.isActive);
    return {
      name: 'Swarm Manager',
      status: managers.length > 0 ? 'healthy' : 'degraded',
      detail: `${managers.length} active managers available`,
      latencyMs: null,
    };
  } catch {
    return { name: 'Swarm Manager', status: 'down', detail: 'Agent registry unavailable', latencyMs: null };
  }
}

async function checkRuntimeHealth(): Promise<HealthCheck> {
  try {
    const state = await getRuntimeState();
    return {
      name: 'Runtime State',
      status: 'healthy',
      detail: `State: ${state.executionState}, Manager: ${state.currentManagerId}`,
      latencyMs: null,
    };
  } catch {
    return { name: 'Runtime State', status: 'down', detail: 'Runtime store unavailable', latencyMs: null };
  }
}

// ---- Aggregate System Health ----

export async function getSystemHealth(): Promise<SystemHealth> {
  const checks = await Promise.all([
    checkProviderHealth(),
    checkWorkflowHealth(),
    checkMemoryHealth(),
    checkKnowledgeHealth(),
    checkToolHealth(),
    checkMissionEngineHealth(),
    checkSwarmHealth(),
    checkRuntimeHealth(),
  ]);

  const hasDown = checks.some((c) => c.status === 'down');
  const hasDegraded = checks.some((c) => c.status === 'degraded');
  const overall: HealthStatus = hasDown ? 'down' : hasDegraded ? 'degraded' : 'healthy';

  return {
    overall,
    checks,
    timestamp: new Date().toISOString(),
  };
}

// ---- Individual Subsystem Health (for granular queries) ----

export async function getProviderHealth(): Promise<HealthCheck> {
  return checkProviderHealth();
}

export async function getWorkflowHealth(): Promise<HealthCheck> {
  return checkWorkflowHealth();
}

export async function getMemoryHealth(): Promise<HealthCheck> {
  return checkMemoryHealth();
}

export async function getKnowledgeHealth(): Promise<HealthCheck> {
  return checkKnowledgeHealth();
}

export async function getToolHealth(): Promise<HealthCheck> {
  return checkToolHealth();
}

export async function getMissionEngineHealth(): Promise<HealthCheck> {
  return checkMissionEngineHealth();
}

export async function getSwarmHealth(): Promise<HealthCheck> {
  return checkSwarmHealth();
}
