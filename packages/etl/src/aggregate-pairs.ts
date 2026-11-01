/**
 * @draftorb/etl — Pair & lane aggregation (role-generic).
 *
 * Computes `pair_ally`, `pair_enemy`, `lane_vs` and `lane_full` rows per
 * (champion, my_role, user rank bucket) using the engine rank kernel
 * (SPECS §3 / D-021). Each stored game contributes weighted by
 * `combinedGameWeight` (rank distance × recency × reliability).
 *
 * Lane keys follow `laneGroup(my_role).enemies` order (DATA_MODEL.md):
 *   SUPPORT: opp1 = enemy SUPPORT, opp2 = enemy ADC
 *   ADC:     opp1 = enemy ADC,     opp2 = enemy SUPPORT
 *   TOP/MID/JUNGLE (1v1): opp2 is NULL; `lane_full` is skipped.
 *
 * `partner_id` = `laneGroup(my_role).allies[0]` (ally lane partner; NULL for 1v1).
 *
 * The tables are cleared and rewritten, so the command is idempotent.
 */

import type Database from 'better-sqlite3';

import type { RankBucket } from '@draftorb/shared';
import {
  DEFAULT_CONFIG,
  DEFAULT_LANE_GROUPS,
  RANK_BUCKET_ORDER,
  bucketIndex,
  combinedGameWeight,
  type RankWeightingConfig,
} from '@draftorb/engine';
import { PATCH_PATTERN } from './aggregate';
import { comparePatches } from './matches-store';

export interface PairRow {
  championId: number;
  myRole: string;
  otherChampionId: number;
  otherRole: string;
  rankBucket: RankBucket;
  winsW: number;
  gamesW: number;
  gamesW2: number;
  games: number;
}

export interface LaneVsRow {
  championId: number;
  myRole: string;
  opp1Id: number;
  opp2Id: number | null;
  rankBucket: RankBucket;
  winsW: number;
  gamesW: number;
  gamesW2: number;
  games: number;
}

export interface LaneFullRow {
  championId: number;
  myRole: string;
  partnerId: number | null;
  opp1Id: number;
  opp2Id: number;
  rankBucket: RankBucket;
  winsW: number;
  gamesW: number;
  gamesW2: number;
  games: number;
}

export interface AggregatePairTablesOptions {
  config?: RankWeightingConfig;
  /** Snapshot patch: newer matches are excluded and recency is relative to it. */
  patch?: string;
}

export interface PairTableResult {
  pairAlly: PairRow[];
  pairEnemy: PairRow[];
  laneVs: LaneVsRow[];
  laneFull: LaneFullRow[];
}

/** All participants of one match, plus match-level fields. */
interface ToyMatch {
  matchId: string;
  patch: string;
  rankKnownCount: number;
  rankScore: number;
  participants: Array<{
    championId: number;
    role: string;
    win: number;
    teamId: number;
    puuid: string;
    rankScore: number;
  }>;
}

export function aggregatePairTables(
  db: Database.Database,
  options: AggregatePairTablesOptions = {},
): PairTableResult {
  const config = options.config ?? DEFAULT_CONFIG;
  if (options.patch !== undefined && !PATCH_PATTERN.test(options.patch)) {
    throw new Error(`Invalid patch "${options.patch}". Expected a format like "16.21".`);
  }

  const snapshotPatch = options.patch;

  // Patch -> dense index over stored patches <= snapshotPatch.
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

  // --- accumulators keyed by composite id ---
  const pairAlly = new Map<string, PairRow>();
  const pairEnemy = new Map<string, PairRow>();
  const laneVs = new Map<string, LaneVsRow>();
  const laneFull = new Map<string, LaneFullRow>();

  const addPair = (
    map: Map<string, PairRow>,
    championId: number,
    myRole: string,
    otherChampionId: number,
    otherRole: string,
    rankBucket: RankBucket,
    win: number,
    w: number,
  ): void => {
    const key = `${championId}|${myRole}|${otherChampionId}|${otherRole}|${rankBucket}`;
    const existing = map.get(key);
    if (existing === undefined) {
      map.set(key, {
        championId,
        myRole,
        otherChampionId,
        otherRole,
        rankBucket,
        winsW: w * win,
        gamesW: w,
        gamesW2: w * w,
        games: 1,
      });
    } else {
      existing.winsW += w * win;
      existing.gamesW += w;
      existing.gamesW2 += w * w;
      existing.games += 1;
    }
  };

  const addLaneVs = (
    championId: number,
    myRole: string,
    opp1Id: number,
    opp2Id: number | null,
    rankBucket: RankBucket,
    win: number,
    w: number,
  ): void => {
    const key = `${championId}|${myRole}|${opp1Id}|${opp2Id === null ? -1 : opp2Id}|${rankBucket}`;
    const existing = laneVs.get(key);
    if (existing === undefined) {
      laneVs.set(key, {
        championId,
        myRole,
        opp1Id,
        opp2Id,
        rankBucket,
        winsW: w * win,
        gamesW: w,
        gamesW2: w * w,
        games: 1,
      });
    } else {
      existing.winsW += w * win;
      existing.gamesW += w;
      existing.gamesW2 += w * w;
      existing.games += 1;
    }
  };

  const addLaneFull = (
    championId: number,
    myRole: string,
    partnerId: number | null,
    opp1Id: number,
    opp2Id: number,
    rankBucket: RankBucket,
    win: number,
    w: number,
  ): void => {
    const key = `${championId}|${myRole}|${partnerId === null ? -1 : partnerId}|${opp1Id}|${opp2Id}|${rankBucket}`;
    const existing = laneFull.get(key);
    if (existing === undefined) {
      laneFull.set(key, {
        championId,
        myRole,
        partnerId,
        opp1Id,
        opp2Id,
        rankBucket,
        winsW: w * win,
        gamesW: w,
        gamesW2: w * w,
        games: 1,
      });
    } else {
      existing.winsW += w * win;
      existing.gamesW += w;
      existing.gamesW2 += w * w;
      existing.games += 1;
    }
  };

  const findByRole = (
    participants: Array<{ championId: number; role: string }>,
    role?: string,
  ): number | null => {
    if (!role) return null;
    const found = participants.find((p) => p.role === role);
    return found ? found.championId : null;
  };

  const sortByLaneOrder = (
    participants: Array<{ championId: number; role: string }>,
    order: readonly string[],
  ): Array<{ championId: number; role: string }> => {
    return [...participants].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
  };

  // Stream all participants with match info, grouped by match so lane context
  // (which needs all participants of a match) can be resolved.
  const rows = db
    .prepare(
      `SELECT
         p.match_id AS matchId,
         p.champion_id AS championId,
         p.role AS role,
         p.win AS win,
         p.team_id AS teamId,
         p.puuid AS puuid,
         m.patch AS patch,
         m.rank_known_count AS rankKnownCount,
         m.avg_rank_score AS rankScore
       FROM participants p
       JOIN matches m ON m.match_id = p.match_id
       ORDER BY p.match_id`,
    )
    .iterate() as IterableIterator<{
    matchId: string;
    championId: number;
    role: string;
    win: number;
    teamId: number;
    puuid: string;
    patch: string;
    rankKnownCount: number;
    rankScore: number;
  }>;

  const matches = new Map<string, ToyMatch>();
  for (const row of rows) {
    const pIdx = patchIndex.get(row.patch);
    if (pIdx === undefined) continue;
    let match = matches.get(row.matchId);
    if (match === undefined) {
      match = {
        matchId: row.matchId,
        patch: row.patch,
        rankKnownCount: row.rankKnownCount,
        rankScore: row.rankScore,
        participants: [],
      };
      matches.set(row.matchId, match);
    }
    match.participants.push({
      championId: row.championId,
      role: row.role,
      win: row.win,
      teamId: row.teamId,
      puuid: row.puuid,
      rankScore: row.rankScore,
    });
  }

  for (const match of matches.values()) {
    const pIdx = patchIndex.get(match.patch);
    // pIdx is guaranteed defined (we filtered while streaming).
    const recencyBase = pIdx === undefined ? 0 : pIdx;

    // Partition participants by team.
    const teams = new Map<
      number,
      Array<{ championId: number; role: string; win: number; puuid: string; rankScore: number }>
    >();
    for (const p of match.participants) {
      const team = teams.get(p.teamId);
      if (team === undefined) {
        teams.set(p.teamId, [p]);
      } else {
        team.push(p);
      }
    }

    for (const me of match.participants) {
      const myTeam = teams.get(me.teamId)!;
      const allies = myTeam.filter((p) => p.puuid !== me.puuid);
      const enemyTeams = [...teams.values()].filter((t) => t !== myTeam);
      const enemies = enemyTeams.flat();

      const laneGroup = DEFAULT_LANE_GROUPS[me.role as keyof typeof DEFAULT_LANE_GROUPS];
      const sortedAllies = sortByLaneOrder(allies, laneGroup.allies);
      const sortedEnemies = sortByLaneOrder(enemies, laneGroup.enemies);

      const opp1 = findByRole(sortedEnemies, laneGroup.enemies[0]);
      let opp2: number | null = null;
      if (!laneGroup.oneToOne) {
        opp2 = findByRole(sortedEnemies, laneGroup.enemies[1]);
      }

      const laneVsComplete = opp1 !== null && (laneGroup.oneToOne || opp2 !== null);

      const gameBucketIdx = Math.max(0, Math.min(Math.floor(me.rankScore), maxBucket));
      const win = me.win;

      for (const rankBucket of RANK_BUCKET_ORDER) {
        const uIdx = bucketIndex(rankBucket);
        const w = combinedGameWeight(
          gameBucketIdx,
          uIdx,
          recencyBase,
          currentPatchIndex,
          match.rankKnownCount,
          config,
        );
        if (w <= 0) continue;

        // Pairs: every ally / enemy champion in this game.
        for (const a of allies) {
          addPair(pairAlly, me.championId, me.role, a.championId, a.role, rankBucket, win, w);
        }
        for (const e of enemies) {
          addPair(pairEnemy, me.championId, me.role, e.championId, e.role, rankBucket, win, w);
        }

        // Lanes: only when the required lane-group champions are known.
        if (laneVsComplete) {
          const e1 = opp1;
          const e2 = opp2;
          if (e1 !== null && (laneGroup.oneToOne || e2 !== null)) {
            addLaneVs(me.championId, me.role, e1, e2, rankBucket, win, w);
          }
        }
        if (!laneGroup.oneToOne) {
          const partner = findByRole(sortedAllies, laneGroup.allies[0]);
          if (partner !== null && opp1 !== null && opp2 !== null) {
            addLaneFull(me.championId, me.role, partner, opp1, opp2, rankBucket, win, w);
          }
        }
      }
    }
  }

  const toArray = <T>(map: Map<string, T>): T[] => [...map.values()];

  const result: PairTableResult = {
    pairAlly: toArray(pairAlly),
    pairEnemy: toArray(pairEnemy),
    laneVs: toArray(laneVs),
    laneFull: toArray(laneFull),
  };

  // No contributing games: leave existing tables unchanged (same as baseline).
  if (
    result.pairAlly.length === 0 &&
    result.pairEnemy.length === 0 &&
    result.laneVs.length === 0 &&
    result.laneFull.length === 0
  ) {
    return result;
  }

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

  return result;
}
