/**
 * @draftorb/etl — Shared helpers for the aggregation modules.
 *
 * The four aggregators (role_prob, baseline, pair/lane tables, rune contexts)
 * share the same patch-window, weighting and streaming patterns; these
 * helpers centralise them (audit batch 3, no behavior change).
 */

import type Database from 'better-sqlite3';

import { RANK_BUCKET_ORDER } from '@draftorb/engine';

/** Patches are stored as "major.minor" (RIOT_API.md). Re-exported by ./aggregate. */
export const PATCH_PATTERN = /^\d+\.\d+$/;

/** Throws the existing `Invalid patch "${patch}". Expected a format like "16.21".` error. */
export function assertPatchFormat(patch: string | undefined): void {
  if (patch !== undefined && !PATCH_PATTERN.test(patch)) {
    throw new Error(`Invalid patch "${patch}". Expected a format like "16.21".`);
  }
}

export interface PatchWindow {
  patches: readonly string[]; // version labels, sorted by patch_index
  patchIndex: ReadonlyMap<string, number>; // version_label -> patch_index (<= bound)
  currentPatchIndex: number; // snapshot index, else max stored patch_index (-1 when empty)
  snapshotIndex?: number; // resolved patch_index of the snapshot patch
}

/**
 * Patch window from the `patches` table (D-043, SPECS §12): `patch_index` is
 * the real release ordinal, so gaps between collected patches count as real
 * patch distance (supersedes D-033's dense-over-stored-patches index).
 *
 * The window covers every `patches` row with `patch_index <= bound`, where
 * bound is the snapshot index (or +infinity). `currentPatchIndex` is the
 * snapshot index when given — promoted even with no stored games at it, as
 * before — else the highest `patch_index` among stored matches. Stored match
 * labels absent from `patches` cannot be ordered and are excluded.
 */
export function loadPatchWindow(db: Database.Database, snapshotPatch?: string): PatchWindow {
  const allPatches = db
    .prepare('SELECT version_label, patch_index FROM patches ORDER BY patch_index')
    .all() as Array<{ version_label: string; patch_index: number }>;
  const indexByLabel = new Map(allPatches.map((row) => [row.version_label, row.patch_index]));

  let snapshotIndex: number | undefined;
  if (snapshotPatch !== undefined) {
    snapshotIndex = indexByLabel.get(snapshotPatch);
    if (snapshotIndex === undefined) {
      throw new Error(
        `Unknown patch "${snapshotPatch}": not present in the patches table (run \`pnpm etl aggregate\` to refresh it).`,
      );
    }
  }

  const storedLabels = (
    db.prepare('SELECT DISTINCT patch FROM matches').all() as Array<{ patch: string }>
  ).map((row) => row.patch);

  const inWindow = storedLabels
    .map((label) => ({ label, index: indexByLabel.get(label) }))
    .filter(
      (entry): entry is { label: string; index: number } =>
        entry.index !== undefined && (snapshotIndex === undefined || entry.index <= snapshotIndex),
    );

  if (inWindow.length === 0) {
    return { patches: [], patchIndex: new Map(), currentPatchIndex: -1, snapshotIndex };
  }

  const bound = snapshotIndex ?? Math.max(...inWindow.map((entry) => entry.index));
  const patchIndex = new Map<string, number>();
  const patches: string[] = [];
  for (const row of allPatches) {
    if (row.patch_index > bound) break;
    patchIndex.set(row.version_label, row.patch_index);
    patches.push(row.version_label);
  }
  return { patches, patchIndex, currentPatchIndex: bound, snapshotIndex };
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
