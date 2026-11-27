/**
 * @draftorb/etl — Pool config loading (BL-023, D-102, D-114, SPECS §19.3).
 *
 * Reads and validates the committed `data/pool.config.json`, the public copy
 * of the player's champion pool (champion x roles). The scheduled pipeline
 * reads only this file — never the program's pool store — and a missing file
 * is normal (no pool configured), not an error.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { poolConfigSchema, type PoolConfig } from '@draftorb/shared';

import { defaultDataDir } from './config/paths';

export const POOL_CONFIG_ENV_VAR = 'DRAFTORB_POOL_CONFIG_PATH';

/** Default pool config path: `<repo>/data/pool.config.json` (D-114). */
export function defaultPoolConfigPath(): string {
  return join(defaultDataDir(), 'pool.config.json');
}

/** Pool config path (explicit arg, env override, repo default). No mkdir. */
export function poolConfigPathFromEnv(explicit?: string): string {
  return resolve(explicit ?? process.env[POOL_CONFIG_ENV_VAR] ?? defaultPoolConfigPath());
}

/**
 * Load and validate the pool config. Returns `null` when the file does not
 * exist; throws on unreadable, malformed or schema-invalid content so the
 * caller can warn and continue without pool priority.
 */
export function loadPoolConfig(configPath = poolConfigPathFromEnv()): PoolConfig | null {
  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw new Error(
      `Cannot read pool config at ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Pool config at ${configPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return poolConfigSchema.parse(parsed);
}
