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

  const allRows = db
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
    .all() as Array<{
    championId: number;
    myRole: string;
    win: number;
    rankScore: number | null;
    patch: string;
    rankKnownCount: number;
  }>;

  const snapshotPatch = options.patch;
  const rows =
    snapshotPatch === undefined
      ? allRows
      : allRows.filter((row) => comparePatches(row.patch, snapshotPatch) <= 0);

  if (rows.length === 0) {
    const clear = db.prepare('DELETE FROM baseline');
    const write = db.transaction(() => {
      clear.run();
    });
    write.immediate();
    return [];
  }

  // Patch -> numeric index, sorted so newer patches have higher indices.
  const patchSet = new Set(rows.map((row) => row.patch));
  if (snapshotPatch !== undefined) patchSet.add(snapshotPatch);
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

  for (const row of rows) {
    const gameBucketIdx =
      row.rankScore === null ? null : Math.max(0, Math.min(Math.floor(row.rankScore), maxBucket));
    if (gameBucketIdx === null) continue;

    const pIdx = patchIndex.get(row.patch);
    if (pIdx === undefined) continue;

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
