import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, nEff } from '@draftorb/engine';

import { openDb, migrate } from './db';
import { aggregateBaseline, type BaselineRow } from './aggregate-baseline';
import {
  requireRow,
  seedBasic,
  seedGames,
  withFreshDb,
  withSeededDb,
} from './aggregate-baseline-helpers';

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
        const db2 = openDb(dbPath);
        try {
          const persisted = db2
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
          db2.close();
        }
      } finally {
        db.close();
      }
    });
  });

  it('yields n_eff below the raw count when weights are uneven', () => {
    withSeededDb(
      [
        { patch: '16.20', rankScore: 6.5, win: 1 },
        { patch: '16.21', rankScore: 6.5, win: 0 },
      ],
      (db) => {
        // Patch 16.20 (index 0, recency 0.85), patch 16.21 (index 1, current, recency 1).
        const rows = aggregateBaseline(db);
        const diamond = requireRow(rows, 412, 'SUPPORT', 'DIAMOND');
        // w = 0.85 + 1.0 = 1.85, wins_w = 0.85, games_w2 = 0.85^2 + 1 = 1.7225
        // n_eff = 1.85^2 / 1.7225 ≈ 1.987 < 2 (raw count)
        expect(diamond.gamesW).toBeCloseTo(1.85);
        expect(diamond.gamesW2).toBeCloseTo(1.7225);
        expect(diamond.games).toBe(2);
        expect(nEff(diamond.gamesW, diamond.gamesW2)).toBeCloseTo(1.9871);
        expect(nEff(diamond.gamesW, diamond.gamesW2)).toBeLessThan(diamond.games);
      },
    );
  });

  it('counts raw games only for games with positive weight, per champion and role', () => {
    withSeededDb(
      [
        { patch: '16.21', rankScore: 6.5, win: 1, championId: 412, role: 'SUPPORT' },
        { patch: '16.21', rankScore: 6.5, win: 0, championId: 412, role: 'SUPPORT' },
        // GOLD (3) is below the DIAMOND window floor (6 - rankWindowTiers(2) = 4):
        // weight 0, excluded from DIAMOND games.
        { patch: '16.21', rankScore: 3.5, win: 1, championId: 412, role: 'SUPPORT' },
      ],
      (db) => {
        const rows = aggregateBaseline(db);
        const dia = requireRow(rows, 412, 'SUPPORT', 'DIAMOND');
        expect(dia.games).toBe(2); // only the two weight-1 DIAMOND games
        expect(dia.gamesW).toBeCloseTo(2);
        expect(dia.winsW).toBeCloseTo(1);
      },
    );
  });

  it('uses a participant with unknown rank using the match rank', () => {
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
        expect(diamond.games).toBe(1); // only PLATINUM (4) is within the window
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
      },
    );
  });

  it('is idempotent across reruns', () => {
    withFreshDb((dbPath) => {
      const db = openDb(dbPath);
      try {
        migrate(db);
        seedGames(db, [
          { patch: '16.20', rankScore: 6.5, win: 1 },
          { patch: '16.21', rankScore: 5.5, win: 0 },
        ]);
        const first = aggregateBaseline(db);
        const second = aggregateBaseline(db);
        expect(second).toEqual(first);
        expect(db.prepare('SELECT COUNT(*) AS count FROM baseline').get()).toMatchObject({
          count: first.length,
        });
      } finally {
        db.close();
      }
    });
  });

  it('preserves existing baselines when the snapshot predates all stored matches', () => {
    withSeededDb([{ patch: '16.21', rankScore: 6.5, win: 1 }], (db) => {
      const before = aggregateBaseline(db);
      expect(before.length).toBeGreaterThan(0);
      expect(aggregateBaseline(db, { patch: '16.1' })).toEqual([]);
      expect(db.prepare('SELECT COUNT(*) AS count FROM baseline').get()).toMatchObject({
        count: before.length,
      });
    });
  });

  it('leaves baseline empty when there are no participants', () => {
    withFreshDb((dbPath) => {
      const db = openDb(dbPath);
      try {
        migrate(db);
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
