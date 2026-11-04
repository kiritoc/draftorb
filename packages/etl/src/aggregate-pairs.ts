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
} from '@draftorb/engine';
import {
  accumulateWeighted,
  assertPatchFormat,
  gameBucketIndex,
  groupRowsByMatch,
  loadPatchWindow,
  partitionByTeam,
} from './aggregate-shared';
import { writePairTables } from './aggregate-pairs-write';
import type {
  AggregatePairTablesOptions,
  LaneFullRow,
  LaneVsRow,
  PairRow,
  PairTableResult,
} from './aggregate-pairs-types';

export type {
  AggregatePairTablesOptions,
  LaneFullRow,
  LaneVsRow,
  PairRow,
  PairTableResult,
} from './aggregate-pairs-types';

export function aggregatePairTables(
  db: Database.Database,
  options: AggregatePairTablesOptions = {},
): PairTableResult {
  const config = options.config ?? DEFAULT_CONFIG;
  assertPatchFormat(options.patch);

  const snapshotPatch = options.patch;
  const { patchIndex, currentPatchIndex } = loadPatchWindow(db, snapshotPatch);

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
    accumulateWeighted(map, key, w, win, () => ({
      championId,
      myRole,
      otherChampionId,
      otherRole,
      rankBucket,
      winsW: 0,
      gamesW: 0,
      gamesW2: 0,
      games: 0,
    })).games += 1;
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
    accumulateWeighted(laneVs, key, w, win, () => ({
      championId,
      myRole,
      opp1Id,
      opp2Id,
      rankBucket,
      winsW: 0,
      gamesW: 0,
      gamesW2: 0,
      games: 0,
    })).games += 1;
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
    accumulateWeighted(laneFull, key, w, win, () => ({
      championId,
      myRole,
      partnerId,
      opp1Id,
      opp2Id,
      rankBucket,
      winsW: 0,
      gamesW: 0,
      gamesW2: 0,
      games: 0,
    })).games += 1;
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

  interface MatchParticipantRow {
    matchId: string;
    championId: number;
    role: string;
    win: number;
    teamId: number;
    puuid: string;
    patch: string;
    rankKnownCount: number;
    rankScore: number;
  }

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
    .iterate() as IterableIterator<MatchParticipantRow>;

  const processMatch = (group: MatchParticipantRow[]): void => {
    const first = group[0];
    if (first === undefined) return;
    const pIdx = patchIndex.get(first.patch);
    // pIdx is guaranteed defined (we filtered while streaming).
    const recencyBase = pIdx === undefined ? 0 : pIdx;

    const teams = partitionByTeam(group);
    const gameBucketIdx = gameBucketIndex(first.rankScore);

    for (const me of group) {
      const myTeam = teams.get(me.teamId);
      if (myTeam === undefined) continue;
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

      const win = me.win;

      for (const rankBucket of RANK_BUCKET_ORDER) {
        const uIdx = bucketIndex(rankBucket);
        const w = combinedGameWeight(
          gameBucketIdx,
          uIdx,
          recencyBase,
          currentPatchIndex,
          first.rankKnownCount,
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
        if (opp1 !== null && (laneGroup.oneToOne || opp2 !== null)) {
          addLaneVs(me.championId, me.role, opp1, opp2, rankBucket, win, w);
        }
        if (!laneGroup.oneToOne) {
          const partner = findByRole(sortedAllies, laneGroup.allies[0]);
          if (partner !== null && opp1 !== null && opp2 !== null) {
            addLaneFull(me.championId, me.role, partner, opp1, opp2, rankBucket, win, w);
          }
        }
      }
    }
  };

  // Rows are ordered by match_id: aggregate each match as soon as it is
  // complete so only one match's participants are held in memory.
  for (const group of groupRowsByMatch(rows)) {
    if (group[0] !== undefined && !patchIndex.has(group[0].patch)) continue;
    processMatch(group);
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

  writePairTables(db, result);

  return result;
}
