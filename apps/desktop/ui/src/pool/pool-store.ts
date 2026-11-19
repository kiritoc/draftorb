import type { PoolConfig } from '@draftorb/shared';
import { invokeCommand, isTauri } from '../tauri';
import { emptyPool, parsePoolConfig, serializePoolConfig } from './pool-model';

const POOL_FILE = 'pool.json';

let memoryPool: string | null = null;

/** The program-stored pool (D-101); a plain browser keeps it in memory. */
export async function loadPool(): Promise<{ pool: PoolConfig; notice?: string }> {
  try {
    const raw = isTauri()
      ? await invokeCommand<string>('load_app_file', { name: POOL_FILE })
      : memoryPool;
    // The shell returns "" for a missing file: that is a first launch, not corruption.
    return parsePoolConfig(raw === '' ? null : raw);
  } catch {
    return parsePoolConfig('{');
  }
}

export async function savePool(pool: PoolConfig): Promise<void> {
  const raw = serializePoolConfig(pool);
  if (!isTauri()) {
    memoryPool = raw;
    return;
  }
  await invokeCommand('save_app_file', { name: POOL_FILE, json: raw });
}

export { emptyPool };
