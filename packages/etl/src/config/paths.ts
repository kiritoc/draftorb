import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

export function resolveRepoRoot(start = process.cwd()): string {
  let dir = resolve(start);
  for (;;) {
    const candidate = join(dir, 'pnpm-workspace.yaml');
    if (existsSync(candidate)) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('Could not find repository root containing pnpm-workspace.yaml.');
    }
    dir = parent;
  }
}

export function resolveDbPath(explicit?: string): string {
  const chosen = explicit ?? process.env.DRAFTORB_DB_PATH ?? join(resolveRepoRoot(), 'data', 'DraftOrb.sqlite');
  const resolved = resolve(chosen);
  mkdirSync(dirname(resolved), { recursive: true });
  return resolved;
}
