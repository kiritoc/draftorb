import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '@draftorb/engine';

import { openDb } from './db';
import { seedPatches } from './patches.test-helpers';
import { aggregateBaseline } from './aggregate-baseline';
import { requireRow, seedBasic, withFreshDb, withSeededDb } from './aggregate-baseline-helpers';

describe('aggregateBaseline — patch filtering / snapshot', () => {
  it('rejects a malformed snapshot patch and preserves existing baselines', () => {
    withFreshDb((dbPath) => {
      const db = openDb(dbPath);
      try {
        seedBasic(dbPath);
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
      seedPatches(db, ['16.21']);
      const rows = aggregateBaseline(db, { patch: '16.21' });
      const diamond = requireRow(rows, 412, 'SUPPORT', 'DIAMOND');
      expect(diamond.gamesW).toBeCloseTo(DEFAULT_CONFIG.decay);
    });
  });
});
