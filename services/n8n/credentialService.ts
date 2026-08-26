// Credential service — list credential metadata only. Actual credential
// values (passwords, tokens) are never exposed to the frontend. This module
// provides the abstraction layer so OAuth can be added later without
// changing the interface callers depend on.

import { proxy } from './n8nClient';
import type { N8nCredential } from './types';

export const credentialService = {
  async list(): Promise<N8nCredential[]> {
    return proxy<N8nCredential[]>({ action: 'list-credentials' });
  },

  async get(id: string): Promise<N8nCredential> {
    return proxy<N8nCredential>({ action: 'get-credential', credentialId: id });
  },
};
