/**
 * @draftorb/etl — Role-keyed aggregate table exports.
 *
 * Table-driven spec: one entry per exported file ({baseline, ally-pairs,
 * enemy-pairs, lane-vs, lane-full}.json) with its SQL, tuple serializer, and
 * shared zod schema. Rows are filtered by `myRole` and the `exportMinGames`
 * gate inside `toTuple` (returns null when dropped), then the surviving tuples
 * are validated against the shared schema. Query results are typed by the
 * orchestrator's `all<T>()` helper; `toTuple` narrows each row to its table's
 * interface.
 */

import {
  z,
  allyPairEntrySchema,
  baselineEntrySchema,
  enemyPairEntrySchema,
  laneFullEntrySchema,
  laneVsEntrySchema,
} from '@draftorb/shared';
import { passesGate, round6 } from './io.js';

export interface BaselineRow {
  championId: number;
  myRole: string;
  rankBucket: string;
  winsW: number;
  gamesW: number;
  gamesW2: number;
  games: number;
}

export interface AllyPairRow {
  championId: number;
  allyId: number;
  myRole: string;
  rankBucket: string;
  winsW: number;
  gamesW: number;
  gamesW2: number;
}

export interface EnemyPairRow {
  championId: number;
  enemyId: number;
  myRole: string;
  rankBucket: string;
  winsW: number;
  gamesW: number;
  gamesW2: number;
}

export interface LaneVsRow {
  championId: number;
  myRole: string;
  opp1Id: number;
  opp2Id: number | null;
  rankBucket: string;
  winsW: number;
  gamesW: number;
  gamesW2: number;
}

export interface LaneFullRow {
  championId: number;
  myRole: string;
  partnerId: number | null;
  opp1Id: number;
  opp2Id: number | null;
  rankBucket: string;
  winsW: number;
  gamesW: number;
  gamesW2: number;
}

export type ExportRow = BaselineRow | AllyPairRow | EnemyPairRow | LaneVsRow | LaneFullRow;

export interface TableSpec {
  name: string;
  sql: string;
  /** Returns the exported tuple, or null when the row is gated out. */
  toTuple(row: unknown, exportMinGames: number): unknown[] | null;
  schema: z.ZodType<readonly unknown[]>;
}

const WEIGHTS = (row: { winsW: number; gamesW: number; gamesW2: number }) => [
  round6(row.winsW),
  round6(row.gamesW),
  round6(row.gamesW2),
];

export const TABLE_SPECS: readonly TableSpec[] = [
  {
    name: 'baseline.json',
    sql: `SELECT champion_id AS championId, my_role AS myRole, rank_bucket AS rankBucket,
             wins_w AS winsW, games_w AS gamesW, games_w2 AS gamesW2, games AS games
          FROM baseline ORDER BY champion_id, my_role, rank_bucket`,
    toTuple: (row: unknown, exportMinGames: number) => {
      const r = row as BaselineRow;
      if (!passesGate(r.gamesW, r.gamesW2, exportMinGames)) return null;
      return [r.championId, r.rankBucket, ...WEIGHTS(r), r.games];
    },
    schema: baselineEntrySchema,
  },
  {
    name: 'ally-pairs.json',
    sql: `SELECT my_champion_id AS championId, other_champion_id AS allyId, my_role AS myRole,
             rank_bucket AS rankBucket, wins_w AS winsW, games_w AS gamesW, games_w2 AS gamesW2
          FROM pair_ally ORDER BY my_champion_id, my_role, other_champion_id`,
    toTuple: (row: unknown, exportMinGames: number) => {
      const r = row as AllyPairRow;
      if (!passesGate(r.gamesW, r.gamesW2, exportMinGames)) return null;
      return [r.championId, r.allyId, r.myRole, r.rankBucket, ...WEIGHTS(r)];
    },
    schema: allyPairEntrySchema,
  },
  {
    name: 'enemy-pairs.json',
    sql: `SELECT my_champion_id AS championId, other_champion_id AS enemyId, my_role AS myRole,
             rank_bucket AS rankBucket, wins_w AS winsW, games_w AS gamesW, games_w2 AS gamesW2
          FROM pair_enemy ORDER BY my_champion_id, my_role, other_champion_id`,
    toTuple: (row: unknown, exportMinGames: number) => {
      const r = row as EnemyPairRow;
      if (!passesGate(r.gamesW, r.gamesW2, exportMinGames)) return null;
      return [r.championId, r.enemyId, r.myRole, r.rankBucket, ...WEIGHTS(r)];
    },
    schema: enemyPairEntrySchema,
  },
  {
    name: 'lane-vs.json',
    sql: `SELECT my_champion_id AS championId, my_role AS myRole, opp1_id AS opp1Id, opp2_id AS opp2Id,
             rank_bucket AS rankBucket, wins_w AS winsW, games_w AS gamesW, games_w2 AS gamesW2
          FROM lane_vs ORDER BY my_champion_id, my_role, opp1_id, COALESCE(opp2_id, -1)`,
    toTuple: (row: unknown, exportMinGames: number) => {
      const r = row as LaneVsRow;
      if (!passesGate(r.gamesW, r.gamesW2, exportMinGames)) return null;
      return [r.championId, r.opp1Id, r.opp2Id, r.rankBucket, ...WEIGHTS(r)];
    },
    schema: laneVsEntrySchema,
  },
  {
    name: 'lane-full.json',
    sql: `SELECT my_champion_id AS championId, my_role AS myRole, partner_id AS partnerId, opp1_id AS opp1Id, opp2_id AS opp2Id,
             rank_bucket AS rankBucket, wins_w AS winsW, games_w AS gamesW, games_w2 AS gamesW2
          FROM lane_full ORDER BY my_champion_id, my_role, partner_id, COALESCE(opp2_id, -1)`,
    toTuple: (row: unknown, exportMinGames: number) => {
      const r = row as LaneFullRow;
      if (!passesGate(r.gamesW, r.gamesW2, exportMinGames)) return null;
      return [r.championId, r.partnerId, r.opp1Id, r.opp2Id, r.rankBucket, ...WEIGHTS(r)];
    },
    schema: laneFullEntrySchema,
  },
] as const;

/**
 * Builds the exported tuple file for one spec + role. `rows` are the already
 * typed query results for that table. Validates every produced tuple against
 * the shared schema.
 */
export function buildTableFile(
  spec: TableSpec,
  rows: readonly unknown[],
  role: string,
  exportMinGames: number,
): { relativePath: string; content: string } {
  const tuples: unknown[][] = [];
  for (const row of rows) {
    const r = row as { myRole: string };
    if (r.myRole !== role) continue;
    const tuple = spec.toTuple(row, exportMinGames);
    if (tuple === null) continue;
    tuples.push(tuple);
  }
  spec.schema.array().parse(tuples);
  return { relativePath: `roles/${role}/${spec.name}`, content: JSON.stringify(tuples) };
}
