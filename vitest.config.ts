import { defineConfig } from 'vitest/config';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

// M1-07: these are integration tests against the real Supabase project
// (matching this project's established "live verification, not
// typecheck-only" discipline — see CLAUDE.md), so .env/.env.local need to
// land in process.env before any test file runs. Parsed manually rather
// than importing `vite`'s loadEnv() to avoid a type-resolution dependency
// on a package that isn't hoisted to a directly-importable location here.
for (const file of ['.env', '.env.local']) {
  const filePath = path.resolve(__dirname, file);
  if (!existsSync(filePath)) continue;
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !(match[1] in process.env)) process.env[match[1]] = match[2].trim();
  }
}

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
