// M7-13c-2c-b: the chat-path read caches (lib/ai/chatReads.ts, TtlCache) are module-level; many existing tests change the mocked
// settings / budget / profile between test cases, so every test starts with them empty. Registered in vitest.config.ts (setupFiles).
import { beforeEach } from 'vitest';
import { clearAllTtlCaches } from '@/lib/utils/ttlCache';

beforeEach(() => { clearAllTtlCaches(); });
