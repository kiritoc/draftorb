import type Database from 'better-sqlite3';

import {
  DEFAULT_CONFIG,
  recencyFactor,
  reliabilityFactor,
  type RankWeightingConfig,
} from '@draftorb/engine';
import { assertPatchFormat, loadPatchWindow } from './aggregate-shared';

export { PATCH_PATTERN } from './aggregate-shared';

export interface RoleProbRow {
  championId: number;
  role: string;
  games: number;
  gamesW: number;
  gamesW2: number;
  prob: number;
}

/**
 * Latest stored patch. Prefers the `patches` table ordinal (D-043): the match
 * whose label has the highest `patch_index` wins, so real release order — not
 * version-string or `created_at` order — decides. Falls back to the numeric
 * major.minor compare for databases whose `patches` table is not populated yet.
 */
export function latestPatch(db: Database.Database): string | undefined {
  const indexed = db
    .prepare(
      `SELECT m.patch AS patch
       FROM matches m
       JOIN patches p ON p.version_label = m.patch
       ORDER BY p.patch_index DESC
       LIMIT 1`,
    )
    .get() as { patch: string } | undefined;
  if (indexed !== undefined) return indexed.patch;

  const row = db
    .prepare(
      `SELECT patch FROM matches
       WHERE patch IS NOT NULL
       GROUP BY patch
       ORDER BY
         CAST(substr(patch, 1, instr(patch, '.') - 1) AS INTEGER) DESC,
         CAST(substr(patch, instr(patch, '.') + 1) AS INTEGER) DESC
       LIMIT 1`,
    )
    .get() as { patch: string } | undefined;
  return row?.patch;
}

/**
 * Builds a dense patch index over stored patches <= `snapshotPatch`, then
 * accumulates decay-weighted evidence per (championId, role):
 *
 *   games   = raw match count
 *   games_w = sum of recency weights
 *   games_w2 = sum of squared recency weights
 *
 * Weight = recencyFactor(patchIndex, currentPatchIndex, decay)
 *        * reliabilityFactor(rankKnownCount, unknownRankFactor)
 *
 * Evidence from older patches is retained with decay rather than wiped
 * (D-035 design, superseding D-031's single-patch assumption).
 */
function accumulateRoleProb(
  db: Database.Database,
  snapshotPatch: string | undefined,
  config: RankWeightingConfig,
): Map<
  string,
  { championId: number; role: string; games: number; gamesW: number; gamesW2: number }
> {
  const { patchIndex, currentPatchIndex } = loadPatchWindow(db, snapshotPatch);

  const accum = new Map<
    string,
    { championId: number; role: string; games: number; gamesW: number; gamesW2: number }
  >();

  const rows = db
    .prepare(
      `SELECT
         p.champion_id AS championId,
         p.role AS role,
         m.patch AS patch,
         m.rank_known_count AS rankKnownCount
       FROM participants p
       JOIN matches m ON m.match_id = p.match_id`,
    )
    .iterate() as IterableIterator<{
    championId: number;
    role: string;
    patch: string;
    rankKnownCount: number;
  }>;

  for (const row of rows) {
    const pIdx = patchIndex.get(row.patch);
    if (pIdx === undefined) continue;

    const w =
      recencyFactor(pIdx, currentPatchIndex, config.decay) *
      reliabilityFactor(row.rankKnownCount, config.unknownRankFactor);
    if (w <= 0) continue;

    const key = `${row.championId}|${row.role}`;
    const existing = accum.get(key);
    if (existing === undefined) {
      accum.set(key, {
        championId: row.championId,
        role: row.role,
        games: 1,
        gamesW: w,
        gamesW2: w * w,
      });
    } else {
      existing.games += 1;
      existing.gamesW += w;
      existing.gamesW2 += w * w;
    }
  }

  return accum;
}

/**
 * Converts accumulated evidence into `RoleProbRow[]` with
 * `prob = games_w(champion, role) / sum_roles games_w(champion)`, so probs
 * sum to 1 per champion (sparse map, D-027).
 */
function toRoleProbRows(
  accum: Map<
    string,
    { championId: number; role: string; games: number; gamesW: number; gamesW2: number }
  >,
): RoleProbRow[] {
  const totals = new Map<number, number>();
  for (const entry of accum.values()) {
    totals.set(entry.championId, (totals.get(entry.championId) ?? 0) + entry.gamesW);
  }

  const result: RoleProbRow[] = [];
  for (const entry of accum.values()) {
    const total = totals.get(entry.championId) ?? 0;
    const prob = total > 0 ? entry.gamesW / total : 0;
    result.push({
      championId: entry.championId,
      role: entry.role,
      games: entry.games,
      gamesW: entry.gamesW,
      gamesW2: entry.gamesW2,
      prob,
    });
  }

  return result;
}

/**
 * Computes decay-weighted role probabilities for patches up to `patch`
 * (default: `latestPatch`) from stored participants without touching the
 * `role_prob` table. Used by `derive-roles`.
 */
export function computeRoleProb(db: Database.Database, patch?: string): RoleProbRow[] {
  assertPatchFormat(patch);
  return toRoleProbRows(accumulateRoleProb(db, patch, DEFAULT_CONFIG));
}

/**
 * Aggregate role probabilities from stored participants using decay-weighted
 * evidence (D-035 design, superseding D-031's single-patch assumption).
 *
 * Computes probabilities via `computeRoleProb` and rewrites the `role_prob`
 * table in one transaction, so re-runs are idempotent. When no participant
 * contributes, `role_prob` is left untouched so a typo cannot wipe the
 * existing table.
 */
export function aggregateRoleProb(
  db: Database.Database,
  options: { patch?: string; config?: RankWeightingConfig } = {},
): RoleProbRow[] {
  const config = options.config ?? DEFAULT_CONFIG;
  const { patch: snapshotPatch } = options;

  assertPatchFormat(snapshotPatch);

  const result = toRoleProbRows(accumulateRoleProb(db, snapshotPatch, config));

  if (result.length === 0) {
    return result;
  }

  const clear = db.prepare('DELETE FROM role_prob');
  const insert = db.prepare(
    'INSERT INTO role_prob (champion_id, role, games, games_w, games_w2, prob) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const write = db.transaction(() => {
    clear.run();
    for (const row of result) {
      insert.run(row.championId, row.role, row.games, row.gamesW, row.gamesW2, row.prob);
    }
  });
  write.immediate();

  return result;
}
