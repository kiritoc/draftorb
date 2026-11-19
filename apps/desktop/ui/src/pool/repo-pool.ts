import type { PoolConfig } from '@draftorb/shared';
import { strings } from '../strings';
import { invokeCommand, isTauri } from '../tauri';
import { emptyPool, parsePoolConfig, serializePoolConfig } from './pool-model';

export interface RepoPoolResult {
  pool: PoolConfig;
  notice?: string;
  /** True when the repo file does not exist (normal, no warning). */
  missing: boolean;
}

function errorText(error: unknown): string {
  return typeof error === 'string' ? error : error instanceof Error ? error.message : String(error);
}

export async function readRepoPool(repoFolder: string): Promise<RepoPoolResult> {
  if (!isTauri()) return { pool: emptyPool(), notice: strings.repoUnavailable, missing: true };
  let raw: string | null;
  try {
    raw = await invokeCommand<string | null>('read_repo_pool', { repoFolder });
  } catch (error) {
    return { pool: emptyPool(), notice: errorText(error), missing: true };
  }
  if (raw === null) return { pool: emptyPool(), missing: true };
  const parsed = parsePoolConfig(raw);
  return {
    pool: parsed.pool,
    missing: false,
    ...(parsed.notice === undefined ? {} : { notice: strings.repoPoolInvalid }),
  };
}

export async function exportPoolToRepo(repoFolder: string, pool: PoolConfig): Promise<void> {
  if (!isTauri()) throw new Error(strings.repoUnavailable);
  await invokeCommand('write_repo_pool', { repoFolder, json: serializePoolConfig(pool) });
}
