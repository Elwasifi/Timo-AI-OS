// Node loader hook for local admin scripts (no tsx / ts-node is installed): resolves the project's "@/..." alias and
// extension-less relative imports to .ts files. Used together with Node's built-in TypeScript support:
//   node --experimental-transform-types --import ./scripts/register-ts-alias.mjs scripts/<script>.ts
// Local tooling only — nothing in the app imports this file.

import { registerHooks } from 'node:module';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function resolveFile(base) {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    let base = null;
    if (specifier.startsWith('@/')) {
      base = path.join(root, specifier.slice(2));
    } else if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL && context.parentURL.startsWith('file:') && !context.parentURL.includes('/node_modules/')) {
      base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    }
    if (base) {
      const file = resolveFile(base);
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
