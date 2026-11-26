import { describe, expect, it } from 'vitest';

import { buildSampleReport, type SampleReportEntry } from './sample-report';

const entry = (path: string, json: unknown): SampleReportEntry => ({ path, json });

describe('buildSampleReport', () => {
  it('computes rows and n_eff stats per role-table file', () => {
    const reports = buildSampleReport([
      entry('roles/TOP/baseline.json', [
        [412, 'IRON', 6, 10, 10, 3],
        [99, 'GOLD', 1, 4, 4],
      ]),
      entry('roles/TOP/lane-vs.json', [[300, 412, null, 'DIAMOND', 8, 10, 8]]),
    ]);

    expect(reports).toHaveLength(1);
    const top = reports[0];
    expect(top?.role).toBe('TOP');
    expect(top?.files.map((f) => f.path)).toEqual([
      'roles/TOP/baseline.json',
      'roles/TOP/lane-vs.json',
    ]);
    // n_eff: 10, 4 for baseline; 100/8 = 12.5 for lane-vs.
    expect(top?.files[0]).toMatchObject({ rows: 2, nEffMin: 4, nEffMax: 10 });
    expect(top?.files[0]?.nEffMedian).toBeCloseTo(7);
    expect(top?.files[1]).toMatchObject({ rows: 1, nEffMin: 12.5, nEffMedian: 12.5 });
    // Pooled: [4, 10, 12.5] -> median 10.
    expect(top?.rows).toBe(3);
    expect(top?.nEffMedian).toBe(10);
    expect(top?.nEffMax).toBe(12.5);
  });

  it('uses the right weight indices for every table layout', () => {
    const reports = buildSampleReport([
      entry('roles/JUNGLE/ally-pairs.json', [[1, 2, 'SUPPORT', 'IRON', 5, 10, 10]]),
      entry('roles/JUNGLE/enemy-pairs.json', [[1, 2, 'MID', 'IRON', 5, 10, 10]]),
      entry('roles/JUNGLE/lane-full.json', [[1, null, 2, null, 'IRON', 5, 10, 10]]),
    ]);
    for (const file of reports[0]?.files ?? []) {
      expect(file.rows).toBe(1);
      expect(file.nEffMin).toBe(10);
    }
  });

  it('collects page/item weights from nested rune and build files', () => {
    const reports = buildSampleReport([
      entry('roles/TOP/runes/412.json', {
        championId: 412,
        myRole: 'TOP',
        contexts: [
          {
            rankBucket: 'IRON',
            contextKey: 'global',
            contextLevel: 5,
            pages: [
              { gamesW: 10, gamesW2: 10 },
              { gamesW: 5, gamesW2: 5 },
            ],
          },
        ],
      }),
      entry('roles/TOP/builds/412.json', {
        championId: 412,
        myRole: 'TOP',
        contexts: [
          {
            slotIdx: 0,
            items: [
              { itemId: 1, gamesW: 20, gamesW2: 20 },
              { itemId: 2, gamesW: 4, gamesW2: 4 },
            ],
          },
        ],
      }),
      entry('roles/TOP/build-paths/412.json', {
        championId: 412,
        myRole: 'TOP',
        contexts: [{ slotIdx: 6, items: [{ itemId: 9, gamesW: 8, gamesW2: 8 }] }],
      }),
    ]);

    const files = reports[0]?.files ?? [];
    expect(files.map((f) => [f.path, f.rows])).toEqual([
      ['roles/TOP/build-paths/412.json', 1],
      ['roles/TOP/builds/412.json', 2],
      ['roles/TOP/runes/412.json', 2],
    ]);
    expect(files[1]?.nEffMin).toBe(4);
    expect(files[1]?.nEffMax).toBe(20);
  });

  it('reports empty files with zero rows and null stats', () => {
    const reports = buildSampleReport([entry('roles/MID/baseline.json', [])]);
    expect(reports[0]?.files[0]).toMatchObject({
      rows: 0,
      nEffMin: null,
      nEffMedian: null,
      nEffMax: null,
    });
  });

  it('ignores non-role paths and groups roles independently', () => {
    const reports = buildSampleReport([
      entry('role-prob.json', { '412': { SUPPORT: 1 } }),
      entry('champions.json', {}),
      entry('roles/SUPPORT/baseline.json', [[1, 'IRON', 1, 10, 10]]),
      entry('roles/TOP/baseline.json', [[2, 'IRON', 1, 4, 4]]),
    ]);
    expect(reports.map((r) => r.role)).toEqual(['SUPPORT', 'TOP']);
  });

  it('rejects malformed table files instead of reporting wrong stats', () => {
    expect(() =>
      buildSampleReport([entry('roles/TOP/baseline.json', { not: 'an array' })]),
    ).toThrow(/not a tuple array/);
    expect(() =>
      buildSampleReport([entry('roles/TOP/baseline.json', [[1, 'IRON', 1, 'x', 10]])]),
    ).toThrow(/missing weight columns/);
  });
});
