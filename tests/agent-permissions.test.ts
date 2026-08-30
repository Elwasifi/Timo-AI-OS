// M5-12: this exact gap has now recurred 3 times (Orion, the 5 Corporate
// Office agents, and structurally for every worker) — an agent shipped
// active in agent_registry with no corresponding AGENT_PERMISSIONS entry,
// silently unable to execute any tool at all (permissionEngine.validate()
// throws for any agent with zero entries). This test makes that
// structurally impossible to ship again unnoticed: it fails the build the
// moment a new active agent is added without an accompanying permissions
// entry, rather than relying on someone remembering to wire it by hand.
//
// Real integration test against the live Supabase project, matching this
// project's established discipline (CLAUDE.md) — reads the actual
// agent_registry table, not a fixture.

import { describe, it, expect } from 'vitest';
import { serviceRoleClient } from './helpers';
import { AGENT_PERMISSIONS } from '@/lib/tools/types';

describe('agent permissions coverage', () => {
  it('every active agent_registry row has an AGENT_PERMISSIONS entry', async () => {
    const svc = serviceRoleClient();
    const { data, error } = await svc
      .from('agent_registry')
      .select('id, display_name')
      .eq('is_active', true);

    if (error) throw new Error('Failed to load agent_registry: ' + error.message);
    expect(data).not.toBeNull();

    const missing = (data ?? []).filter((row) => !(row.id in AGENT_PERMISSIONS));

    if (missing.length > 0) {
      const names = missing.map((r) => `${r.id} ("${r.display_name}")`).join(', ');
      throw new Error(
        `${missing.length} active agent(s) have no AGENT_PERMISSIONS entry in lib/tools/types.ts ` +
        `and would be structurally unable to execute any tool: ${names}. ` +
        `Add a scoped entry (see M5-10 for the reasoning pattern each entry should follow) before merging.`,
      );
    }

    expect(missing).toHaveLength(0);
  });
});
