/**
 * @draftorb/engine — Table indexing for the recommendation engine (T-023).
 *
 * Applies the SPECS §3 rank-distance kernel per bucket (D-030) and indexes the
 * role-keyed tables by lookup key.
 */

import type {
  AllyPairTable,
  BaselineTable,
  ChampionRoleProbabilities,
  EnemyPairTable,
  LaneFullTable,
  LaneVsTable,
  RankBucket,
} from '@draftorb/shared';

import { bucketIndex } from './config.js';
import type { RankWeightingConfig } from './config.js';
import { rankDistanceWeight, toEquivalentCounts } from './weighting.js';

/** Role-keyed tables for `input.userRole` (DATA_MODEL.md). */
export interface DraftData {
  readonly roleProb: ChampionRoleProbabilities;
  readonly baseline: BaselineTable;
  readonly allyPairs: AllyPairTable;
  readonly enemyPairs: EnemyPairTable;
  readonly laneVs: LaneVsTable;
  readonly laneFull: LaneFullTable;
}

export interface Counts {
  winsW: number;
  gamesW: number;
  gamesW2: number;
  rawGames: number;
}

export interface Tables {
  readonly baseline: ReadonlyMap<string, Counts>;
  readonly ally: ReadonlyMap<string, Counts>;
  readonly enemy: ReadonlyMap<string, Counts>;
  readonly laneVs: ReadonlyMap<string, Counts>;
  readonly laneFull: ReadonlyMap<string, Counts>;
}

function accumulate(
  map: Map<string, Counts>,
  key: string,
  bucket: RankBucket,
  userIdx: number,
  winsW: number,
  gamesW: number,
  gamesW2: number,
  config: RankWeightingConfig,
): void {
  const w = rankDistanceWeight(bucketIndex(bucket), userIdx, config.tau, config.rankWindowTiers);
  if (w <= 0) {
    return;
  }
  const c = map.get(key) ?? { winsW: 0, gamesW: 0, gamesW2: 0, rawGames: 0 };
  c.winsW += w * winsW;
  c.gamesW += w * gamesW;
  c.gamesW2 += w * w * gamesW2;
  c.rawGames += gamesW;
  map.set(key, c);
}

/** Index every table by lookup key, applying the per-bucket rank kernel (D-030). */
export function indexTables(data: DraftData, userIdx: number, config: RankWeightingConfig): Tables {
  const baseline = new Map<string, Counts>();
  for (const [c, b, wi, g, g2] of data.baseline) {
    accumulate(baseline, `${c}`, b, userIdx, wi, g, g2, config);
  }
  const ally = new Map<string, Counts>();
  for (const [c, o, r, b, wi, g, g2] of data.allyPairs) {
    accumulate(ally, `${c}|${o}|${r}`, b, userIdx, wi, g, g2, config);
  }
  const enemy = new Map<string, Counts>();
  for (const [c, o, r, b, wi, g, g2] of data.enemyPairs) {
    accumulate(enemy, `${c}|${o}|${r}`, b, userIdx, wi, g, g2, config);
  }
  const laneVs = new Map<string, Counts>();
  for (const [c, o1, o2, b, wi, g, g2] of data.laneVs) {
    accumulate(laneVs, `${c}|${o1}|${o2 ?? ''}`, b, userIdx, wi, g, g2, config);
  }
  const laneFull = new Map<string, Counts>();
  for (const [c, p, o1, o2, b, wi, g, g2] of data.laneFull) {
    accumulate(laneFull, `${c}|${p ?? ''}|${o1}|${o2 ?? ''}`, b, userIdx, wi, g, g2, config);
  }
  return { baseline, ally, enemy, laneVs, laneFull };
}

/** Equivalent counts (SPECS §5) of an indexed entry; empty when absent. */
export function equivalent(counts: Counts | undefined): { winsE: number; gamesE: number } {
  if (!counts) {
    return { winsE: 0, gamesE: 0 };
  }
  return toEquivalentCounts(counts.winsW, counts.gamesW, counts.gamesW2);
}
