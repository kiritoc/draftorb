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

/** Default directory for ETL data files, resolved from the repository root. */
export function defaultDataDir(): string {
  return join(resolveRepoRoot(), 'data');
}

/** Default directory for public static data, resolved from the repository root. */
export function defaultPublicDataDir(): string {
  return join(resolveRepoRoot(), 'data', 'public');
}

/** Default directory for manual data files, resolved from the repository root. */
export function defaultManualDataDir(): string {
  return join(resolveRepoRoot(), 'data', 'manual');
}
export function resolveDbPath(explicit?: string): string {
  const chosen =
    explicit ?? process.env.DRAFTORB_DB_PATH ?? join(resolveRepoRoot(), 'data', 'DraftOrb.sqlite');
  const resolved = resolve(chosen);
  mkdirSync(dirname(resolved), { recursive: true });
  return resolved;
}
