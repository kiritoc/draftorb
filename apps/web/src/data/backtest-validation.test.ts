import { describe, expect, it } from 'vitest';

import { matchupConfigFromReport } from './backtest-validation.js';

const VALIDATED = {
  validationStatus: 'validated',
  holdoutPatch: '16.22',
  roles: ['SUPPORT', 'TOP', 'JUNGLE'],
  matchup: {
    enabled: true,
    variant: 'shrunk',
    shrinkageK: 100,
    roles: ['SUPPORT', 'TOP', 'JUNGLE'],
  },
};

describe('matchupConfigFromReport (D-128)', () => {
  it('returns null for a missing or malformed report (fail-safe off)', () => {
    expect(matchupConfigFromReport(null, 'SUPPORT', '16.22')).toBeNull();
    expect(matchupConfigFromReport('nope', 'SUPPORT', '16.22')).toBeNull();
    expect(matchupConfigFromReport({}, 'SUPPORT', '16.22')).toBeNull();
    expect(
      matchupConfigFromReport({ validationStatus: 'validated' }, 'SUPPORT', '16.22'),
    ).toBeNull();
  });

  it('returns null unless the report is validated AND matchup.enabled', () => {
    expect(
      matchupConfigFromReport(
        { ...VALIDATED, validationStatus: 'unvalidated' },
        'SUPPORT',
        '16.22',
      ),
    ).toBeNull();
    expect(
      matchupConfigFromReport(
        { ...VALIDATED, matchup: { enabled: false, shrinkageK: null } },
        'SUPPORT',
        '16.22',
      ),
    ).toBeNull();
    expect(
      matchupConfigFromReport({ ...VALIDATED, matchup: null }, 'SUPPORT', '16.22'),
    ).toBeNull();
  });

  it('returns the shrinkage k for a validated shrunk variant', () => {
    expect(matchupConfigFromReport(VALIDATED, 'SUPPORT', '16.22')).toEqual({
      enabled: true,
      shrinkK: 100,
    });
  });

  it('returns shrinkK 0 for a validated full-matchup variant', () => {
    expect(
      matchupConfigFromReport(
        {
          ...VALIDATED,
          matchup: { ...VALIDATED.matchup, variant: 'full', shrinkageK: 0 },
        },
        'SUPPORT',
        '16.22',
      ),
    ).toEqual({ enabled: true, shrinkK: 0 });
  });

  it('rejects an enabled matchup block without a sane shrinkageK', () => {
    for (const shrinkageK of [null, 'x', -1, Number.NaN]) {
      expect(
        matchupConfigFromReport(
          {
            ...VALIDATED,
            matchup: { ...VALIDATED.matchup, enabled: true, shrinkageK },
          },
          'SUPPORT',
          '16.22',
        ),
      ).toBeNull();
    }
  });

  it('rejects a report that did not evaluate the drafted role', () => {
    // A TOP-only backtest says nothing about SUPPORT matchups.
    expect(
      matchupConfigFromReport(
        { ...VALIDATED, roles: ['TOP'] },
        'SUPPORT',
        '16.22',
      ),
    ).toBeNull();
    expect(
      matchupConfigFromReport({ ...VALIDATED, roles: ['TOP', 'JUNGLE'] }, 'TOP', '16.22'),
    ).toEqual({ enabled: true, shrinkK: 100 });
    expect(matchupConfigFromReport({ ...VALIDATED, roles: 'SUPPORT' }, 'SUPPORT', '16.22')).toBeNull();
  });

  it('rejects a role the matchup experiment did not pool', () => {
    // Top-level `roles` claims coverage, but the experiment's pooled
    // k-selection/gate only covered TOP — SUPPORT has no matchup evidence.
    expect(
      matchupConfigFromReport(
        { ...VALIDATED, matchup: { ...VALIDATED.matchup, roles: ['TOP'] } },
        'SUPPORT',
        '16.22',
      ),
    ).toBeNull();
    expect(
      matchupConfigFromReport(
        { ...VALIDATED, matchup: { enabled: true, variant: 'full', shrinkageK: 0 } },
        'SUPPORT',
        '16.22',
      ),
    ).toBeNull();
  });

  it('rejects a report validated on a different patch than the export', () => {
    expect(matchupConfigFromReport(VALIDATED, 'SUPPORT', '16.23')).toBeNull();
    expect(matchupConfigFromReport({ ...VALIDATED, holdoutPatch: null }, 'SUPPORT', '16.22')).toBeNull();
  });
});
