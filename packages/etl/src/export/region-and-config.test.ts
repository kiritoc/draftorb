import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '@draftorb/engine';
import { championRoleProbabilitiesSchema } from '@draftorb/shared';
import { seed } from './export.fixtures.js';
import { createExportTestSuite, PATCH } from './export.test-utils.js';
import { exportJson } from './index.js';
import { exportRoleProbabilities } from './role-prob.js';

const suite = createExportTestSuite();

describe('exportJson', () => {
  it('throws when the database has no patch to export', () => {
    expect(() => exportJson(suite.db)).toThrow(/No patch found/);
  });

  it('throws when exportMinGames > minGames (C6)', () => {
    const badConfig = { ...DEFAULT_CONFIG, exportMinGames: 30, minGames: 25 };
    expect(() => exportJson(suite.db, { patch: PATCH, config: badConfig })).toThrow(
      /must be <= minGames/,
    );
  });

  it('exports global role probabilities from stored values, renormalizing gated survivors (X2)', () => {
    seed(suite.db, 'match', [{}]);
    seed(suite.db, 'roleProb', [
      { championId: 412, role: 'SUPPORT', gamesW: 10, gamesW2: 10, prob: 0.8 }, // kept
      { championId: 412, role: 'MID', gamesW: 5, gamesW2: 25, prob: 0.2 }, // nEff=1 < 10 -> dropped
      { championId: 26, role: 'SUPPORT', gamesW: 8, gamesW2: 8, prob: 0.5 }, // nEff=8 < 10 -> dropped
    ]);
    const result = suite.exportOnce();
    const roleProb = suite.readFile('role-prob.json') as Record<string, Record<string, number>>;
    expect(Object.keys(roleProb)).toEqual(['412']);
    expect(roleProb['412']).toEqual({ SUPPORT: 1 });
    expect(roleProb['26']).toBeUndefined();
    expect(roleProb['412']?.MID).toBeUndefined();
    expect(result.patch).toBe(PATCH);
    expect(result.manifest.schemaVersion).toBe(3);
  });

  it('keeps global roles even when the roles option selects only SUPPORT (X2)', () => {
    seed(suite.db, 'match', [{}]);
    seed(suite.db, 'roleProb', [
      { championId: 412, role: 'SUPPORT', gamesW: 10, gamesW2: 10, prob: 0.75 },
      { championId: 412, role: 'MID', gamesW: 10, gamesW2: 10, prob: 0.25 }, // nEff=10 -> kept
    ]);
    suite.exportOnce({ roles: ['SUPPORT'] });
    const roleProb = suite.readFile('role-prob.json') as Record<string, Record<string, number>>;
    expect(roleProb['412']).toEqual({ SUPPORT: 0.75, MID: 0.25 });
  });

  it('fails loudly with a path when role-prob contains an unknown role (X2)', () => {
    seed(suite.db, 'match', [{}]);
    seed(suite.db, 'roleProb', [
      { championId: 412, role: 'UNRECOGNIZED', gamesW: 10, gamesW2: 10, prob: 1 },
    ]);

    expect(() => suite.exportOnce()).toThrow(/Invalid role-prob export for role-prob\.json/);
  });

  it('warns when aggregated data spans multiple platforms, including with an explicit region', () => {
    seed(suite.db, 'match', [{ patch: '16.21', platform: 'euw1', matchId: 'm1' }]);
    const singlePlatform = suite.exportOnce();
    expect(singlePlatform.manifest.region).toBe('euw1');
    expect(singlePlatform.warnings.some((warning) => warning.includes('platforms'))).toBe(false);

    seed(suite.db, 'match', [{ patch: '16.21', platform: 'na1', matchId: 'm2' }]);
    const result = suite.exportOnce();
    expect(result.manifest.region).toBe('euw1'); // alphabetically first
    expect(result.warnings.some((warning) => warning.includes('platforms'))).toBe(true);

    const explicitlyLabeled = suite.exportOnce({ region: 'kr' });
    expect(explicitlyLabeled.manifest.region).toBe('kr');
    expect(explicitlyLabeled.warnings).toContain(
      'export: database contains 2 platforms (euw1, na1); labelled as kr; aggregates combine all platforms',
    );
  });

  it('rounds equal role probabilities without violating the sum-to-one schema', () => {
    const roleProbabilities = exportRoleProbabilities(
      (['TOP', 'MID', 'SUPPORT'] as const).map((role) => ({
        championId: 412,
        role,
        gamesW: 10,
        gamesW2: 10,
        prob: 1 / 3,
      })),
      0,
    );

    expect(championRoleProbabilitiesSchema.parse(roleProbabilities)).toEqual({
      '412': { TOP: 0.333334, MID: 0.333333, SUPPORT: 0.333333 },
    });
  });

  it('assigns the rounding residual to the largest surviving role (B-049)', () => {
    // Old behavior gave the residual to the last survivor; here that would be
    // ADC (0.149999), while the largest role SUPPORT must absorb it instead.
    const roleProbabilities = exportRoleProbabilities(
      [
        { championId: 412, role: 'SUPPORT', gamesW: 10, gamesW2: 10, prob: 0.7 },
        { championId: 412, role: 'TOP', gamesW: 10, gamesW2: 10, prob: 0.1500005 },
        { championId: 412, role: 'ADC', gamesW: 10, gamesW2: 10, prob: 0.1499995 },
      ],
      0,
    );

    expect(championRoleProbabilitiesSchema.parse(roleProbabilities)).toEqual({
      '412': { SUPPORT: 0.699999, TOP: 0.150001, ADC: 0.15 },
    });
    const sum = Object.values(roleProbabilities['412'] ?? {}).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1)).toBeLessThanOrEqual(1e-6);
  });

  it('warns when the requested patch is not the latest patch in the database', () => {
    seed(suite.db, 'match', [{ patch: '16.21' }]);
    const result = suite.exportOnce({ patch: '16.20' });
    expect(
      result.warnings.some((warning) =>
        warning.includes(
          'requested patch 16.20 differs from the latest patch in the database (16.21)',
        ),
      ),
    ).toBe(true);
    expect(suite.exportOnce().warnings.some((w) => w.includes('requested patch'))).toBe(false);
  });
});
