/**
 * @draftorb/etl — Retention prune (D-044, SPECS §13).
 *
 * Deletes raw matches older than the retention window
 * (`patch_index <= latest - keepPatches`) and writes a permanent 'pruned'
 * tombstone into `match_rejects` so the data is never re-ingested. Deleting
 * a match cascades to `participants` and `item_events`. Rows are deleted
 * only for retention, never to express a weight.
 */

import type Database from 'better-sqlite3';

import { ETL_CONFIG } from './config/etl-config';
import { latestPatchIndex } from './patches';

export interface PruneOptions {
  /** Number of latest patches to keep. Defaults to `ETL_CONFIG.retentionPatches`. */
  keepPatches?: number;
  /** Count eligible rows without writing anything. */
  dryRun?: boolean;
}

export interface PruneResult {
  dryRun: boolean;
  keepPatches: number;
  /** Highest `patch_index` in `patches` (`null` when the table is empty). */
  latestPatchIndex: number | null;
  /** Matches with `patch_index <= cutoffPatchIndex` are pruned. */
  cutoffPatchIndex: number | null;
  /** Stored matches eligible for pruning. */
  candidates: number;
  /** Stored matches whose `patch` label has no `patch_index` (kept: age unknown). */
  skippedUnknownPatch: number;
  /** Matches actually deleted (0 on dry-run). */
  matchesPruned: number;
  /** Tombstones actually written (0 on dry-run). */
  tombstonesWritten: number;
}

interface PrunableMatch {
  match_id: string;
  patch: string;
}

/**
 * Prunes matches outside the retention window in ONE transaction: each
 * deleted match gets a 'pruned' tombstone (upserted, so `checked_at` is
 * refreshed) before the row is removed. Idempotent: pruned matches are gone
 * and their tombstones block re-ingestion, so a second run finds nothing.
 * Matches whose patch label is absent from `patches` cannot be proven old
 * and are kept.
 */
export function pruneMatches(db: Database.Database, options: PruneOptions = {}): PruneResult {
  const keepPatches = options.keepPatches ?? ETL_CONFIG.retentionPatches;
  const dryRun = options.dryRun ?? false;
  const latest = latestPatchIndex(db);

  const empty: PruneResult = {
    dryRun,
    keepPatches,
    latestPatchIndex: latest,
    cutoffPatchIndex: null,
    candidates: 0,
    skippedUnknownPatch: 0,
    matchesPruned: 0,
    tombstonesWritten: 0,
  };
  if (latest === null) return empty;

  const cutoff = latest - keepPatches;
  const rows = db
    .prepare(
      `SELECT m.match_id, m.patch
       FROM matches m
       JOIN patches p ON p.version_label = m.patch
       WHERE p.patch_index <= ?`,
    )
    .all(cutoff) as PrunableMatch[];
  const unresolvable = db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM matches m
       LEFT JOIN patches p ON p.version_label = m.patch
       WHERE p.patch_index IS NULL`,
    )
    .get() as { n: number };

  const result: PruneResult = {
    ...empty,
    cutoffPatchIndex: cutoff,
    candidates: rows.length,
    skippedUnknownPatch: unresolvable.n,
  };
  if (dryRun || rows.length === 0) return result;

  const upsertTombstone = db.prepare(
    `INSERT INTO match_rejects (match_id, reason, patch, checked_at)
     VALUES (?, 'pruned', ?, ?)
     ON CONFLICT(match_id) DO UPDATE SET
       reason = 'pruned',
       patch = excluded.patch,
       checked_at = excluded.checked_at`,
  );
  const deleteMatch = db.prepare('DELETE FROM matches WHERE match_id = ?');
  const checkedAt = Date.now();

  const write = db.transaction(() => {
    for (const row of rows) {
      upsertTombstone.run(row.match_id, row.patch, checkedAt);
      deleteMatch.run(row.match_id);
    }
  });
  write.immediate();

  result.matchesPruned = rows.length;
  result.tombstonesWritten = rows.length;
  return result;
}
