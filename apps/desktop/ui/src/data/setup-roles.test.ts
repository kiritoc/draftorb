/**
 * Setup-screen role enablement tests (BL-030b, D-134): setup roles are
 * `manifest.roles` minus `manifest.minimalRoles`, independent of the
 * pick-screen D-126 baseline-coverage verdict.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./aggregates', () => ({
  cacheRead: vi.fn(),
}));

import { cacheRead as readDataFile } from './aggregates';
import { loadSetupRoles, setupRolesFromManifest } from './setup-roles';

const mockRead = vi.mocked(readDataFile);

const PATCH = '16.22';

function seedCache(manifest: Record<string, unknown>): void {
  const latest = {
    schemaVersion: 1,
    patch: PATCH,
    manifest: `${PATCH}/manifest.json`,
    generatedAt: '2026-11-21T00:00:00Z',
  };
  const byPath: Record<string, unknown> = {
    'latest.json': latest,
    [`${PATCH}/manifest.json`]: manifest,
  };
  mockRead.mockImplementation(async (name: string) => {
    const value = byPath[name];
    return value === undefined ? null : JSON.stringify(value);
  });
}

function manifestWith(roles: string[], minimalRoles: string[]): Record<string, unknown> {
  return {
    patch: PATCH,
    generatedAt: '2026-11-21T00:00:00Z',
    schemaVersion: 7,
    region: 'euw',
    rankBuckets: ['DIAMOND'],
    roles,
    minimalRoles,
    files: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('setupRolesFromManifest', () => {
  it('returns manifest roles minus minimal roles', () => {
    expect(
      setupRolesFromManifest({
        roles: ['SUPPORT', 'TOP', 'JUNGLE', 'ADC', 'MID'],
        minimalRoles: ['ADC', 'MID'],
      }),
    ).toEqual(['SUPPORT', 'TOP', 'JUNGLE']);
  });

  it('keeps manifest order and ignores minimal roles not in roles', () => {
    expect(
      setupRolesFromManifest({
        roles: ['JUNGLE', 'SUPPORT'],
        minimalRoles: ['ADC'],
      }),
    ).toEqual(['JUNGLE', 'SUPPORT']);
  });
});

describe('loadSetupRoles', () => {
  it('returns null when nothing is cached', async () => {
    mockRead.mockResolvedValue(null);
    expect(await loadSetupRoles()).toBeNull();
  });

  it('derives setup roles from the cached manifest', async () => {
    seedCache(manifestWith(['SUPPORT', 'TOP', 'JUNGLE', 'ADC', 'MID'], ['ADC', 'MID']));
    expect(await loadSetupRoles()).toEqual(['SUPPORT', 'TOP', 'JUNGLE']);
  });

  it('enables a role even when baseline coverage would fail (D-126 is pick-only)', async () => {
    // A manifest listing TOP/JUNGLE with zero cached baseline files still
    // enables them for setup: thin data is a D-103 state, not a disabled role.
    seedCache(manifestWith(['SUPPORT', 'TOP', 'JUNGLE'], []));
    expect(await loadSetupRoles()).toEqual(['SUPPORT', 'TOP', 'JUNGLE']);
  });
});
