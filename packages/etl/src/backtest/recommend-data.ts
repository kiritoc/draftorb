/**
 * @draftorb/etl — Per-role `RecommendData` for the draft backtest (B-053).
 *
 * Reads the aggregated tables of a database and shapes them exactly like the
 * exported `roles/<ROLE>/*.json` files the web app loads (same `exportMinGames`
 * gate, same rounding, same role-prob renormalization), so the backtest
 * evaluates the deployed engine on the same inputs it sees in production.
 * The database is expected to contain only the training window (the caller
 * copies matches/participants into an in-memory database minus the holdout
 * patch before aggregating).
 */

import { readFileSync } from 'node:fs';

import type Database from 'better-sqlite3';

import {
  championTagsMapSchema,
  type ChampionTagsMap,
  type RecommendData,
  type Role,
} from '@draftorb/shared';
import {
  TABLE_SPECS,
  type AllyPairRow,
  type BaselineRow,
  type EnemyPairRow,
  type LaneFullRow,
  type LaneVsRow,
  type TableSpec,
  type WeightedRow,
} from '../export/role-tables';
import { exportRoleProbabilities, type RoleProbRow } from '../export/role-prob';
import { exportPickRates } from '../export/pick-rate';

const ALL_ROLES: readonly Role[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];

export interface BacktestRecommendDataOptions {
  /** Same gate the JSON export applies (`config.exportMinGames`). */
  exportMinGames: number;
  tags: ChampionTagsMap;
  /** Candidate enumeration: every champion id the engine may score. */
  championIds: readonly number[];
}

/** Typed wrapper around `db.prepare(sql).all()` (same helper as export/index). */
function all<T>(db: Database.Database, sql: string): T[] {
  return db.prepare(sql).all() as T[];
}

/** Load and validate `data/manual/champion-tags.json` (fails loudly, B-047). */
export function loadChampionTagsMap(tagsPath: string): ChampionTagsMap {
  try {
    return championTagsMapSchema.parse(JSON.parse(readFileSync(tagsPath, 'utf8')));
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot load champion tags from ${tagsPath}: ${reason}`);
  }
}

/** Export-format tuples for one role: gated rows of a single `my_role`. */
function tuplesForRole<Row extends WeightedRow, Entry extends readonly unknown[]>(
  spec: TableSpec<Row, Entry>,
  rows: readonly Row[],
  role: Role,
  exportMinGames: number,
): Entry[] {
  const tuples: Entry[] = [];
  for (const row of rows) {
    if (row.myRole !== role) continue;
    const tuple = spec.toTuple(row, exportMinGames);
    if (tuple !== null) tuples.push(tuple);
  }
  return spec.schema.array().parse(tuples);
}

/**
 * Build one `RecommendData` per role from the aggregated tables. Every role
 * gets an entry (empty tables when no rows survive the gate), matching an
 * export that simply has no data for that role.
 */
export function buildRoleRecommendData(
  db: Database.Database,
  options: BacktestRecommendDataOptions,
): Record<Role, RecommendData> {
  const roleProbRows = all<RoleProbRow>(
    db,
    `SELECT champion_id AS championId, role AS role, games_w AS gamesW, games_w2 AS gamesW2, prob AS prob
     FROM role_prob ORDER BY champion_id, role`,
  );
  const roleProb = exportRoleProbabilities(roleProbRows, options.exportMinGames);
  const pickRate = exportPickRates(roleProbRows, options.exportMinGames);

  const baselineRows = all<BaselineRow>(db, TABLE_SPECS[0].sql);
  const allyPairRows = all<AllyPairRow>(db, TABLE_SPECS[1].sql);
  const enemyPairRows = all<EnemyPairRow>(db, TABLE_SPECS[2].sql);
  const laneVsRows = all<LaneVsRow>(db, TABLE_SPECS[3].sql);
  const laneFullRows = all<LaneFullRow>(db, TABLE_SPECS[4].sql);

  const championIds = [...options.championIds];
  const out = {} as Record<Role, RecommendData>;
  for (const role of ALL_ROLES) {
    out[role] = {
      baselines: tuplesForRole(TABLE_SPECS[0], baselineRows, role, options.exportMinGames),
      allyPairs: tuplesForRole(TABLE_SPECS[1], allyPairRows, role, options.exportMinGames),
      enemyPairs: tuplesForRole(TABLE_SPECS[2], enemyPairRows, role, options.exportMinGames),
      laneVs: tuplesForRole(TABLE_SPECS[3], laneVsRows, role, options.exportMinGames),
      laneFull: tuplesForRole(TABLE_SPECS[4], laneFullRows, role, options.exportMinGames),
      roleProb,
      pickRate,
      tags: options.tags,
      championIds,
    };
  }
  return out;
}
