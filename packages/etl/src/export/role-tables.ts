/**
 * @draftorb/etl — Role-keyed aggregate table exports.
 */

import {
  z,
  allyPairEntrySchema,
  baselineEntrySchema,
  enemyPairEntrySchema,
  laneFullEntrySchema,
  laneVsEntrySchema,
  roleSchema,
  type RankBucket,
  type Role,
  type AllyPairEntry,
  type BaselineEntry,
  type EnemyPairEntry,
  type LaneFullEntry,
  type LaneVsEntry,
} from '@draftorb/shared';
import { passesGate, round6 } from './io.js';

interface WeightedRow {
  championId: number;
  myRole: Role;
  winsW: number;
  gamesW: number;
  gamesW2: number;
}

export interface BaselineRow extends WeightedRow {
  rankBucket: RankBucket;
  games: number;
}

export interface AllyPairRow extends WeightedRow {
  allyId: number;
  rankBucket: RankBucket;
}

export interface EnemyPairRow extends WeightedRow {
  enemyId: number;
  rankBucket: RankBucket;
}

export interface LaneVsRow extends WeightedRow {
  opp1Id: number;
  opp2Id: number | null;
  rankBucket: RankBucket;
}

export interface LaneFullRow extends WeightedRow {
  partnerId: number | null;
  opp1Id: number;
  opp2Id: number | null;
  rankBucket: RankBucket;
}

export interface TableSpec<Row extends WeightedRow, Entry extends readonly unknown[]> {
  name: string;
  sql: string;
  toTuple(row: Row, exportMinGames: number): Entry | null;
  schema: z.ZodType<Entry>;
}

type AnyTableSpec =
  | TableSpec<BaselineRow, BaselineEntry>
  | TableSpec<AllyPairRow, AllyPairEntry>
  | TableSpec<EnemyPairRow, EnemyPairEntry>
  | TableSpec<LaneVsRow, LaneVsEntry>
  | TableSpec<LaneFullRow, LaneFullEntry>;

const WEIGHTS = (row: WeightedRow) =>
  [round6(row.winsW), round6(row.gamesW), round6(row.gamesW2)] as const;

export const TABLE_SPECS = [
  {
    name: 'baseline.json',
    sql: `SELECT champion_id AS championId, my_role AS myRole, rank_bucket AS rankBucket,
             wins_w AS winsW, games_w AS gamesW, games_w2 AS gamesW2, games AS games
          FROM baseline ORDER BY champion_id, my_role, rank_bucket`,
    toTuple: (row: BaselineRow, exportMinGames: number): BaselineEntry | null => {
      if (!passesGate(row.gamesW, row.gamesW2, exportMinGames)) return null;
      return [row.championId, row.rankBucket, ...WEIGHTS(row), row.games];
    },
    schema: baselineEntrySchema,
  },
  {
    name: 'ally-pairs.json',
    sql: `SELECT my_champion_id AS championId, other_champion_id AS allyId, my_role AS myRole,
             rank_bucket AS rankBucket, wins_w AS winsW, games_w AS gamesW, games_w2 AS gamesW2
          FROM pair_ally ORDER BY my_champion_id, my_role, other_champion_id`,
    toTuple: (row: AllyPairRow, exportMinGames: number): AllyPairEntry | null => {
      if (!passesGate(row.gamesW, row.gamesW2, exportMinGames)) return null;
      return [row.championId, row.allyId, row.myRole, row.rankBucket, ...WEIGHTS(row)];
    },
    schema: allyPairEntrySchema,
  },
  {
    name: 'enemy-pairs.json',
    sql: `SELECT my_champion_id AS championId, other_champion_id AS enemyId, my_role AS myRole,
             rank_bucket AS rankBucket, wins_w AS winsW, games_w AS gamesW, games_w2 AS gamesW2
          FROM pair_enemy ORDER BY my_champion_id, my_role, other_champion_id`,
    toTuple: (row: EnemyPairRow, exportMinGames: number): EnemyPairEntry | null => {
      if (!passesGate(row.gamesW, row.gamesW2, exportMinGames)) return null;
      return [row.championId, row.enemyId, row.myRole, row.rankBucket, ...WEIGHTS(row)];
    },
    schema: enemyPairEntrySchema,
  },
  {
    name: 'lane-vs.json',
    sql: `SELECT my_champion_id AS championId, my_role AS myRole, opp1_id AS opp1Id, opp2_id AS opp2Id,
             rank_bucket AS rankBucket, wins_w AS winsW, games_w AS gamesW, games_w2 AS gamesW2
          FROM lane_vs ORDER BY my_champion_id, my_role, opp1_id, COALESCE(opp2_id, -1)`,
    toTuple: (row: LaneVsRow, exportMinGames: number): LaneVsEntry | null => {
      if (!passesGate(row.gamesW, row.gamesW2, exportMinGames)) return null;
      return [row.championId, row.opp1Id, row.opp2Id, row.rankBucket, ...WEIGHTS(row)];
    },
    schema: laneVsEntrySchema,
  },
  {
    name: 'lane-full.json',
    sql: `SELECT my_champion_id AS championId, my_role AS myRole, partner_id AS partnerId, opp1_id AS opp1Id, opp2_id AS opp2Id,
             rank_bucket AS rankBucket, wins_w AS winsW, games_w AS gamesW, games_w2 AS gamesW2
          FROM lane_full ORDER BY my_champion_id, my_role, partner_id, COALESCE(opp2_id, -1)`,
    toTuple: (row: LaneFullRow, exportMinGames: number): LaneFullEntry | null => {
      if (!passesGate(row.gamesW, row.gamesW2, exportMinGames)) return null;
      return [
        row.championId,
        row.partnerId,
        row.opp1Id,
        row.opp2Id,
        row.rankBucket,
        ...WEIGHTS(row),
      ];
    },
    schema: laneFullEntrySchema,
  },
] as const satisfies readonly AnyTableSpec[];

export function buildTableFile<Row extends WeightedRow, Entry extends readonly unknown[]>(
  spec: TableSpec<Row, Entry>,
  rows: readonly Row[],
  role: string,
  exportMinGames: number,
): { relativePath: string; content: string } {
  const relativePath = `roles/${role}/${spec.name}`;
  const tuples: Entry[] = [];
  try {
    roleSchema.parse(role);
    for (const row of rows) {
      if (row.myRole !== role) continue;
      const tuple = spec.toTuple(row, exportMinGames);
      if (tuple !== null) tuples.push(tuple);
    }
    spec.schema.array().parse(tuples);
  } catch (error: unknown) {
    throw new Error(
      `Invalid table export for ${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return { relativePath, content: JSON.stringify(tuples) };
}
