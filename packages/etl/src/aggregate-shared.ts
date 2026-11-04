/**
 * @draftorb/etl — Shared helpers for the aggregation modules.
 *
 * The four aggregators (role_prob, baseline, pair/lane tables, rune contexts)
 * share the same patch-window, weighting and streaming patterns; these
 * helpers centralise them (audit batch 3, no behavior change).
 */

import type Database from 'better-sqlite3';

import { RANK_BUCKET_ORDER } from '@draftorb/engine';
import { comparePatches } from './matches-store';

/** Patches are stored as "major.minor" (RIOT_API.md). Re-exported by ./aggregate. */
export const PATCH_PATTERN = /^\d+\.\d+$/;

/** Throws the existing `Invalid patch "${patch}". Expected a format like "16.21".` error. */
export function assertPatchFormat(patch: string | undefined): void {
  if (patch !== undefined && !PATCH_PATTERN.test(patch)) {
    throw new Error(`Invalid patch "${patch}". Expected a format like "16.21".`);
  }
}

export interface PatchWindow {
  patches: readonly string[]; // sorted with comparePatches
  patchIndex: ReadonlyMap<string, number>; // dense index
  currentPatchIndex: number; // patches.length - 1
}

/**
 * Distinct stored patches <= snapshot (numeric compare in JS), plus the
 * snapshot itself when at least one stored patch qualifies.
 *
 * Patch -> numeric index. Only distinct stored patches are indexed (dense),
 * so a gap in collected patches counts as one step of recency decay.
 * comparePatches is numeric, so the snapshot filter is applied in JS
 * (SQL string comparison would misorder "16.9" and "16.10").
 */
export function loadPatchWindow(db: Database.Database, snapshotPatch?: string): PatchWindow {
  const storedPatches = (
    db.prepare('SELECT DISTINCT patch FROM matches').all() as Array<{ patch: string }>
  )
    .map((row) => row.patch)
    .filter((patch) => snapshotPatch === undefined || comparePatches(patch, snapshotPatch) <= 0);
  const patchSet = new Set(storedPatches);
  if (snapshotPatch !== undefined && patchSet.size > 0) patchSet.add(snapshotPatch);
  const patches = [...patchSet].sort(comparePatches);
  const patchIndex = new Map<string, number>();
  patches.forEach((patch, i) => {
    patchIndex.set(patch, i);
  });
  return { patches, patchIndex, currentPatchIndex: patches.length - 1 };
}

/** rank_score scale: integer part = RANK_BUCKET_ORDER index (6.5 = DIAMOND); clamped to [0, last bucket]. */
export function gameBucketIndex(rankScore: number): number {
  return Math.max(0, Math.min(Math.floor(rankScore), RANK_BUCKET_ORDER.length - 1));
}

export interface WeightedCounts {
  winsW: number;
  gamesW: number;
  gamesW2: number;
}

/**
 * Get-or-create `map.get(key)` via `create()` (which returns the row with
 * zeroed counts), then add winsW += w*win, gamesW += w, gamesW2 += w*w.
 * Returns the row so callers can bump extra fields (`games += 1`,
 * `puuids.add(...)`).
 */
export function accumulateWeighted<T extends WeightedCounts>(
  map: Map<string, T>,
  key: string,
  w: number,
  win: number,
  create: () => T,
): T {
  let row = map.get(key);
  if (row === undefined) {
    row = create();
    map.set(key, row);
  }
  row.winsW += w * win;
  row.gamesW += w;
  row.gamesW2 += w * w;
  return row;
}

/**
 * Yields consecutive rows sharing the same matchId (input must be ORDER BY
 * match_id). Streams: holds only one match in memory.
 */
export function* groupRowsByMatch<R extends { matchId: string }>(
  rows: Iterable<R>,
): Generator<R[]> {
  let current: R[] | undefined;
  for (const row of rows) {
    if (current === undefined || (current[0] as R).matchId !== row.matchId) {
      if (current !== undefined) yield current;
      current = [row];
    } else {
      current.push(row);
    }
  }
  if (current !== undefined) yield current;
}

/** teamId -> participants, preserving input order. */
export function partitionByTeam<P extends { teamId: number }>(
  participants: readonly P[],
): Map<number, P[]> {
  const teams = new Map<number, P[]>();
  for (const p of participants) {
    const team = teams.get(p.teamId);
    if (team === undefined) {
      teams.set(p.teamId, [p]);
    } else {
      team.push(p);
    }
  }
  return teams;
}
