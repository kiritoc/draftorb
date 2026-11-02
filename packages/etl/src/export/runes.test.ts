import { describe, expect, it } from 'vitest';

import { RUNE_CONTEXT_LEVELS } from '@draftorb/shared';
import { seed, supportRuneRow, validPerksJson } from './export.fixtures.js';
import { createExportTestSuite } from './export.test-utils.js';
import { buildRuneFiles } from './runes.js';

const suite = createExportTestSuite();

describe('exportJson', () => {
  it('exports runes with computed pickShare (B4), skips invalid pages, groups by (championId, myRole) (B6)', () => {
    seed(suite.db, 'match', [{}]);
    seed(suite.db, 'runeCtx', [
      {
        championId: 412,
        myRole: 'SUPPORT',
        contextKey: 'lane:SUPPORT|ADC',
        contextLevel: 1,
        perksHash: 'a',
        perksJson: validPerksJson,
        gamesW: 15,
        gamesW2: 15,
        winsW: 6,
        players: 2,
      },
      {
        championId: 412,
        myRole: 'SUPPORT',
        contextKey: 'lane:SUPPORT|ADC',
        contextLevel: 1,
        perksHash: 'b',
        perksJson: validPerksJson,
        gamesW: 10,
        gamesW2: 10,
        winsW: 4,
        players: 1,
      },
      {
        championId: 412,
        myRole: 'MID',
        contextKey: 'global',
        contextLevel: RUNE_CONTEXT_LEVELS.global,
        perksHash: 'c',
        perksJson: validPerksJson,
        gamesW: 10,
        gamesW2: 10,
        winsW: 6,
        players: 1,
      },
      {
        championId: 412,
        myRole: 'SUPPORT',
        contextKey: 'invalid:lane:SUPPORT|ADC',
        contextLevel: 1,
        perksHash: 'd',
        perksJson: 'not json',
        gamesW: 10,
        gamesW2: 10,
        winsW: 6,
        players: 1,
      }, // unparseable
      {
        championId: 412,
        myRole: 'SUPPORT',
        contextKey: 'global',
        contextLevel: 5,
        perksHash: 'e',
        perksJson: JSON.stringify({
          statPerks: {},
          styles: [
            { style: 0, selections: [] },
            { style: 0, selections: [] },
          ],
        }),
        gamesW: 10,
        gamesW2: 10,
        winsW: 6,
        players: 1,
      }, // primaryStyleId <= 0
    ]);
    const result = suite.exportOnce({ roles: ['SUPPORT', 'MID'] as const });
    const runes = suite.readFile('roles/SUPPORT/runes/412.json') as {
      championId: number;
      myRole: string;
      contexts: Array<{
        contextKey: string;
        contextLevel: number;
        pages: Array<{ pickShare: number; gamesW: number }>;
      }>;
    };
    expect(runes.championId).toBe(412);
    expect(runes.myRole).toBe('SUPPORT');
    expect(runes.contexts).toHaveLength(1);
    const context = runes.contexts[0];
    if (context === undefined) throw new Error('missing context');
    const pages = context.pages;
    expect(pages).toHaveLength(2);
    // Shares use raw gamesW: 15/25 and 10/25.
    const first = pages[0];
    const second = pages[1];
    if (first === undefined || second === undefined) throw new Error('missing pages');
    expect(first.pickShare).toBe(0.6);
    expect(second.pickShare).toBe(0.4);
    expect(Math.abs(first.pickShare + second.pickShare - 1)).toBeLessThanOrEqual(1e-6);
    expect(first.pickShare).toBeLessThanOrEqual(1);
    expect(second.pickShare).toBeLessThanOrEqual(1);
    expect(first.gamesW).toBe(15);
    expect(second.gamesW).toBe(10);
    // C3: skipped count non-zero (rows d and e are unparseable/invalid).
    expect(result.skippedRunePages).toBeGreaterThan(0);
    expect(result.warnings).toContain(
      `export: skipped ${result.skippedRunePages} rune page(s) with unparseable or invalid perks_json`,
    );
    // B6: MID role file exists under roles/MID (separate group).
    expect(result.files.map((f) => f.relativePath)).toContain('roles/MID/runes/412.json');
  });

  it('gates a low-sample global context and uses the raw pre-gate context denominator (X1, X3)', () => {
    seed(suite.db, 'match', [{}]);
    seed(suite.db, 'runeCtx', [
      supportRuneRow({
        contextKey: 'global',
        contextLevel: RUNE_CONTEXT_LEVELS.global,
        perksHash: 'kept',
        gamesW: 10.1234567,
        gamesW2: 10.1234567,
      }),
      supportRuneRow({
        contextKey: 'global',
        contextLevel: RUNE_CONTEXT_LEVELS.global,
        perksHash: 'below-gate',
        gamesW: 4.8765433,
        gamesW2: 4.8765433,
      }),
      supportRuneRow({
        contextKey: 'global',
        contextLevel: RUNE_CONTEXT_LEVELS.global,
        perksHash: 'invalid-below-gate',
        perksJson: 'not json',
        gamesW: 1,
        gamesW2: 1,
      }),
      supportRuneRow({
        championId: 26,
        contextKey: 'global',
        contextLevel: RUNE_CONTEXT_LEVELS.global,
        gamesW: 5,
        gamesW2: 5,
      }),
    ]);

    const result = suite.exportOnce();
    const output = suite.readFile<{
      contexts: Array<{ pages: Array<{ pickShare: number }> }>;
    }>('roles/SUPPORT/runes/412.json');
    const pages = output.contexts[0]?.pages ?? [];
    expect(pages).toHaveLength(1);
    expect(pages[0]?.pickShare).toBe(Math.round((10.1234567 / 16) * 1e6) / 1e6);
    expect(pages[0]?.pickShare).toBeLessThanOrEqual(1);
    expect(result.files.map((file) => file.relativePath)).not.toContain(
      'roles/SUPPORT/runes/26.json',
    );
  });

  it('keeps rune contexts separate by rank bucket', () => {
    seed(suite.db, 'match', [{}]);
    seed(suite.db, 'runeCtx', [
      supportRuneRow({
        rankBucket: 'IRON',
        perksHash: 'iron-page',
        gamesW: 10,
        gamesW2: 10,
      }),
      supportRuneRow({
        rankBucket: 'DIAMOND',
        perksHash: 'diamond-page',
        gamesW: 10,
        gamesW2: 10,
      }),
    ]);

    suite.exportOnce();
    const output = suite.readFile<{
      contexts: Array<{ rankBucket: string; pages: Array<{ gamesW: number }> }>;
    }>('roles/SUPPORT/runes/412.json');

    expect(output.contexts.map((context) => context.rankBucket)).toEqual(['IRON', 'DIAMOND']);
    expect(output.contexts.map((context) => context.pages[0]?.gamesW)).toEqual([10, 10]);
  });

  it('wraps invalid role errors with the rune export path (A6)', () => {
    expect(() =>
      buildRuneFiles(
        [{ ...supportRuneRow({ myRole: 'UNKNOWN' }), rankBucket: 'IRON' }],
        ['UNKNOWN'],
        0,
      ),
    ).toThrow(/roles\/UNKNOWN\/runes\/412\.json/);
  });

  it('C3: an all-invalid champion produces no rune file and a non-zero skipped count', () => {
    seed(suite.db, 'match', [{}]);
    seed(suite.db, 'runeCtx', [
      {
        championId: 412,
        myRole: 'SUPPORT',
        contextKey: 'global',
        contextLevel: 5,
        perksHash: 'bad1',
        perksJson: 'not json',
        gamesW: 10,
        gamesW2: 10,
        winsW: 6,
        players: 1,
      },
      {
        championId: 412,
        myRole: 'SUPPORT',
        contextKey: 'global',
        contextLevel: 5,
        perksHash: 'bad2',
        perksJson: JSON.stringify({
          statPerks: {},
          styles: [
            { style: 0, selections: [] },
            { style: 0, selections: [] },
          ],
        }),
        gamesW: 10,
        gamesW2: 10,
        winsW: 6,
        players: 1,
      }, // primaryStyleId <= 0
    ]);
    const result = suite.exportOnce();
    expect(result.skippedRunePages).toBe(2);
    expect(result.files.map((f) => f.relativePath)).not.toContain('roles/SUPPORT/runes/412.json');
  });
});
