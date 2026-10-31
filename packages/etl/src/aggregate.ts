import type Database from 'better-sqlite3';

export interface RoleProbRow {
  championId: number;
  role: string;
  games: number;
  prob: number;
}

/**
 * Aggregate role probabilities from stored participants.
 *
 * For every (champion, role) observed in `participants`, `games` is the raw
 * match count and `prob` is that champion's share of games played in the role:
 * `prob = games(champion, role) / sum_roles games(champion, role)`. Probabilities
 * therefore sum to 1 per champion (sparse map: only observed (champion, role)
 * pairs are written). The table is cleared and rewritten, so the command is
 * idempotent and safe to re-run.
 */
export function latestPatch(db: Database.Database): string | undefined {
  const row = db
    .prepare('SELECT patch FROM matches ORDER BY created_at DESC LIMIT 1')
    .get() as { patch: string } | undefined;
  return row?.patch;
}

/**
 * Only participants from matches on `patch` are counted (defaults to the patch
 * of the most recent stored match), so older patches never distort the result.
 */
export function aggregateRoleProb(db: Database.Database, patch?: string): RoleProbRow[] {
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
