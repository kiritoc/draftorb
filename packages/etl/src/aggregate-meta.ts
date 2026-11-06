/**
 * @draftorb/etl — Aggregate snapshot metadata (D-055).
 *
 * `pnpm etl aggregate` records which patch catalog state its output was
 * computed against, so a published snapshot stays explainable after the
 * `patches` table later grows. The record lives in `ingest_state` under
 * `AGGREGATE_SNAPSHOT_KEY` and is exported verbatim as `patch-meta.json`.
 */

import type Database from 'better-sqlite3';

import { AGGREGATE_SNAPSHOT_KEY } from './patches';

/**
 * Patch-catalog metadata of one aggregate run: which label was aggregated,
 * its `patch_index`, the `currentPatchIndex` used for recency, and the
 * catalog's max index at the time.
 */
export interface AggregateSnapshotMeta {
  /** Snapshot patch label (explicit argument or latest stored patch), null when none. */
  patch: string | null;
  /** `patch_index` of `patch` in the catalog (`null` when unresolvable). */
  patchIndex: number | null;
  /** `currentPatchIndex` the aggregators used for recency (-1 when empty). */
  currentPatchIndex: number;
  /** Highest `patch_index` in `patches` at aggregate time (`null` when empty). */
  patchesMaxIndex: number | null;
  /** ISO timestamp of the aggregate run. */
  aggregatedAt: string;
}

/** Persists the aggregate snapshot metadata in `ingest_state` (upsert). */
export function recordAggregateSnapshot(db: Database.Database, meta: AggregateSnapshotMeta): void {
  db.prepare(
    `INSERT INTO ingest_state (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(AGGREGATE_SNAPSHOT_KEY, JSON.stringify(meta));
}

/** Reads the recorded aggregate snapshot metadata (`undefined` when absent). */
export function readAggregateSnapshot(db: Database.Database): AggregateSnapshotMeta | undefined {
  const row = db
    .prepare('SELECT value FROM ingest_state WHERE key = ?')
    .get(AGGREGATE_SNAPSHOT_KEY) as { value: string } | undefined;
  if (row === undefined) return undefined;
  try {
    const parsed = JSON.parse(row.value) as Partial<AggregateSnapshotMeta>;
    if (typeof parsed.currentPatchIndex !== 'number') return undefined;
    return {
      patch: typeof parsed.patch === 'string' ? parsed.patch : null,
      patchIndex: typeof parsed.patchIndex === 'number' ? parsed.patchIndex : null,
      currentPatchIndex: parsed.currentPatchIndex,
      patchesMaxIndex: typeof parsed.patchesMaxIndex === 'number' ? parsed.patchesMaxIndex : null,
      aggregatedAt: typeof parsed.aggregatedAt === 'string' ? parsed.aggregatedAt : '',
    };
  } catch {
    return undefined;
  }
}
