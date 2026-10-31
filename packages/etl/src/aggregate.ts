import type Database from 'better-sqlite3';

export interface RoleProbRow {
  championId: number;
  role: string;
  games: number;
  prob: number;
}

/** Patches are stored as "major.minor" (RIOT_API.md). */
export const PATCH_PATTERN = /^\d+\.\d+$/;

/**
 * Highest stored patch, compared numerically on major.minor (16.10 > 16.9,
 * same rule as D-017). Using `created_at` order instead could pick an older
 * patch after an out-of-order ingest.
 */
export function latestPatch(db: Database.Database): string | undefined {
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
 * Aggregate role probabilities from stored participants.
 *
 * For every (champion, role) observed on `patch` (default: `latestPatch`),
 * `games` is the raw match count and
 * `prob = games(champion, role) / sum_roles games(champion, role)`, so probs sum
 * to 1 per champion (sparse map, D-027). Only one patch is counted (D-031,
 * PROPOSED). The table is cleared and rewritten in one transaction, so re-runs
 * are idempotent. When the target patch has no participants, `role_prob` is
 * left untouched so a typo cannot wipe the existing table.
 */
export function aggregateRoleProb(db: Database.Database, patch?: string): RoleProbRow[] {
  if (patch !== undefined && !PATCH_PATTERN.test(patch)) {
    throw new Error(`Invalid patch "${patch}". Expected a format like "16.21".`);
  }
  const targetPatch = patch ?? latestPatch(db);
  const rows =
    targetPatch === undefined
      ? []
      : (db
          .prepare(
            `SELECT
               p.champion_id AS championId,
               p.role AS role,
               COUNT(*) AS games
             FROM participants p
             JOIN matches m ON m.match_id = p.match_id
             WHERE m.patch = ?
             GROUP BY p.champion_id, p.role`,
          )
          .all(targetPatch) as { championId: number; role: string; games: number }[]);

  const totals = new Map<number, number>();
  for (const row of rows) {
    totals.set(row.championId, (totals.get(row.championId) ?? 0) + row.games);
  }

  const result: RoleProbRow[] = [];
  for (const row of rows) {
    const total = totals.get(row.championId) ?? 0;
    const prob = total > 0 ? row.games / total : 0;
    result.push({ championId: row.championId, role: row.role, games: row.games, prob });
  }

  if (result.length === 0) {
    return result;
  }

  const clear = db.prepare('DELETE FROM role_prob');
  const insert = db.prepare(
    'INSERT INTO role_prob (champion_id, role, games, prob) VALUES (?, ?, ?, ?)',
  );
  const write = db.transaction(() => {
    clear.run();
    for (const row of result) {
      insert.run(row.championId, row.role, row.games, row.prob);
    }
  });
  write.immediate();

  return result;
}
