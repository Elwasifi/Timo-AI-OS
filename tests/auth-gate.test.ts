// M1-07: the auth gate — requireUser()/isTenantMember() are the single
// verification helpers every tenant-scoped API route relies on (RLS is not
// a backstop server-side, see lib/auth/apiAuth.ts's own header comment).
// Tests the real functions against the real Supabase Auth service.

import { describe, it, expect } from 'vitest';
import { requireUser, isTenantMember } from '@/lib/auth/apiAuth';
import { INTERNAL_TENANT_ID, signInDevTester } from './helpers';

function requestWithAuth(token?: string): Request {
  return new Request('http://localhost/api/test', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

describe('requireUser()', () => {
  it('rejects a request with no Authorization header', async () => {
    const user = await requireUser(requestWithAuth());
    expect(user).toBeNull();
  });

  it('rejects a request with an invalid/garbage token', async () => {
    const user = await requireUser(requestWithAuth('not-a-real-token'));
    expect(user).toBeNull();
  });

  it('accepts a request with a real, valid session token', async () => {
    const { accessToken, userId } = await signInDevTester();
    const user = await requireUser(requestWithAuth(accessToken));
    expect(user).not.toBeNull();
    expect(user?.id).toBe(userId);
  });
});

describe('isTenantMember()', () => {
  it('returns true for a real membership', async () => {
    const { userId } = await signInDevTester();
    const result = await isTenantMember(userId, INTERNAL_TENANT_ID);
    expect(result).toBe(true);
  });

  it('returns false for a nonexistent tenant', async () => {
    const { userId } = await signInDevTester();
    const result = await isTenantMember(userId, '00000000-0000-0000-0000-000000000999');
    expect(result).toBe(false);
  });
});
