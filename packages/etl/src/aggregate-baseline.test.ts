import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { migrate, openDb } from './db';
import { aggregateBaseline, type BaselineRow } from './aggregate-baseline';

function seedBasic(dbPath: string): void {
  const db = openDb(dbPath);
  migrate(db);

  const insertMatch = db.prepare(
    `INSERT INTO matches (
      match_id, platform, patch, queue_id, duration, created_at, avg_rank_score, rank_known_count
    ) VALUES (?, 'euw1', ?, 420, 1800, 1, ?, ?)`,
  );
  const insertParticipant = db.prepare(
    `INSERT INTO participants (
      match_id, puuid, team_id, champion_id, role, win, rank_score,
      champion_games, mastery_points, is_expert, keystone, primary_style,
      sub_style, perks_json, items_json, kills, deaths, assists
    ) VALUES (?, ?, 100, ?, 'SUPPORT', ?, ?, 0, NULL, NULL, 8439, 8400, 8300, '{}', '[]', 0, 0, 0)`,
  );

  let matchIndex = 0;
  const addGame = (
    patch: string,
    rankKnownCount: number,
    rankScore: number | null,
    win: number,
  ): void => {
    const matchId = `m${(matchIndex += 1)}`;
    insertMatch.run(matchId, patch, rankScore, rankKnownCount);
    insertParticipant.run(matchId, `p${matchIndex}`, 412, win, rankScore);
  };

  // Patch 16.21 (current), full rank knowledge, all DIAMOND (bucket index 6).
  // 3 wins + 2 losses, weight 1 each for the DIAMOND user bucket.
  addGame('16.21', 2, 6.5, 1);
  addGame('16.21', 2, 6.5, 1);
  addGame('16.21', 2, 6.5, 1);
  addGame('16.21', 2, 6.5, 0);
  addGame('16.21', 2, 6.5, 0);

  // One game at SILVER (bucket index 2): weight 0 for the DIAMOND user bucket
  // (2 < 6 - rankWindowTiers(2) = 4), so it must not contribute.
  addGame('16.21', 2, 2.5, 1);

  db.close();
}

function requireRow(
  rows: BaselineRow[],
  championId: number,
  myRole: string,
  rankBucket: string,
): BaselineRow {
  const row = rows.find(
    (r) => r.championId === championId && r.myRole === myRole && r.rankBucket === rankBucket,
  );
  if (!row) {
    throw new Error(
      `expected baseline row for champion ${championId} role ${myRole} bucket ${rankBucket}`,
    );
  }
  return row;
}

function nEff(gamesW: number, gamesW2: number): number {
  return (gamesW * gamesW) / gamesW2;
}

function withFreshDb(run: (dbPath: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'draftorb-baseline-'));
  const dbPath = join(directory, 'test.sqlite');
  const originalDbPath = process.env.DRAFTORB_DB_PATH;
  process.env.DRAFTORB_DB_PATH = dbPath;
  try {
    run(dbPath);
  } finally {
    if (originalDbPath === undefined) {
      delete process.env.DRAFTORB_DB_PATH;
    } else {
      process.env.DRAFTORB_DB_PATH = originalDbPath;
    }
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('aggregateBaseline', () => {
  it('accumulates weighted counts and n_eff on toy data', () => {
    withFreshDb((dbPath) => {
      seedBasic(dbPath);
      const db = openDb(dbPath);
      try {
        const rows = aggregateBaseline(db);

        // DIAMOND user bucket: 5 contributing games, all weight 1. The SILVER
        // game (bucket index 2) is outside the rank window for DIAMOND (6):
        // 2 < 6 - rankWindowTiers(2) = 4, so its weight is 0 and it does not
        // contribute. games stays 5, not 6.
        const diamond = requireRow(rows, 412, 'SUPPORT', 'DIAMOND');
        expect(diamond.winsW).toBeCloseTo(3);
        expect(diamond.gamesW).toBeCloseTo(5);
        expect(diamond.gamesW2).toBeCloseTo(5);
        expect(diamond.games).toBe(5);
        expect(nEff(diamond.gamesW, diamond.gamesW2)).toBeCloseTo(5);

        // SILVER user bucket: DIAMOND games still contribute with small weight,
        // so a row exists (games > 0).
        const silver = requireRow(rows, 412, 'SUPPORT', 'SILVER');
        expect(silver.games).toBeGreaterThan(0);

        // Persisted rows match.
        const persisted = db
          .prepare(
            `SELECT champion_id AS championId, my_role AS myRole, rank_bucket AS rankBucket,
                    wins_w AS winsW, games_w AS gamesW, games_w2 AS gamesW2, games AS games
             FROM baseline ORDER BY champion_id, my_role, rank_bucket`,
          )
          .all() as BaselineRow[];
        expect(persisted.length).toBe(rows.length);
        for (const row of persisted) {
          expect(row.gamesW2).toBeGreaterThan(0);
          expect(row.gamesW).toBeGreaterThan(0);
        }
      } finally {
        db.close();
      }
    });
  });

  it('yields n_eff below the raw count when weights are uneven', () => {
    withFreshDb((dbPath) => {
      const db = openDb(dbPath);
      migrate(db);

      const insertMatch = db.prepare(
        `INSERT INTO matches (
          match_id, platform, patch, queue_id, duration, created_at, avg_rank_score, rank_known_count
        ) VALUES (?, 'euw1', ?, 420, 1800, 1, 6.5, 2)`,
      );
      const insertParticipant = db.prepare(
        `INSERT INTO participants (
          match_id, puuid, team_id, champion_id, role, win, rank_score,
          champion_games, mastery_points, is_expert, keystone, primary_style,
          sub_style, perks_json, items_json, kills, deaths, assists
        ) VALUES (?, ?, 100, ?, 'SUPPORT', ?, 6.5, 0, NULL, NULL, 8439, 8400, 8300, '{}', '[]', 0, 0, 0)`,
      );

      // Patch 16.20 (index 0, recency 0.85), patch 16.21 (index 1, current, recency 1).
      insertMatch.run('m-a', '16.20');
      insertParticipant.run('m-a', 'p-a', 412, 1);
      insertMatch.run('m-b', '16.21');
      insertParticipant.run('m-b', 'p-b', 412, 0);

      db.close();

      const db2 = openDb(dbPath);
      try {
        const rows = aggregateBaseline(db2);
        const diamond = requireRow(rows, 412, 'SUPPORT', 'DIAMOND');
        // w = 0.85 + 1.0 = 1.85, wins_w = 0.85, games_w2 = 0.85^2 + 1 = 1.7225
        // n_eff = 1.85^2 / 1.7225 ≈ 1.987 < 2 (raw count)
        expect(diamond.gamesW).toBeCloseTo(1.85);
        expect(diamond.gamesW2).toBeCloseTo(1.7225);
        expect(diamond.games).toBe(2);
        expect(nEff(diamond.gamesW, diamond.gamesW2)).toBeCloseTo(1.9871);
        expect(nEff(diamond.gamesW, diamond.gamesW2)).toBeLessThan(diamond.games);
      } finally {
        db2.close();
      }
    });
  });

  it('leaves baseline empty when there are no participants', () => {
    withFreshDb((dbPath) => {
      const db = openDb(dbPath);
      migrate(db);
      try {
        const rows = aggregateBaseline(db);
        expect(rows).toEqual([]);
        expect(db.prepare('SELECT COUNT(*) AS count FROM baseline').get()).toMatchObject({
          count: 0,
        });
      } finally {
        db.close();
      }
    });
  });
});
