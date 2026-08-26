// M1-07: tenant isolation — a query from tenant A must never return tenant
// B's data. Real integration test against the live Supabase project and its
// real RLS policies (memories_tenant_select/insert), not a mock.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { INTERNAL_TENANT_ID, serviceRoleClient, clientAs, anonClient, createThrowawayTenantUser } from './helpers';

describe('tenant isolation', () => {
  let tenantB: Awaited<ReturnType<typeof createThrowawayTenantUser>>;
  let tenantAMemoryId: string;

  beforeAll(async () => {
    tenantB = await createThrowawayTenantUser('m1-07-tenant-isolation');

    const svc = serviceRoleClient();
    const { data: memory, error } = await svc
      .from('memories')
      .insert({ tenant_id: INTERNAL_TENANT_ID, type: 'semantic', title: 'M1-07 test memory', content: 'tenant isolation test content' })
      .select()
      .single();
    if (error || !memory) throw new Error('Failed to seed tenant-A memory: ' + error?.message);
    tenantAMemoryId = memory.id;
  });

  afterAll(async () => {
    const svc = serviceRoleClient();
    await svc.from('memories').delete().eq('id', tenantAMemoryId);
    await tenantB.cleanup();
  });

  it('tenant B cannot SELECT tenant A\'s memory', async () => {
    const bClient = clientAs(tenantB.accessToken);
    const { data } = await bClient.from('memories').select('id').eq('id', tenantAMemoryId);
    expect(data ?? []).toHaveLength(0);
  });

  it('tenant B cannot INSERT a memory_links row pointing at tenant A\'s memory', async () => {
    const bClient = clientAs(tenantB.accessToken);
    const { error } = await bClient
      .from('memory_links')
      .insert({ source_id: tenantAMemoryId, target_id: tenantAMemoryId, link_type: 'relates_to' });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501'); // RLS violation
  });

  it('anon (unauthenticated) cannot SELECT tenant A\'s memory either', async () => {
    const { data } = await anonClient().from('memories').select('id').eq('id', tenantAMemoryId);
    expect(data ?? []).toHaveLength(0);
  });
});
