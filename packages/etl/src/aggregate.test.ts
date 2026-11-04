import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { migrate, openDb } from './db';
import { aggregateRoleProb, latestPatch, type RoleProbRow } from './aggregate';

function requireRow(rows: RoleProbRow[], championId: number, role: string): RoleProbRow {
  const row = rows.find((r) => r.championId === championId && r.role === role);
  if (!row) {
    throw new Error(`expected role_prob row for champion ${championId} role ${role}`);
  }
  return row;
}

function requireAt<T>(list: readonly T[], index: number): T {
  const item = list[index];
  if (item === undefined) {
    throw new Error(`expected an item at index ${index}`);
  }
  return item;
}

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
        'SELECT champion_id AS championId, role, games, games_w, games_w2, prob FROM role_prob ORDER BY champion_id, role',
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

        // Soraka: 10 support / 2 mid = 12 total, same patch so weights are equal.
        const soraka = byChampion.get(412) ?? [];
        expect(soraka.map((r) => r.role).sort()).toEqual(['MID', 'SUPPORT']);
        const support = requireRow(soraka, 412, 'SUPPORT');
        const mid = requireRow(soraka, 412, 'MID');
        expect(support.games).toBe(10);
        expect(mid.games).toBe(2);
        expect(support.prob).toBeCloseTo(10 / 12);
        expect(mid.prob).toBeCloseTo(2 / 12);
        expect(support.prob + mid.prob).toBeCloseTo(1);

        // Aatrox: 4 top games only -> prob 1.
        const aatrox = byChampion.get(266) ?? [];
        const aatroxRow = requireAt(aatrox, 0);
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

  it('only counts participants from patches up to the target patch', async () => {
    await withSeededDb(async (dbPath) => {
      const db = openDb(dbPath);
      try {
        // Add an older-patch match for Aatrox mid.
        db.prepare(
          `INSERT INTO matches (
            match_id, platform, patch, queue_id, duration, created_at, avg_rank_score,
            rank_known_count
          ) VALUES ('old1', 'euw1', '16.20', 420, 1800, 0, 6.5, 2)`,
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

        // Default (latest patch 16.21): Aatrox mid from 16.20 is decayed but retained.
        const current = aggregateRoleProb(db);
        const aatroxMid = requireRow(current, 266, 'MID');
        expect(aatroxMid.prob).toBeGreaterThan(0);
        expect(aatroxMid.games).toBe(1);
        // Decay weight < 1 so gamesW < games.
        expect(aatroxMid.gamesW).toBeLessThan(aatroxMid.games);

        // Explicit 16.20: only the old patch's evidence counts.
        const old = aggregateRoleProb(db, { patch: '16.20' });
        expect(old).toEqual([
          { championId: 266, role: 'MID', games: 1, gamesW: 1, gamesW2: 1, prob: 1 },
        ]);
      } finally {
        db.close();
      }
    });
  });

  it('newer single-match patch does not wipe champions absent from it', async () => {
    await withSeededDb(async (dbPath) => {
      const db = openDb(dbPath);
      try {
        // Aggregate first (16.21 has Soraka and Aatrox).
        const before = aggregateRoleProb(db);
        expect(before.find((r) => r.championId === 266)).toBeDefined();

        // Ingest a single new match on a newer patch with a different champion.
        db.prepare(
          `INSERT INTO matches (
            match_id, platform, patch, queue_id, duration, created_at, avg_rank_score
          ) VALUES ('new1', 'euw1', '16.22', 420, 1800, 2, 6.5)`,
        ).run();
        db.prepare(
          `INSERT INTO participants (
            match_id, puuid, team_id, champion_id, role, win, rank_score,
            champion_games, mastery_points, is_expert, keystone, primary_style,
            sub_style, perks_json, items_json, kills, deaths, assists
          ) VALUES (
            'new1', 'new', 100, 99, 'SUPPORT', 1, null, 0, NULL, NULL, 8439, 8400, 8300, '{}', '[]', 0, 0, 0
          )`,
        ).run();

        // Re-aggregate default (latest patch 16.22): 16.21 evidence is decayed but retained.
        const after = aggregateRoleProb(db);
        expect(after.find((r) => r.championId === 266 && r.role === 'TOP')).toBeDefined();
        expect(after.find((r) => r.championId === 412 && r.role === 'SUPPORT')).toBeDefined();
        // New champion 99 appears from 16.22.
        expect(after.find((r) => r.championId === 99 && r.role === 'SUPPORT')).toBeDefined();
      } finally {
        db.close();
      }
    });
  });

  it('absent champion keeps decayed evidence across patches', async () => {
    await withSeededDb(async (dbPath) => {
      const db = openDb(dbPath);
      try {
        // 16.21: Soraka support games.
        const before = aggregateRoleProb(db);
        const sorakaBefore = requireRow(before, 412, 'SUPPORT');
        expect(sorakaBefore.games).toBe(10);

        // Ingest only on a newer patch without Soraka.
        db.prepare(
          `INSERT INTO matches (
            match_id, platform, patch, queue_id, duration, created_at, avg_rank_score
          ) VALUES ('new2', 'euw1', '16.22', 420, 1800, 2, 6.5)`,
        ).run();
        db.prepare(
          `INSERT INTO participants (
            match_id, puuid, team_id, champion_id, role, win, rank_score,
            champion_games, mastery_points, is_expert, keystone, primary_style,
            sub_style, perks_json, items_json, kills, deaths, assists
          ) VALUES (
            'new2', 'new', 100, 266, 'TOP', 1, null, 0, NULL, NULL, 8439, 8400, 8300, '{}', '[]', 0, 0, 0
          )`,
        ).run();

        const after = aggregateRoleProb(db);
        const sorakaAfter = requireRow(after, 412, 'SUPPORT');
        // Decayed: gamesW < games because older patch evidence is down-weighted.
        expect(sorakaAfter.gamesW).toBeLessThan(sorakaAfter.games);
        expect(sorakaAfter.games).toBe(10); // raw count unchanged
      } finally {
        db.close();
      }
    });
  });

  it('n_eff is below raw count when weights are uneven', async () => {
    await withSeededDb(async (dbPath) => {
      const db = openDb(dbPath);
      try {
        // Add a much older patch match for Soraka support.
        db.prepare(
          `INSERT INTO matches (
            match_id, platform, patch, queue_id, duration, created_at, avg_rank_score
          ) VALUES ('old3', 'euw1', '16.10', 420, 1800, 0, 6.5)`,
        ).run();
        db.prepare(
          `INSERT INTO participants (
            match_id, puuid, team_id, champion_id, role, win, rank_score,
            champion_games, mastery_points, is_expert, keystone, primary_style,
            sub_style, perks_json, items_json, kills, deaths, assists
          ) VALUES (
            'old3', 'old', 100, 412, 'SUPPORT', 1, null, 0, NULL, NULL, 8439, 8400, 8300, '{}', '[]', 0, 0, 0
          )`,
        ).run();

        const rows = aggregateRoleProb(db);
        const sorakaSupport = requireRow(rows, 412, 'SUPPORT');
        // 11 raw games but uneven weights -> n_eff < 11.
        const nEff = sorakaSupport.gamesW ** 2 / sorakaSupport.gamesW2;
        expect(nEff).toBeLessThan(sorakaSupport.games);
        expect(nEff).toBeGreaterThan(0);
      } finally {
        db.close();
      }
    });
  });

  it('keeps existing role_prob rows when the target patch has no participants', async () => {
    await withSeededDb(async (dbPath) => {
      const db = openDb(dbPath);
      try {
        const before = aggregateRoleProb(db);
        const future = aggregateRoleProb(db, { patch: '99.1' });
        // Future snapshot patch: existing evidence is decayed relative to it, not wiped.
        expect(future.length).toBeGreaterThan(0);
        for (const row of future) {
          expect(row.gamesW).toBeLessThanOrEqual(row.games); // decayed or equal
          expect(row.prob).toBeGreaterThan(0);
        }
        // Probs still sum to 1 per champion.
        const byChampion = new Map<number, number>();
        for (const row of future) {
          byChampion.set(row.championId, (byChampion.get(row.championId) ?? 0) + row.prob);
        }
        for (const sum of byChampion.values()) {
          expect(sum).toBeCloseTo(1);
        }
        db.close();
        // Table not wiped: same number of persisted rows.
        expect(openAndRead(dbPath)).toHaveLength(before.length);
      } finally {
        if (db.open) db.close();
      }
    });
  });

  it('rejects a malformed patch without touching role_prob', async () => {
    await withSeededDb(async (dbPath) => {
      const db = openDb(dbPath);
      try {
        aggregateRoleProb(db);
        expect(() => aggregateRoleProb(db, { patch: '16' })).toThrow(/Invalid patch/);
        expect(() => aggregateRoleProb(db, { patch: '16.21.1' })).toThrow(/Invalid patch/);
      } finally {
        db.close();
      }
      expect(openAndRead(dbPath)).toHaveLength(3);
    });
  });

  it('latestPatch compares major.minor numerically, not by created_at', async () => {
    await withSeededDb(async (dbPath) => {
      const db = openDb(dbPath);
      try {
        // 16.9 ingested later (newer created_at) must not beat 16.21 / 16.10.
        const insert = db.prepare(
          `INSERT INTO matches (
            match_id, platform, patch, queue_id, duration, created_at, avg_rank_score
          ) VALUES (?, 'euw1', ?, 420, 1800, 999, 6.5)`,
        );
        insert.run('late9', '16.9');
        expect(latestPatch(db)).toBe('16.21');
        insert.run('p10', '16.100');
        expect(latestPatch(db)).toBe('16.100');
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
