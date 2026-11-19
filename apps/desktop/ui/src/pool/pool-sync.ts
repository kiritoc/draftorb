import type { PoolConfig } from '@draftorb/shared';
import { poolDiffers } from './pool-model';
import type { RepoPoolResult } from './repo-pool';

export type PoolSyncStatus =
  | { kind: 'noFolder' }
  | { kind: 'missingFile' }
  | { kind: 'invalid'; notice: string }
  | { kind: 'inSync' }
  | { kind: 'differs' };

/** `repoResult` is null when no repo folder is set (SPECS §19.3, D-118: warning only). */
export function poolSyncStatus(
  programPool: PoolConfig,
  repoResult: RepoPoolResult | null,
): PoolSyncStatus {
  if (repoResult === null) return { kind: 'noFolder' };
  if (repoResult.notice !== undefined) return { kind: 'invalid', notice: repoResult.notice };
  if (repoResult.missing) return { kind: 'missingFile' };
  return poolDiffers(programPool, repoResult.pool) ? { kind: 'differs' } : { kind: 'inSync' };
}
