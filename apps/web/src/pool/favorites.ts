/**
 * @draftorb/web — Profile favorites helpers (T-094, D-074, SPECS §18.4).
 *
 * Pure functions shared by the draft screen: appending the profile's
 * favorites into the SUPPORT pool (explicit user action, capped by
 * `poolMaxSize`, schema-validated) and applying the `favoritesMode`
 * display filter (`include` / `only` / `hide`) to already-computed
 * recommendation lists. The mode never touches engine output — it only
 * filters or flags what is rendered.
 */

import { championPoolSchema, type ChampionPool } from '@draftorb/shared';

import { poolMaxSize } from '../config.js';

export type FavoritesMode = 'include' | 'only' | 'hide';

export const FAVORITES_MODES: readonly FavoritesMode[] = ['include', 'only', 'hide'];

export interface FavoritesImportResult {
  pool: ChampionPool;
  /** Favorite ids appended to the SUPPORT pool. */
  added: number[];
  /** Favorite ids not added because the pool was already full. */
  skipped: number;
}

/** Append missing favorites to the SUPPORT pool, capped at `poolMaxSize`.
 *  Ids already present are kept as-is; the result is re-validated against
 *  `championPoolSchema` before it is returned. */
export function importFavoritesIntoPool(
  pool: ChampionPool | null,
  favoriteIds: readonly number[],
): FavoritesImportResult {
  const current = pool?.pools.SUPPORT ?? [];
  const present = new Set(current);
  const room = Math.max(0, poolMaxSize - current.length);
  const added: number[] = [];
  let skipped = 0;
  for (const id of favoriteIds) {
    if (present.has(id)) continue;
    if (added.length >= room) {
      skipped += 1;
      continue;
    }
    present.add(id);
    added.push(id);
  }
  const next: ChampionPool = {
    version: 1,
    pools: { ...(pool?.pools ?? {}), SUPPORT: [...current, ...added] },
  };
  return { pool: championPoolSchema.parse(next), added, skipped };
}

/** Display-level filter for the favorites mode. Returns a new array; the
 *  input order is preserved and `include` returns every entry (favorites
 *  are flagged with a badge by the caller instead). */
export function applyFavoritesMode<T extends { championId: number }>(
  entries: readonly T[],
  mode: FavoritesMode,
  favoriteIds: ReadonlySet<number>,
): T[] {
  if (mode === 'include') {
    return [...entries];
  }
  if (mode === 'only') {
    return entries.filter((entry) => favoriteIds.has(entry.championId));
  }
  return entries.filter((entry) => !favoriteIds.has(entry.championId));
}
