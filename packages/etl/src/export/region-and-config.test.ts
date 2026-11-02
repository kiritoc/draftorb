import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '@draftorb/engine';
import { seed } from './export.fixtures.js';
import { createExportTestSuite, PATCH } from './export.test-utils.js';
import { exportJson } from './index.js';

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
    expect(result.manifest.schemaVersion).toBe(2);
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

  it('warns only when region is inferred from multiple platforms (C5)', () => {
    seed(suite.db, 'match', [{ patch: '16.21', platform: 'euw1', matchId: 'm1' }]);
    const singlePlatform = suite.exportOnce();
    expect(singlePlatform.manifest.region).toBe('euw1');
    expect(singlePlatform.warnings.some((warning) => warning.includes('platforms'))).toBe(false);

    seed(suite.db, 'match', [{ patch: '16.21', platform: 'na1', matchId: 'm2' }]);
    const result = suite.exportOnce();
    expect(result.manifest.region).toBe('euw1'); // alphabetically first
    expect(result.warnings.some((warning) => warning.includes('platforms'))).toBe(true);
  });
});
