/**
 * @draftorb/etl — DB writes for pair & lane aggregation.
 *
 * Split out of aggregate-pairs.ts (file size); pure move, no logic change.
 */

import type Database from 'better-sqlite3';

import type { PairTableResult } from './aggregate-pairs-types';

/** Clears the four tables and rewrites them in one transaction (idempotent). */
export function writePairTables(db: Database.Database, result: PairTableResult): void {
  const clearPairAlly = db.prepare('DELETE FROM pair_ally');
  const clearPairEnemy = db.prepare('DELETE FROM pair_enemy');
  const clearLaneVs = db.prepare('DELETE FROM lane_vs');
  const clearLaneFull = db.prepare('DELETE FROM lane_full');

  const insertPairAlly = db.prepare(
    `INSERT INTO pair_ally (
      my_champion_id, my_role, other_champion_id, other_role, rank_bucket, wins_w, games_w, games_w2
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertPairEnemy = db.prepare(
    `INSERT INTO pair_enemy (
      my_champion_id, my_role, other_champion_id, other_role, rank_bucket, wins_w, games_w, games_w2
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertLaneVs = db.prepare(
    `INSERT INTO lane_vs (
      my_champion_id, my_role, opp1_id, opp2_id, rank_bucket, wins_w, games_w, games_w2
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertLaneFull = db.prepare(
    `INSERT INTO lane_full (
      my_champion_id, my_role, partner_id, opp1_id, opp2_id, rank_bucket, wins_w, games_w, games_w2
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const write = db.transaction(() => {
    clearPairAlly.run();
    clearPairEnemy.run();
    clearLaneVs.run();
    clearLaneFull.run();
    for (const row of result.pairAlly) {
      insertPairAlly.run(
        row.championId,
        row.myRole,
        row.otherChampionId,
        row.otherRole,
        row.rankBucket,
        row.winsW,
        row.gamesW,
        row.gamesW2,
      );
    }
    for (const row of result.pairEnemy) {
      insertPairEnemy.run(
        row.championId,
        row.myRole,
        row.otherChampionId,
        row.otherRole,
        row.rankBucket,
        row.winsW,
        row.gamesW,
        row.gamesW2,
      );
    }
    for (const row of result.laneVs) {
      insertLaneVs.run(
        row.championId,
        row.myRole,
        row.opp1Id,
        row.opp2Id,
        row.rankBucket,
        row.winsW,
        row.gamesW,
        row.gamesW2,
      );
    }
    for (const row of result.laneFull) {
      insertLaneFull.run(
        row.championId,
        row.myRole,
        row.partnerId,
        row.opp1Id,
        row.opp2Id,
        row.rankBucket,
        row.winsW,
        row.gamesW,
        row.gamesW2,
      );
    }
  });
  write.immediate();
}
