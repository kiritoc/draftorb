import { describe, expect, it } from 'vitest';

import { pickRateSamplesSchema, pickRateSchema } from '@draftorb/shared';
import { seed } from './export.fixtures.js';
import { createExportTestSuite, PATCH } from './export.test-utils.js';
import { exportJson } from './index.js';
import {
  exportPickRateSamples,
  exportPickRates,
  pickRateFile,
  pickRateSamplesFile,
} from './pick-rate.js';
import type { RoleProbRow } from './role-prob.js';

const suite = createExportTestSuite();

function row(championId: number, role: string, gamesW: number, gamesW2 = gamesW): RoleProbRow {
  return { championId, role, gamesW, gamesW2, prob: 1 };
}

describe('exportPickRates', () => {
  it('computes per-role pick shares from gated games_w, summing to 1', () => {
    const out = exportPickRates(
      [row(1, 'SUPPORT', 30), row(2, 'SUPPORT', 10), row(3, 'ADC', 20), row(4, 'ADC', 20)],
      10,
    );
    expect(pickRateSchema.parse(out)).toEqual({
      SUPPORT: { '1': 0.75, '2': 0.25 },
      ADC: { '3': 0.5, '4': 0.5 },
    });
  });

  it('drops rows below the exportMinGames gate before renormalizing', () => {
    const out = exportPickRates(
      [row(1, 'SUPPORT', 30), row(2, 'SUPPORT', 5, 25)], // nEff=1 < 10
      10,
    );
    expect(out).toEqual({ SUPPORT: { '1': 1 } });
  });

  it('rounds shares once and assigns the residual to the largest share', () => {
    // 1/3 each: two rounded down, the first (largest after stable order) absorbs.
    const out = exportPickRates([row(1, 'MID', 10), row(2, 'MID', 10), row(3, 'MID', 10)], 0);
    const shares = out.MID ?? {};
    expect(Object.values(shares).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(pickRateSchema.parse(out)).toBeDefined();
  });

  it('fails loudly on an unknown role', () => {
    expect(() => exportPickRates([row(1, 'UNRECOGNIZED', 10)], 0)).toThrow(/pick-rate\.json/);
  });

  it('returns an empty map when no row survives the gate', () => {
    expect(exportPickRates([row(1, 'SUPPORT', 1, 100)], 10)).toEqual({});
  });
});

describe('pickRateFile', () => {
  it('writes pick-rate.json as compact JSON', () => {
    const file = pickRateFile([row(412, 'SUPPORT', 10)], 0);
    expect(file.relativePath).toBe('pick-rate.json');
    expect(file.content).toBe(JSON.stringify({ SUPPORT: { '412': 1 } }));
  });
});

describe('exportPickRateSamples', () => {
  it('exports n_eff of the same gated rows that produce the shares', () => {
    const rows = [
      row(1, 'SUPPORT', 30, 15), // nEff = 30^2/15 = 60
      row(2, 'SUPPORT', 10, 10), // nEff = 10
      row(3, 'ADC', 20, 20), // nEff = 20
    ];
    const samples = exportPickRateSamples(rows, 10);
    expect(pickRateSamplesSchema.parse(samples)).toEqual({
      SUPPORT: { '1': 60, '2': 10 },
      ADC: { '3': 20 },
    });
    // Same (role, champion) keys as the shares, so share and n always pair up.
    const shares = exportPickRates(rows, 10);
    for (const role of Object.keys(shares)) {
      expect(Object.keys(samples[role as keyof typeof samples] ?? {}).sort()).toEqual(
        Object.keys(shares[role as keyof typeof shares] ?? {}).sort(),
      );
    }
  });

  it('excludes rows below the exportMinGames gate (boundary: n_eff >= gate)', () => {
    const samples = exportPickRateSamples(
      [
        row(1, 'SUPPORT', 30, 30),
        row(2, 'SUPPORT', 9, 9), // nEff = 9 < 10 -> excluded
        row(3, 'SUPPORT', 10, 10), // nEff = 10 -> included
        row(4, 'SUPPORT', 5, 25), // nEff = 1 -> excluded
      ],
      10,
    );
    expect(samples).toEqual({ SUPPORT: { '1': 30, '3': 10 } });
  });

  it('returns an empty map when no row survives the gate', () => {
    expect(exportPickRateSamples([row(1, 'SUPPORT', 1, 100)], 10)).toEqual({});
  });

  it('fails loudly on an unknown role', () => {
    expect(() => exportPickRateSamples([row(1, 'UNRECOGNIZED', 10)], 0)).toThrow(
      /pick-rate-samples\.json/,
    );
  });
});

describe('pickRateSamplesFile', () => {
  it('writes pick-rate-samples.json as compact JSON', () => {
    const file = pickRateSamplesFile([row(412, 'SUPPORT', 10)], 0);
    expect(file.relativePath).toBe('pick-rate-samples.json');
    expect(file.content).toBe(JSON.stringify({ SUPPORT: { '412': 10 } }));
  });
});

describe('exportJson pick-rate.json', () => {
  it('is written next to role-prob.json and listed in the manifest', () => {
    seed(suite.db, 'match', [{}]);
    seed(suite.db, 'roleProb', [
      { championId: 412, role: 'SUPPORT', gamesW: 30, gamesW2: 30, prob: 0.7 },
      { championId: 26, role: 'SUPPORT', gamesW: 10, gamesW2: 10, prob: 0.3 },
      { championId: 412, role: 'ADC', gamesW: 5, gamesW2: 25, prob: 0.3 }, // nEff=1 -> dropped
    ]);
    const result = suite.exportOnce();
    const pickRate = suite.readFile('pick-rate.json') as Record<string, Record<string, number>>;
    expect(pickRate).toEqual({ SUPPORT: { '412': 0.75, '26': 0.25 } });
    expect(pickRateSchema.parse(pickRate)).toBeDefined();
    expect(result.manifest.files.map((f) => f.path)).toContain('pick-rate.json');
    expect(result.files.map((f) => f.relativePath)).toContain('pick-rate.json');
  });

  it('writes pick-rate-samples.json with the n_eff of the same gated rows (BL-052)', () => {
    seed(suite.db, 'match', [{}]);
    seed(suite.db, 'roleProb', [
      { championId: 412, role: 'SUPPORT', gamesW: 30, gamesW2: 30, prob: 0.7 },
      { championId: 26, role: 'SUPPORT', gamesW: 10, gamesW2: 10, prob: 0.3 },
      { championId: 412, role: 'ADC', gamesW: 5, gamesW2: 25, prob: 0.3 }, // nEff=1 -> dropped
    ]);
    const result = suite.exportOnce();
    const samples = suite.readFile('pick-rate-samples.json') as Record<
      string,
      Record<string, number>
    >;
    expect(pickRateSamplesSchema.parse(samples)).toEqual({
      SUPPORT: { '412': 30, '26': 10 },
    });
    expect(result.manifest.files.map((f) => f.path)).toContain('pick-rate-samples.json');
    expect(result.files.map((f) => f.relativePath)).toContain('pick-rate-samples.json');
    // The share's eligible rows are exactly the sample's: ADC has no share, so
    // it has no sample either.
    const pickRate = suite.readFile('pick-rate.json') as Record<string, Record<string, number>>;
    for (const role of Object.keys(pickRate)) {
      expect(Object.keys(samples[role] ?? {}).sort()).toEqual(
        Object.keys(pickRate[role] ?? {}).sort(),
      );
    }
  });

  it('fails loudly when role_prob contains an unknown role', () => {
    seed(suite.db, 'match', [{}]);
    seed(suite.db, 'roleProb', [
      { championId: 412, role: 'UNRECOGNIZED', gamesW: 10, gamesW2: 10, prob: 1 },
    ]);
    // role-prob.json is written first, so either file may be the one that
    // rejects the unknown role; both errors name their target file.
    expect(() => exportJson(suite.db, { patch: PATCH, publicDir: suite.publicDir })).toThrow(
      /export for .*\.json/,
    );
  });
});
