/**
 * @draftorb/etl — Row types for pair & lane aggregation. Split out of
 * aggregate-pairs.ts (file size); pure move, no logic change.
 */

import type { RankBucket } from '@draftorb/shared';
import type { RankWeightingConfig } from '@draftorb/engine';

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
