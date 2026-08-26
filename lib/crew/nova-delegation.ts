// Nova Worker Delegation — Level 3A (compatibility wrapper)
//
// Nova's Manager → Worker delegation piloted the pattern generalized in
// Sprint 2 into lib/crew/manager-delegation.ts, which now drives delegation
// for ANY manager with registered active workers (registry-driven, not
// hardcoded). This file remains as a thin, name-stable wrapper so existing
// imports of delegateToWorker() keep working unchanged, and so Nova-specific
// identifiers used elsewhere (NOVA_WORKER_IDS) stay available.
//
// Communication chain: TEMO → NOVA → WORKER → NOVA → TEMO

import { delegateManagerTask } from './manager-delegation';
import type { DelegationCallbacks, DelegationResult } from './manager-delegation';

export type {
  WorkerTask,
  WorkerResult,
  DelegationCallbacks,
  DelegationResult,
} from './manager-delegation';

export const NOVA_WORKER_IDS = ['nova-frontend', 'nova-backend', 'nova-qa'] as const;
export type NovaWorkerId = (typeof NOVA_WORKER_IDS)[number];

/** Nova-specific entry point — delegates through the generic mechanism with managerId fixed to 'nova'. */
export async function delegateToWorker(
  input: string,
  context: string,
  taskId: string,
  callbacks: DelegationCallbacks,
): Promise<DelegationResult> {
  return delegateManagerTask('nova', input, context, taskId, callbacks);
}
