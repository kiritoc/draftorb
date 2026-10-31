import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type Database from 'better-sqlite3';
import { DEFAULT_CONFIG, nEff } from '@draftorb/engine';

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

interface ToyGame {
  patch: string;
  rankScore: number;
  win: number;
  rankKnownCount?: number;
  championId?: number;
  role?: string;
  participantRankScore?: number | null;
}

let toyMatchIndex = 0;

function seedGames(db: Database.Database, games: ToyGame[]): void {
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
    ) VALUES (?, ?, 100, ?, ?, ?, ?, 0, NULL, NULL, 8439, 8400, 8300, '{}', '[]', 0, 0, 0)`,
  );
  for (const game of games) {
    toyMatchIndex += 1;
    const matchId = `toy${toyMatchIndex}`;
    insertMatch.run(matchId, game.patch, game.rankScore, game.rankKnownCount ?? 2);
    insertParticipant.run(
      matchId,
      `toy-p${toyMatchIndex}`,
      game.championId ?? 412,
      game.role ?? 'SUPPORT',
      game.win,
      game.participantRankScore === undefined ? game.rankScore : game.participantRankScore,
    );
  }
}

function withSeededDb(games: ToyGame[], run: (db: Database.Database) => void): void {
  withFreshDb((dbPath) => {
    const db = openDb(dbPath);
    try {
      migrate(db);
      seedGames(db, games);
      run(db);
    } finally {
      db.close();
    }
  });
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

  it('rejects a malformed snapshot patch and preserves existing baselines', () => {
    withFreshDb((dbPath) => {
      seedBasic(dbPath);
      const db = openDb(dbPath);
      try {
        const before = aggregateBaseline(db);
        expect(before.length).toBeGreaterThan(0);
        expect(() => aggregateBaseline(db, { patch: 'bad' })).toThrow(/Invalid patch/);
        expect(db.prepare('SELECT COUNT(*) AS count FROM baseline').get()).toMatchObject({
          count: before.length,
        });
      } finally {
        db.close();
      }
    });
  });

  it('excludes matches newer than the snapshot patch and measures recency from it', () => {
    withSeededDb(
      [
        { patch: '16.9', rankScore: 6.5, win: 1 },
        { patch: '16.10', rankScore: 6.5, win: 0 },
        { patch: '16.11', rankScore: 6.5, win: 1 },
      ],
      (db) => {
        // Numeric patch order: 16.9 < 16.10 < 16.11 (not lexical).
        const rows = aggregateBaseline(db, { patch: '16.10' });
        const diamond = requireRow(rows, 412, 'SUPPORT', 'DIAMOND');
        expect(diamond.games).toBe(2);
        expect(diamond.gamesW).toBeCloseTo(1 + DEFAULT_CONFIG.decay);
        expect(diamond.winsW).toBeCloseTo(DEFAULT_CONFIG.decay);
      },
    );
  });

  it('uses a snapshot patch with no stored games as the current patch', () => {
    withSeededDb([{ patch: '16.20', rankScore: 6.5, win: 1 }], (db) => {
      const rows = aggregateBaseline(db, { patch: '16.21' });
      const diamond = requireRow(rows, 412, 'SUPPORT', 'DIAMOND');
      expect(diamond.gamesW).toBeCloseTo(DEFAULT_CONFIG.decay);
    });
  });

  it('counts a participant with unknown rank using the match rank', () => {
    withSeededDb([{ patch: '16.21', rankScore: 6.5, win: 1, participantRankScore: null }], (db) => {
      const diamond = requireRow(aggregateBaseline(db), 412, 'SUPPORT', 'DIAMOND');
      expect(diamond.games).toBe(1);
      expect(diamond.gamesW).toBeCloseTo(1);
    });
  });

  it('down-weights games where only the seed rank is known', () => {
    withSeededDb([{ patch: '16.21', rankScore: 6.5, win: 1, rankKnownCount: 1 }], (db) => {
      const diamond = requireRow(aggregateBaseline(db), 412, 'SUPPORT', 'DIAMOND');
      expect(diamond.gamesW).toBeCloseTo(DEFAULT_CONFIG.unknownRankFactor);
      expect(diamond.gamesW2).toBeCloseTo(DEFAULT_CONFIG.unknownRankFactor ** 2);
      expect(diamond.games).toBe(1);
    });
  });

  it('keeps games exactly rankWindowTiers below the user bucket', () => {
    // GOLD (3) vs PLATINUM (4) vs DIAMOND (6): Diamond user window floor is 6 - 2 = 4.
    withSeededDb(
      [
        { patch: '16.21', rankScore: 4.5, win: 1 },
        { patch: '16.21', rankScore: 3.5, win: 1 },
      ],
      (db) => {
        const diamond = requireRow(aggregateBaseline(db), 412, 'SUPPORT', 'DIAMOND');
        expect(diamond.games).toBe(1);
        expect(diamond.gamesW).toBeCloseTo(Math.exp(-2 / DEFAULT_CONFIG.tau));
      },
    );
  });

  it('clamps out-of-range rank scores to the first and last buckets', () => {
    withSeededDb(
      [
        { patch: '16.21', rankScore: 9.2, win: 1, championId: 1 },
        { patch: '16.21', rankScore: -0.5, win: 1, championId: 2 },
      ],
      (db) => {
        const rows = aggregateBaseline(db);
        expect(requireRow(rows, 1, 'SUPPORT', 'MASTER_PLUS').gamesW).toBeCloseTo(1);
        expect(requireRow(rows, 2, 'SUPPORT', 'IRON').gamesW).toBeCloseTo(1);
      },
    );
  });

  it('keys rows by champion and role', () => {
    withSeededDb(
      [
        { patch: '16.21', rankScore: 6.5, win: 1, championId: 412, role: 'SUPPORT' },
        { patch: '16.21', rankScore: 6.5, win: 0, championId: 412, role: 'MID' },
        { patch: '16.21', rankScore: 6.5, win: 1, championId: 99, role: 'SUPPORT' },
      ],
      (db) => {
        const rows = aggregateBaseline(db);
        expect(requireRow(rows, 412, 'SUPPORT', 'DIAMOND').winsW).toBeCloseTo(1);
        expect(requireRow(rows, 412, 'MID', 'DIAMOND').winsW).toBeCloseTo(0);
        expect(requireRow(rows, 99, 'SUPPORT', 'DIAMOND').games).toBe(1);
        expect(nEff(requireRow(rows, 412, 'MID', 'DIAMOND').gamesW, 1)).toBeCloseTo(1);
      },
    );
  });

  it('is idempotent across reruns', () => {
    withSeededDb(
      [
        { patch: '16.20', rankScore: 6.5, win: 1 },
        { patch: '16.21', rankScore: 5.5, win: 0 },
      ],
      (db) => {
        const first = aggregateBaseline(db);
        const second = aggregateBaseline(db);
        expect(second).toEqual(first);
        expect(db.prepare('SELECT COUNT(*) AS count FROM baseline').get()).toMatchObject({
          count: first.length,
        });
      },
    );
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
