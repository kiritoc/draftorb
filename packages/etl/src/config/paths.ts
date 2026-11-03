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
export const DB_ENV_VAR = 'DRAFTORB_DB_PATH';
// Kept as-is to avoid orphaning existing databases; centralised so renaming is a one-line change.
export const DEFAULT_DB_FILENAME = 'DraftOrb.sqlite';

/** Resolves the SQLite path (explicit arg, env override, repo default). No mkdir. */
export function dbPathFromEnv(explicit?: string): string {
  const chosen =
    explicit ?? process.env[DB_ENV_VAR] ?? join(resolveRepoRoot(), 'data', DEFAULT_DB_FILENAME);
  return resolve(chosen);
}

export function resolveDbPath(explicit?: string): string {
  const resolved = dbPathFromEnv(explicit);
  mkdirSync(dirname(resolved), { recursive: true });
  return resolved;
}
