import { describe, expect, it } from 'vitest';

import { matchupConfigFromReport } from './backtest-validation.js';

describe('matchupConfigFromReport (D-128)', () => {
  it('returns null for a missing or malformed report (fail-safe off)', () => {
    expect(matchupConfigFromReport(null)).toBeNull();
    expect(matchupConfigFromReport('nope')).toBeNull();
    expect(matchupConfigFromReport({})).toBeNull();
    expect(matchupConfigFromReport({ validationStatus: 'validated' })).toBeNull();
  });

  it('returns null unless the report is validated AND matchup.enabled', () => {
    expect(
      matchupConfigFromReport({
        validationStatus: 'unvalidated',
        matchup: { enabled: true, shrinkageK: 100 },
      }),
    ).toBeNull();
    expect(
      matchupConfigFromReport({
        validationStatus: 'validated',
        matchup: { enabled: false, shrinkageK: null },
      }),
    ).toBeNull();
    expect(
      matchupConfigFromReport({ validationStatus: 'validated', matchup: null }),
    ).toBeNull();
  });

  it('returns the shrinkage k for a validated shrunk variant', () => {
    expect(
      matchupConfigFromReport({
        validationStatus: 'validated',
        matchup: { enabled: true, variant: 'shrunk', shrinkageK: 100 },
      }),
    ).toEqual({ enabled: true, shrinkK: 100 });
  });

  it('returns shrinkK 0 for a validated full-matchup variant', () => {
    expect(
      matchupConfigFromReport({
        validationStatus: 'validated',
        matchup: { enabled: true, variant: 'full', shrinkageK: 0 },
      }),
    ).toEqual({ enabled: true, shrinkK: 0 });
  });

  it('rejects an enabled matchup block without a sane shrinkageK', () => {
    for (const shrinkageK of [null, 'x', -1, Number.NaN]) {
      expect(
        matchupConfigFromReport({
          validationStatus: 'validated',
          matchup: { enabled: true, shrinkageK },
        }),
      ).toBeNull();
    }
  });
});
