// M7-13c-2c-b — which memory tools PERSIST something, and may therefore only be planned/executed when the user asked
// to remember/save. Found live: after a web search the tool planner (which is offered every tool the agent may use)
// also planned memory.store, so a plain "search for X" turn wrote — or in Demo tried to write — a memory nobody asked
// for. The prompt is not the control; this predicate is, enforced in lib/tools/planner.ts (the offered list) and in
// lib/context/tool-decision.ts (the executed list).
//
// Fail-closed by construction: ANY tool in the 'memory' category that is not explicitly flagged readOnly counts as a
// write, so a memory tool added later is guarded until someone proves it is read-only. The single exception is
// memory.forget: it removes rather than stores, is approval-gated (requiresApproval) and is the second half of the
// documented "show me X, then delete it" flow (M7-04) — it is not a "remember" action and is governed by approvals.

import type { ToolDefinition } from './types';

export const APPROVAL_GATED_MEMORY_TOOLS: ReadonlySet<string> = new Set(['memory.forget']);

export function isMemoryWriteTool(def: Pick<ToolDefinition, 'id' | 'category' | 'readOnly'>): boolean {
  return def.category === 'memory' && def.readOnly !== true && !APPROVAL_GATED_MEMORY_TOOLS.has(def.id);
}
