// Internal Operator Mode — M1-09 (docs/BACKLOG-M1.md), per docs/GOVERNANCE.md
// Section 4: operator-mode capabilities (ones that create/modify external
// infrastructure on Amro's own behalf, not a client's) must be gated to the
// internal tenant only, structurally — not just by policy or by simply
// never offering them to client-tenant agents.
//
// This constant + assertion is the single source of truth every operator
// capability's handler should call FIRST, before doing anything. A handler
// that doesn't check this is not an operator capability by this project's
// definition, regardless of what it's named or how it's registered.

export const INTERNAL_TENANT_ID = '00000000-0000-0000-0000-000000000001';

export class NotInternalTenantError extends Error {
  constructor() {
    super('This capability is restricted to the internal operator tenant.');
    this.name = 'NotInternalTenantError';
  }
}

/**
 * Throws if `tenantId` is not the internal tenant. Deliberately fail-closed:
 * a missing/null/undefined tenantId (e.g. a caller that never attributed a
 * tenant at all) is rejected exactly like a real client tenant would be —
 * "no proof of internal" is never treated as "assume internal."
 */
export function assertInternalTenant(tenantId: string | null | undefined): void {
  if (tenantId !== INTERNAL_TENANT_ID) {
    throw new NotInternalTenantError();
  }
}
