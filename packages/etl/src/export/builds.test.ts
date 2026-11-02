import { describe, expect, it } from 'vitest';

import { itemBuildExportSchema, runeExportSchema } from '@draftorb/shared';
import { seed, supportBuildRow, supportRuneRow } from './export.fixtures.js';
import { createExportTestSuite } from './export.test-utils.js';
import { buildBuildFiles } from './builds.js';

const suite = createExportTestSuite();

describe('exportJson', () => {
  it('exports builds with computed pickShare, no | split corruption, laneKey absent when null (B5)', () => {
    seed(suite.db, 'match', [{}]);
    seed(suite.db, 'itemBuild', [
      {
        championId: 412,
        myRole: 'SUPPORT',
        slotIdx: 1,
        timeBucket: '0-5',
        stateBucket: 'even',
        profileKey: 'AD',
        laneKey: 'lane:SUPPORT|ADC',
        itemId: 3340,
        gamesW: 15,
        gamesW2: 15,
        winsW: 6,
      },
      {
        championId: 412,
        myRole: 'SUPPORT',
        slotIdx: 1,
        timeBucket: '0-5',
        stateBucket: 'even',
        profileKey: 'AD',
        laneKey: 'lane:SUPPORT|ADC',
        itemId: 3047,
        gamesW: 10,
        gamesW2: 10,
        winsW: 4,
      },
      {
        championId: 412,
        myRole: 'SUPPORT',
        slotIdx: 0,
        timeBucket: '0-5',
        stateBucket: 'even',
        profileKey: 'AD',
        laneKey: '',
        itemId: 3340,
        gamesW: 10,
        gamesW2: 10,
        winsW: 6,
      }, // laneKey absent (DB stores '' sentinel)
    ]);
    suite.exportOnce();
    const builds = suite.readFile('roles/SUPPORT/builds/412.json') as {
      championId: number;
      myRole: string;
      contexts: Array<{
        slotIdx: number;
        laneKey?: string;
        items: Array<{ itemId: number; pickShare: number }>;
      }>;
    };
    const laneCtx = builds.contexts.find((c) => c.laneKey === 'lane:SUPPORT|ADC');
    if (laneCtx === undefined) throw new Error('missing lane context');
    expect(laneCtx.items.map((i) => i.itemId).sort((a, b) => a - b)).toEqual([3047, 3340]);
    // B4: pickShare within context = 6/10 and 4/10.
    expect(laneCtx.items.find((i) => i.itemId === 3340)?.pickShare).toBe(0.6);
    expect(laneCtx.items.find((i) => i.itemId === 3047)?.pickShare).toBe(0.4);
    expect(
      Math.abs(laneCtx.items.reduce((sum, item) => sum + item.pickShare, 0) - 1),
    ).toBeLessThanOrEqual(1e-6);
    expect(laneCtx.items.every((item) => item.pickShare <= 1)).toBe(true);
    const startCtx = builds.contexts.find((c) => c.slotIdx === 0);
    if (startCtx === undefined) throw new Error('missing start context');
    expect(startCtx.laneKey).toBeUndefined(); // null -> absent, not ''
    const firstItem = startCtx.items[0];
    if (firstItem === undefined) throw new Error('missing first item');
    expect(firstItem.itemId).toBe(3340);
  });

  it('uses the raw context total before gating build rows (X3)', () => {
    seed(suite.db, 'match', [{}]);
    seed(suite.db, 'itemBuild', [
      supportBuildRow({ gamesW: 10.1234567, gamesW2: 10.1234567 }),
      supportBuildRow({
        itemId: 3047,
        gamesW: 4.8765433,
        gamesW2: 4.8765433,
      }),
    ]);

    suite.exportOnce();
    const builds = suite.readFile<{
      contexts: Array<{ items: Array<{ pickShare: number }> }>;
    }>('roles/SUPPORT/builds/412.json');
    const items = builds.contexts[0]?.items ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]?.pickShare).toBe(Math.round((10.1234567 / 15) * 1e6) / 1e6);
    expect(items[0]?.pickShare).toBeLessThanOrEqual(1);
  });

  it('normalizes empty and null lane keys into one context (A1)', () => {
    const result = buildBuildFiles(
      [supportBuildRow({ laneKey: '' }), supportBuildRow({ laneKey: null, itemId: 3047 })],
      ['SUPPORT'],
      0,
    );
    const file = result.files[0];
    if (file === undefined) throw new Error('missing build file');
    const output = JSON.parse(file.content) as {
      contexts: Array<{ laneKey?: string; items: Array<{ itemId: number }> }>;
    };

    expect(output.contexts).toHaveLength(1);
    expect(output.contexts[0]?.laneKey).toBeUndefined();
    expect(output.contexts[0]?.items.map((item) => item.itemId).sort()).toEqual([3047, 3340]);
  });

  it('writes separate rune and build files for the same champion in multiple roles (D8)', () => {
    seed(suite.db, 'match', [{}]);
    seed(suite.db, 'runeCtx', [
      supportRuneRow({ perksHash: 'support' }),
      supportRuneRow({ myRole: 'MID', perksHash: 'mid' }),
    ]);
    seed(suite.db, 'itemBuild', [
      supportBuildRow(),
      supportBuildRow({ myRole: 'MID', itemId: 3047 }),
    ]);

    const result = suite.exportOnce({ roles: ['SUPPORT', 'MID'] });
    expect(result.files.map((file) => file.relativePath)).toContain('roles/SUPPORT/runes/412.json');
    expect(result.files.map((file) => file.relativePath)).toContain('roles/MID/runes/412.json');
    expect(result.files.map((file) => file.relativePath)).toContain(
      'roles/SUPPORT/builds/412.json',
    );
    expect(result.files.map((file) => file.relativePath)).toContain('roles/MID/builds/412.json');

    expect(runeExportSchema.parse(suite.readFile('roles/SUPPORT/runes/412.json')).myRole).toBe(
      'SUPPORT',
    );
    expect(runeExportSchema.parse(suite.readFile('roles/MID/runes/412.json')).myRole).toBe('MID');
    expect(
      itemBuildExportSchema.parse(suite.readFile('roles/SUPPORT/builds/412.json')).myRole,
    ).toBe('SUPPORT');
    expect(itemBuildExportSchema.parse(suite.readFile('roles/MID/builds/412.json')).myRole).toBe(
      'MID',
    );
  });

  it('wraps invalid role errors with the build export path (A6)', () => {
    expect(() => buildBuildFiles([supportBuildRow({ myRole: 'UNKNOWN' })], ['UNKNOWN'], 0)).toThrow(
      /roles\/UNKNOWN\/builds\/412\.json/,
    );
  });
});
