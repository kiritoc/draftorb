/**
 * @draftorb/etl — Baseline aggregation (rank-weighted, role-generic).
 *
 * Computes `baseline` rows per (champion, my_role, user rank bucket) using the
 * engine rank kernel (SPECS §3). Each stored game contributes to every user
 * bucket row, weighted by its similarity to that bucket:
 *
 *   w = rankDistanceWeight(gameBucket, userBucket, tau, rankWindowTiers)
 *     * recencyFactor(patchIndex, currentPatchIndex, decay)
 *     * reliabilityFactor(rankKnownCount, unknownRankCount)
 *
 * Weighted counts are accumulated per row: `wins_w = sum(w * win)`,
 * `games_w = sum(w)`, `games_w2 = sum(w^2)`, `games` = raw count of
 * contributing games. The engine computes `n_eff = games_w^2 / games_w2` and
 * equivalent counts at query time (packages/engine/src/weighting.ts).
 *
 * The table is cleared and rewritten, so the command is idempotent.
 */

import type Database from 'better-sqlite3';

import type { RankBucket } from '@draftorb/shared';
import {
  DEFAULT_CONFIG,
  RANK_BUCKET_ORDER,
  bucketIndex,
  combinedGameWeight,
  type RankWeightingConfig,
} from '@draftorb/engine';
import { PATCH_PATTERN } from './aggregate';
import { comparePatches } from './matches-store';

export interface BaselineRow {
  championId: number;
  myRole: string;
  rankBucket: RankBucket;
  winsW: number;
  gamesW: number;
  gamesW2: number;
  games: number;
}

export interface AggregateBaselineOptions {
  config?: RankWeightingConfig;
  /** Snapshot patch: newer matches are excluded and recency is relative to it. */
  patch?: string;
}

export function aggregateBaseline(
  db: Database.Database,
  options: AggregateBaselineOptions = {},
): BaselineRow[] {
  const config = options.config ?? DEFAULT_CONFIG;
  if (options.patch !== undefined && !PATCH_PATTERN.test(options.patch)) {
    throw new Error(`Invalid patch "${options.patch}". Expected a format like "16.21".`);
  }

  const snapshotPatch = options.patch;

  // Patch -> numeric index. Only distinct stored patches are indexed (dense),
  // so a gap in collected patches counts as one step of recency decay.
  // comparePatches is numeric, so the snapshot filter is applied in JS
  // (SQL string comparison would misorder "16.9" and "16.10").
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
  const currentPatchIndex = patches.length - 1;
  const maxBucket = RANK_BUCKET_ORDER.length - 1;

  // Key: `${championId}|${myRole}|${rankBucket}`
  const accum = new Map<
    string,
    {
      championId: number;
      myRole: string;
      rankBucket: RankBucket;
      winsW: number;
      gamesW: number;
      gamesW2: number;
      games: number;
    }
  >();

  // Streamed with iterate() so the full participants table is never held in memory.
  // matches.avg_rank_score and participants.role are NOT NULL (migrations 001/004).
  const rows = db
    .prepare(
      `SELECT
         p.champion_id AS championId,
         p.role AS myRole,
         p.win AS win,
         m.avg_rank_score AS rankScore,
         m.patch AS patch,
         m.rank_known_count AS rankKnownCount
       FROM participants p
       JOIN matches m ON m.match_id = p.match_id`,
    )
    .iterate() as IterableIterator<{
    championId: number;
    myRole: string;
    win: number;
    rankScore: number;
    patch: string;
    rankKnownCount: number;
  }>;

  for (const row of rows) {
    // Newer-than-snapshot patches are absent from patchIndex and skipped here.
    const pIdx = patchIndex.get(row.patch);
    if (pIdx === undefined) continue;

    // rank_score scale: integer part = RANK_BUCKET_ORDER index (6.5 = DIAMOND).
    const gameBucketIdx = Math.max(0, Math.min(Math.floor(row.rankScore), maxBucket));

    for (const rankBucket of RANK_BUCKET_ORDER) {
      const uIdx = bucketIndex(rankBucket);
      const w = combinedGameWeight(
        gameBucketIdx,
        uIdx,
        pIdx,
        currentPatchIndex,
        row.rankKnownCount,
        config,
      );
      if (w <= 0) continue;

      const key = `${row.championId}|${row.myRole}|${rankBucket}`;
      const existing = accum.get(key);
      if (existing === undefined) {
        accum.set(key, {
          championId: row.championId,
          myRole: row.myRole,
          rankBucket,
          winsW: w * row.win,
          gamesW: w,
          gamesW2: w * w,
          games: 1,
        });
      } else {
        existing.winsW += w * row.win;
        existing.gamesW += w;
        existing.gamesW2 += w * w;
        existing.games += 1;
      }
    }
  }

  const result: BaselineRow[] = [];
  for (const entry of accum.values()) {
    result.push({
      championId: entry.championId,
      myRole: entry.myRole,
      rankBucket: entry.rankBucket,
      winsW: entry.winsW,
      gamesW: entry.gamesW,
      gamesW2: entry.gamesW2,
      games: entry.games,
    });
  }

  // No contributing games (empty DB or a snapshot older than every stored match):
  // keep existing baselines, matching aggregateRoleProb's "left unchanged" behavior.
  if (result.length === 0) return result;

  const clear = db.prepare('DELETE FROM baseline');
  const insert = db.prepare(
    `INSERT INTO baseline (
      champion_id, my_role, rank_bucket, wins_w, games_w, games_w2, games
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const write = db.transaction(() => {
    clear.run();
    for (const row of result) {
      insert.run(
        row.championId,
        row.myRole,
        row.rankBucket,
        row.winsW,
        row.gamesW,
        row.gamesW2,
        row.games,
      );
    }
  });
  write.immediate();

  return result;
}
