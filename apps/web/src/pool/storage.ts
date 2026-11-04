/**
 * @draftorb/web — Champion pool persistence (D-024, SPECS §2.1).
 *
 * Per-role personal champion pool stored in browser localStorage under
 * `draftorb.pool.v1`, validated with `championPoolSchema`. Corrupted or
 * unreadable storage degrades gracefully to an empty pool instead of
 * crashing. Storage is injectable so the module can be tested without a DOM.
 */

import { championPoolSchema, type ChampionPool, type Role } from '@draftorb/shared';

export const POOL_STORAGE_KEY = 'draftorb.pool.v1';

export interface PoolStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const ALL_ROLES: readonly Role[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];

function defaultStorage(): PoolStorage {
  if (typeof globalThis.localStorage !== 'undefined') {
    return globalThis.localStorage;
  }
  return { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
}

/** Load and validate the pool. Returns null when absent, corrupt, or
 *  unreadable (corruption → empty pool, never a crash). */
export function loadPool(storage: PoolStorage = defaultStorage()): ChampionPool | null {
  try {
    const raw = storage.getItem(POOL_STORAGE_KEY);
    if (raw === null || raw === '') {
      return null;
    }
    return championPoolSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Persist the pool. Silently ignores storage errors (quota/blocked). */
export function savePool(pool: ChampionPool, storage: PoolStorage = defaultStorage()): void {
  try {
    storage.setItem(POOL_STORAGE_KEY, JSON.stringify(pool));
  } catch {
    // Storage blocked or over quota: pool lives in memory only this session.
  }
}

/** Remove the persisted pool. */
export function clearPool(storage: PoolStorage = defaultStorage()): void {
  try {
    storage.removeItem(POOL_STORAGE_KEY);
  } catch {
    // Ignore.
  }
}

/** Drop pool champion ids that are absent from the champion catalogue, and
 *  return the filtered pool plus the dropped ids (for a notice). */
export function filterPoolByCatalogue(
  pool: ChampionPool,
  championIds: readonly number[],
): { pool: ChampionPool; dropped: number[] } {
  const known = new Set(championIds);
  const dropped: number[] = [];
  const pools: Partial<Record<Role, number[]>> = {};
  for (const role of ALL_ROLES) {
    const ids = pool.pools[role] ?? [];
    const kept = ids.filter((id) => known.has(id));
    dropped.push(...ids.filter((id) => !known.has(id)));
    if (kept.length > 0) {
      pools[role] = kept;
    }
  }
  return { pool: { version: 1, pools: pools as ChampionPool['pools'] }, dropped };
}
