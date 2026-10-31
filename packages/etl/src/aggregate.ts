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
export function aggregateRoleProb(db: Database.Database): RoleProbRow[] {
  const rows = db
    .prepare(
      `SELECT
         champion_id AS championId,
         role,
         COUNT(*) AS games
       FROM participants
       GROUP BY champion_id, role`,
    )
    .all() as { championId: number; role: string; games: number }[];

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
