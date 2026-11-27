/**
 * Backtest report loader tests (D-133, B-080): the matchup config comes only
 * from a manifest-listed, patch-matching `backtest-draft.json`; anything else
 * fails safe to the champion-baseline ranking.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Manifest } from '@draftorb/shared';

vi.mock('./aggregates', () => ({
  cacheRead: vi.fn(),
}));

vi.mock('./export-data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./export-data')>();
  return { ...actual, loadCachedRelease: vi.fn() };
});

import { cacheRead } from './aggregates';
import { loadCachedRelease } from './export-data';
import { loadMatchupConfig, matchupConfigFromReport } from './backtest-report';

const mockRead = vi.mocked(cacheRead);
const mockRelease = vi.mocked(loadCachedRelease);

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

describe('matchupConfigFromReport (D-133)', () => {
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

  it('returns the shrinkage k for a validated report covering the role', () => {
    expect(matchupConfigFromReport(VALIDATED, 'SUPPORT', '16.22')).toEqual({
      enabled: true,
      shrinkK: 100,
    });
    expect(matchupConfigFromReport(VALIDATED, 'TOP', '16.22')).toEqual({
      enabled: true,
      shrinkK: 100,
    });
  });

  it('rejects roles outside the report or its matchup pool', () => {
    expect(matchupConfigFromReport(VALIDATED, 'ADC', '16.22')).toBeNull();
    expect(
      matchupConfigFromReport(
        { ...VALIDATED, matchup: { ...VALIDATED.matchup, roles: ['TOP'] } },
        'SUPPORT',
        '16.22',
      ),
    ).toBeNull();
  });

  it('rejects a report validated on a different patch than the export', () => {
    expect(matchupConfigFromReport(VALIDATED, 'SUPPORT', '16.23')).toBeNull();
    expect(
      matchupConfigFromReport({ ...VALIDATED, holdoutPatch: null }, 'SUPPORT', '16.22'),
    ).toBeNull();
  });

  it('rejects an enabled matchup block without a sane shrinkageK', () => {
    for (const shrinkageK of [null, 'x', -1, Number.NaN]) {
      expect(
        matchupConfigFromReport(
          { ...VALIDATED, matchup: { ...VALIDATED.matchup, shrinkageK } },
          'SUPPORT',
          '16.22',
        ),
      ).toBeNull();
    }
  });
});

function seedRelease(manifestFiles: string[]): void {
  mockRelease.mockResolvedValue({
    latest: {
      schemaVersion: 1,
      patch: '16.22',
      manifest: '16.22/manifest.json',
      generatedAt: '2026-11-21T00:00:00Z',
    },
    manifest: {
      patch: '16.22',
      generatedAt: '2026-11-21T00:00:00Z',
      schemaVersion: 8,
      region: 'euw',
      rankBuckets: ['IRON'],
      roles: ['SUPPORT'],
      minimalRoles: [],
      files: manifestFiles.map((path) => ({ path, sha256: '0'.repeat(64) })),
    } satisfies Manifest,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadMatchupConfig (B-080)', () => {
  it('returns null when nothing is cached', async () => {
    mockRelease.mockResolvedValue(null);
    expect(await loadMatchupConfig('SUPPORT')).toBeNull();
    expect(mockRead).not.toHaveBeenCalled();
  });

  it('ignores a cached report the current manifest does not list', async () => {
    seedRelease(['/latest.json', '/champion-tags.json']);
    mockRead.mockResolvedValue(JSON.stringify(VALIDATED));
    expect(await loadMatchupConfig('SUPPORT')).toBeNull();
    expect(mockRead).not.toHaveBeenCalled();
  });

  it('returns the config for a manifest-listed validating report', async () => {
    seedRelease(['/latest.json', '/champion-tags.json', '/backtest-draft.json']);
    mockRead.mockResolvedValue(JSON.stringify(VALIDATED));
    expect(await loadMatchupConfig('SUPPORT')).toEqual({ enabled: true, shrinkK: 100 });
  });

  it('fails safe on missing or malformed cached JSON', async () => {
    seedRelease(['/backtest-draft.json']);
    mockRead.mockResolvedValue(null);
    expect(await loadMatchupConfig('SUPPORT')).toBeNull();
    mockRead.mockResolvedValue('{not json');
    expect(await loadMatchupConfig('SUPPORT')).toBeNull();
  });
});
