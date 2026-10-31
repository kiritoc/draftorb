import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { migrate, openDb } from './db';
import { aggregateRoleProb, type RoleProbRow } from './aggregate';

async function withSeededDb(run: (dbPath: string) => Promise<void>, seed = true): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'draftorb-aggregate-'));
  const dbPath = join(directory, 'test.sqlite');
  const originalDbPath = process.env.DRAFTORB_DB_PATH;
  process.env.DRAFTORB_DB_PATH = dbPath;

  try {
    const db = openDb(dbPath);
    migrate(db);

    if (!seed) {
      db.close();
      await run(dbPath);
      return;
    }

    const insertMatch = db.prepare(
      `INSERT INTO matches (
        match_id, platform, patch, queue_id, duration, created_at, avg_rank_score
      ) VALUES (?, 'euw1', '16.21', 420, 1800, 1, 6.5)`,
    );
    const insertParticipant = db.prepare(
      `INSERT INTO participants (
        match_id, puuid, team_id, champion_id, role, win, rank_score,
        champion_games, mastery_points, is_expert, keystone, primary_style,
        sub_style, perks_json, items_json, kills, deaths, assists
      ) VALUES (
        ?, ?, 100, ?, ?, ?, null, 0, NULL, NULL, 8439, 8400, 8300, '{}', '[]', 0, 0, 0
      )`,
    );

    let matchIndex = 0;
    const addGame = (puuid: string, championId: number, role: string, win: number): void => {
      const matchId = `m${(matchIndex += 1)}`;
      insertMatch.run(matchId);
      insertParticipant.run(matchId, puuid, championId, role, win);
    };

    // Champion 412 (Soraka): 10 support games + 2 mid games (flex) = 12 total.
    for (let i = 0; i < 10; i += 1) {
      addGame(`p${i}`, 412, 'SUPPORT', i % 2 === 0 ? 1 : 0);
    }
    addGame('p10', 412, 'MID', 0);
    addGame('p11', 412, 'MID', 1);

    // Champion 266 (Aatrox): 4 top games only.
    for (let i = 0; i < 4; i += 1) {
      addGame(`p${20 + i}`, 266, 'TOP', i % 2 === 0 ? 1 : 0);
    }

    db.close();

    await run(dbPath);
  } finally {
    if (originalDbPath === undefined) {
      delete process.env.DRAFTORB_DB_PATH;
    } else {
      process.env.DRAFTORB_DB_PATH = originalDbPath;
    }
    rmSync(directory, { recursive: true, force: true });
  }
}

function openAndRead(dbPath: string): RoleProbRow[] {
  const db = openDb(dbPath);
  try {
    return db
      .prepare(
        'SELECT champion_id AS championId, role, games, prob FROM role_prob ORDER BY champion_id, role',
      )
      .all() as RoleProbRow[];
  } finally {
    db.close();
  }
}

describe('aggregateRoleProb', () => {
  it('computes role probabilities that sum to 1 per champion', async () => {
    await withSeededDb(async (dbPath) => {
      const db = openDb(dbPath);
      try {
        const rows = aggregateRoleProb(db);
        expect(rows.length).toBe(3);

        const byChampion = new Map<number, RoleProbRow[]>();
        for (const row of rows) {
          const list = byChampion.get(row.championId) ?? [];
          list.push(row);
          byChampion.set(row.championId, list);
        }

        // Soraka: 10 support / 2 mid = 12 total.
        const soraka = byChampion.get(412)!;
        expect(soraka.map((r) => r.role).sort()).toEqual(['MID', 'SUPPORT']);
        const support = soraka.find((r) => r.role === 'SUPPORT')!;
        const mid = soraka.find((r) => r.role === 'MID')!;
        expect(support.games).toBe(10);
        expect(mid.games).toBe(2);
        expect(support.prob).toBeCloseTo(10 / 12);
        expect(mid.prob).toBeCloseTo(2 / 12);
        expect(support.prob + mid.prob).toBeCloseTo(1);

        // Aatrox: 4 top games only -> prob 1.
        const aatrox = byChampion.get(266)!;
        const aatroxRow = aatrox[0]!;
        expect(aatrox).toHaveLength(1);
        expect(aatroxRow.role).toBe('TOP');
        expect(aatroxRow.games).toBe(4);
        expect(aatroxRow.prob).toBeCloseTo(1);

        // Global invariant: probs sum to 1 per champion.
        for (const [, list] of byChampion) {
          const sum = list.reduce((acc, row) => acc + row.prob, 0);
          expect(sum).toBeCloseTo(1);
        }
      } finally {
        db.close();
      }

      // Persisted rows match.
      const persisted = openAndRead(dbPath);
      expect(persisted.length).toBe(3);
      for (const row of persisted) {
        expect(row.prob).toBeGreaterThan(0);
        expect(row.prob).toBeLessThanOrEqual(1);
      }
    });
  });

  it('is idempotent: re-running produces identical rows', async () => {
    await withSeededDb(async (dbPath) => {
      const db = openDb(dbPath);
      try {
        const first = aggregateRoleProb(db);
        const second = aggregateRoleProb(db);
        expect(second).toEqual(first);
      } finally {
        db.close();
      }
    });
  });

  it('only counts participants from the target patch', async () => {
    await withSeededDb(async (dbPath) => {
      const db = openDb(dbPath);
      try {
        db.prepare(
          `INSERT INTO matches (
            match_id, platform, patch, queue_id, duration, created_at, avg_rank_score
          ) VALUES ('old1', 'euw1', '16.20', 420, 1800, 0, 6.5)`,
        ).run();
        db.prepare(
          `INSERT INTO participants (
            match_id, puuid, team_id, champion_id, role, win, rank_score,
            champion_games, mastery_points, is_expert, keystone, primary_style,
            sub_style, perks_json, items_json, kills, deaths, assists
          ) VALUES (
            'old1', 'old', 100, 266, 'MID', 1, null, 0, NULL, NULL, 8439, 8400, 8300, '{}', '[]', 0, 0, 0
          )`,
        ).run();

        const current = aggregateRoleProb(db);
        expect(current.find((r) => r.championId === 266 && r.role === 'MID')).toBeUndefined();

        const old = aggregateRoleProb(db, '16.20');
        expect(old).toEqual([{ championId: 266, role: 'MID', games: 1, prob: 1 }]);
      } finally {
        db.close();
      }
    });
  });

  it('leaves role_prob empty when there are no participants', async () => {
    await withSeededDb(async (dbPath) => {
      const db = openDb(dbPath);
      try {
        const rows = aggregateRoleProb(db);
        expect(rows).toEqual([]);
        expect(db.prepare('SELECT COUNT(*) AS count FROM role_prob').get()).toMatchObject({
          count: 0,
        });
      } finally {
        db.close();
      }
    }, false);
  });
});
