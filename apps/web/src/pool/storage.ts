/**
 * @draftorb/web — Champion pool persistence (D-024, SPECS §2.1).
 *
 * Per-role personal champion pool stored in browser localStorage under
 * `draftorb.pool.v1`, validated with `championPoolSchema`. Corrupted or
 * unreadable storage degrades gracefully to an empty pool instead of
 * crashing. Storage is injectable so the module can be tested without a DOM.
 */

import { championPoolSchema, type ChampionPool, type Role } from '@draftorb/shared';
import { poolMaxSize } from '../config.js';

export const POOL_STORAGE_KEY = 'draftorb.pool.v1';

export interface PoolStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PoolReadResult {
  pool: ChampionPool | null;
  issue: 'corrupt' | 'unavailable' | null;
}

const ALL_ROLES: readonly Role[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];

function browserStorage(): PoolStorage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/** Load the pool and distinguish missing data from storage or schema failures. */
export function readPool(storage?: PoolStorage): PoolReadResult {
  try {
    const activeStorage = storage ?? browserStorage();
    if (activeStorage === null) {
      return { pool: null, issue: 'unavailable' };
    }
    const raw = activeStorage.getItem(POOL_STORAGE_KEY);
    if (raw === null || raw === '') {
      return { pool: null, issue: null };
    }
    try {
      const pool = championPoolSchema.parse(JSON.parse(raw));
      if (Object.values(pool.pools).some((ids) => ids.length > poolMaxSize)) {
        return { pool: null, issue: 'corrupt' };
      }
      return { pool, issue: null };
    } catch {
      return { pool: null, issue: 'corrupt' };
    }
  } catch {
    return { pool: null, issue: 'unavailable' };
  }
}

/** Load and validate the pool. Returns null when absent, corrupt, or unreadable. */
export function loadPool(storage?: PoolStorage): ChampionPool | null {
  return readPool(storage).pool;
}

/** Persist the pool and report whether browser storage accepted the write. */
export function savePool(pool: ChampionPool, storage?: PoolStorage): boolean {
  try {
    const activeStorage = storage ?? browserStorage();
    if (activeStorage === null) {
      return false;
    }
    activeStorage.setItem(POOL_STORAGE_KEY, JSON.stringify(pool));
    return true;
  } catch {
    return false;
  }
}

/** Remove the persisted pool and report whether browser storage accepted it. */
export function clearPool(storage?: PoolStorage): boolean {
  try {
    const activeStorage = storage ?? browserStorage();
    if (activeStorage === null) {
      return false;
    }
    activeStorage.removeItem(POOL_STORAGE_KEY);
    return true;
  } catch {
    return false;
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
