/**
 * @draftorb/engine — Index builders and lookup keys over exported data tables.
 */

import type {
  AllyPairTable,
  BaselineTable,
  ChampionId,
  EnemyPairTable,
  LaneFullTable,
  LaneVsTable,
  RankBucket,
  Role,
} from '@draftorb/shared';
import type { DataRow } from './recommend-types.js';
import { nEff, toEquivalentCounts } from './weighting.js';

function toRow(winsW: number, gamesW: number, gamesW2: number): DataRow {
  const nE = nEff(gamesW, gamesW2);
  const { winsE, gamesE } = toEquivalentCounts(winsW, gamesW, gamesW2);
  return { winsW, gamesW, gamesW2, winsE, gamesE, nE };
}

/** Pair lookup key: candidate + other champion + other champion's role. */
export function makePairKey(c: ChampionId, other: ChampionId, role: Role): string {
  return `${c}:${other}:${role}`;
}

/** Key for lane_vs lookups: championId + opponent IDs in lane-group role order. */
export function makeLaneVsKey(c: ChampionId, opp1: ChampionId, opp2: ChampionId): string {
  return `${c}:${opp1}:${opp2}`;
}

/** Key for lane_full lookups: championId + partner + opponents in role order. */
export function makeLaneFullKey(
  c: ChampionId,
  partner: ChampionId,
  opp1: ChampionId,
  opp2: ChampionId,
): string {
  return `${c}:${partner}:${opp1}:${opp2}`;
}

/** Baseline rows for one rank bucket, keyed by championId. */
export function indexBaselines(
  baselines: BaselineTable,
  bucket: RankBucket,
): Map<ChampionId, DataRow> {
  const map = new Map<ChampionId, DataRow>();
  for (const [c, rowBucket, winsW, gamesW, gamesW2] of baselines) {
    if (rowBucket !== bucket) continue;
    map.set(c, toRow(winsW, gamesW, gamesW2));
  }
  return map;
}

/** Pair rows (ally or enemy) for one rank bucket, keyed by `makePairKey`. */
export function indexPairs(
  pairs: AllyPairTable | EnemyPairTable,
  bucket: RankBucket,
): Map<string, DataRow> {
  const map = new Map<string, DataRow>();
  for (const [c, otherId, role, rowBucket, winsW, gamesW, gamesW2] of pairs) {
    if (rowBucket !== bucket) continue;
    map.set(makePairKey(c, otherId, role), toRow(winsW, gamesW, gamesW2));
  }
  return map;
}

/** lane_vs rows for one rank bucket, keyed by `makeLaneVsKey`. */
export function indexLaneVs(laneVs: LaneVsTable, bucket: RankBucket): Map<string, DataRow> {
  const map = new Map<string, DataRow>();
  for (const [c, opp1, opp2, rowBucket, winsW, gamesW, gamesW2] of laneVs) {
    if (rowBucket !== bucket) continue;
    map.set(makeLaneVsKey(c, opp1, opp2 ?? -1), toRow(winsW, gamesW, gamesW2));
  }
  return map;
}

/** lane_full rows for one rank bucket, keyed by `makeLaneFullKey`. */
export function indexLaneFull(laneFull: LaneFullTable, bucket: RankBucket): Map<string, DataRow> {
  const map = new Map<string, DataRow>();
  for (const [c, partner, opp1, opp2, rowBucket, winsW, gamesW, gamesW2] of laneFull) {
    if (rowBucket !== bucket) continue;
    map.set(makeLaneFullKey(c, partner ?? -1, opp1, opp2 ?? -1), toRow(winsW, gamesW, gamesW2));
  }
  return map;
}
