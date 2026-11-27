import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '@draftorb/engine';
import { seed } from './export.fixtures.js';
import { createExportTestSuite } from './export.test-utils.js';
import { buildStarterFiles, parseBundleKey, type StarterCtxRow } from './starters.js';

const suite = createExportTestSuite();

function starterRow(overrides: Partial<StarterCtxRow> = {}): StarterCtxRow {
  return {
    championId: 412,
    myRole: 'SUPPORT',
    rankBucket: 'DIAMOND',
    contextKey: 'champion',
    contextLevel: 2,
    bundleKey: '2052:1,3340:1',
    winsW: 6,
    gamesW: 10,
    gamesW2: 10,
    players: 3,
    ...overrides,
  };
}

describe('parseBundleKey', () => {
  it('parses and sorts "itemId:count" pairs', () => {
    expect(parseBundleKey('3340:1,2052:1')).toEqual([
      { itemId: 2052, count: 1 },
      { itemId: 3340, count: 1 },
    ]);
    expect(parseBundleKey('2003:2')).toEqual([{ itemId: 2003, count: 2 }]);
  });

  it('rejects malformed keys', () => {
    expect(parseBundleKey('')).toBeNull();
    expect(parseBundleKey('abc')).toBeNull();
    expect(parseBundleKey('2052')).toBeNull();
    expect(parseBundleKey('2052:0')).toBeNull();
    expect(parseBundleKey('-1:1')).toBeNull();
    expect(parseBundleKey('2052:1,bad:2')).toBeNull();
  });
});

describe('buildStarterFiles', () => {
  it('writes champion files and the role fallback file', () => {
    const rows: StarterCtxRow[] = [
      starterRow({ contextKey: 'champion', contextLevel: 2, bundleKey: '2052:1' }),
      starterRow({
        contextKey: 'lane:a.ADC:10|e.SUPPORT:20|e.ADC:30',
        contextLevel: 1,
        bundleKey: '2052:1',
        gamesW: 12,
        gamesW2: 12,
      }),
      starterRow({
        championId: null,
        contextKey: 'role',
        contextLevel: 3,
        bundleKey: '2052:1',
        gamesW: 20,
        gamesW2: 20,
      }),
      starterRow({
        championId: null,
        myRole: null,
        contextKey: 'global',
        contextLevel: 4,
        bundleKey: '1054:1',
        gamesW: 30,
        gamesW2: 30,
      }),
    ];
    const { files, skippedBundles } = buildStarterFiles(rows, ['SUPPORT'], 10, 2);
    const paths = files.map((f) => f.relativePath).sort();
    expect(paths).toEqual(['roles/SUPPORT/starters.json', 'roles/SUPPORT/starters/412.json']);
    expect(skippedBundles).toBe(0);

    const champ = JSON.parse(
      files.find((f) => f.relativePath === 'roles/SUPPORT/starters/412.json')?.content ?? '{}',
    ) as { contexts: Array<{ contextKey: string; bundles: unknown[] }> };
    expect(champ.contexts.map((c) => c.contextKey).sort()).toEqual([
      'champion',
      'lane:a.ADC:10|e.SUPPORT:20|e.ADC:30',
    ]);

    const role = JSON.parse(
      files.find((f) => f.relativePath === 'roles/SUPPORT/starters.json')?.content ?? '{}',
    ) as {
      myRole: string;
      contexts: Array<{ contextKey: string; bundles: Array<{ items: unknown[] }> }>;
    };
    expect(role.myRole).toBe('SUPPORT');
    expect(role.contexts.map((c) => c.contextKey).sort()).toEqual(['global', 'role']);
    const roleBundle = role.contexts.find((c) => c.contextKey === 'role')?.bundles[0];
    expect(roleBundle?.items).toEqual([{ itemId: 2052, count: 1 }]);
  });

  it('skips malformed bundle keys and applies the evidence gates', () => {
    const rows: StarterCtxRow[] = [
      starterRow({ bundleKey: '2052:1', gamesW: 15, gamesW2: 15, players: 3 }),
      starterRow({ bundleKey: 'bad-key', gamesW: 10, gamesW2: 10, players: 3 }),
      starterRow({ bundleKey: '3340:1', gamesW: 10, gamesW2: 10, players: 1 }),
    ];
    const { files, skippedBundles } = buildStarterFiles(rows, ['SUPPORT'], 10, 2);
    expect(files).toHaveLength(1);
    expect(skippedBundles).toBe(1);
    const champ = JSON.parse(files[0]?.content ?? '{}') as {
      contexts: Array<{ bundles: Array<{ pickShare: number; players?: number }> }>;
    };
    const bundles = champ.contexts[0]?.bundles ?? [];
    expect(bundles).toHaveLength(1);
    // Denominator is the pre-gate context total: 15 + 10 + 10 = 35.
    expect(bundles[0]?.pickShare).toBeCloseTo(15 / 35, 6);
    expect(bundles[0]?.players).toBe(3);
  });
});

describe('exportJson starters', () => {
  it('writes starter files through the full export', () => {
    seed(suite.db, 'match', [{}]);
    seed(suite.db, 'starterCtx', [
      {
        championId: 412,
        myRole: 'SUPPORT',
        contextKey: 'champion',
        contextLevel: 2,
        bundleKey: '2052:1,3340:1',
        winsW: 6,
        gamesW: 10,
        gamesW2: 10,
        players: 3,
      },
      {
        championId: null,
        myRole: 'SUPPORT',
        contextKey: 'role',
        contextLevel: 3,
        bundleKey: '2052:1',
        winsW: 6,
        gamesW: 10,
        gamesW2: 10,
        players: 3,
      },
    ]);
    const result = suite.exportOnce({ roles: ['SUPPORT'] });
    expect(result.files.map((f) => f.relativePath)).toContain('roles/SUPPORT/starters/412.json');
    expect(result.files.map((f) => f.relativePath)).toContain('roles/SUPPORT/starters.json');
    const champ = suite.readFile('roles/SUPPORT/starters/412.json') as {
      contexts: Array<{ bundles: Array<{ items: Array<{ itemId: number; count: number }> }> }>;
    };
    expect(champ.contexts[0]?.bundles[0]?.items).toEqual([
      { itemId: 2052, count: 1 },
      { itemId: 3340, count: 1 },
    ]);
  });

  it('suppresses bundles below evidenceMinDistinctPlayers (D-102)', () => {
    seed(suite.db, 'match', [{}]);
    seed(suite.db, 'starterCtx', [
      {
        championId: 412,
        myRole: 'SUPPORT',
        contextKey: 'champion',
        contextLevel: 2,
        bundleKey: '2052:1',
        winsW: 6,
        gamesW: 10,
        gamesW2: 10,
        players: 1,
      },
    ]);
    const result = suite.exportOnce({
      config: { ...DEFAULT_CONFIG, evidenceMinDistinctPlayers: 2 },
      roles: ['SUPPORT'],
    });
    expect(result.files.map((f) => f.relativePath)).not.toContain(
      'roles/SUPPORT/starters/412.json',
    );
  });
});
