/**
 * Role enablement tests (BL-050, D-126): a role is selectable iff at least
 * ROLE_COVERAGE_MIN_CHAMPIONS distinct champions have a baseline row with
 * n_eff >= minGames in the DIAMOND bucket.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./aggregates', () => ({
  cacheRead: vi.fn(),
}));

import type { Role } from '@draftorb/shared';

import { cacheRead } from './aggregates';
import { enabledRolesFromFiles, loadEnabledRoles } from './role-coverage';

const mockRead = vi.mocked(cacheRead);

/** Baseline row with n_eff = gamesW^2 / gamesW2 (SPECS §3). */
function baselineRow(championId: number, bucket = 'DIAMOND', gamesW = 50, gamesW2 = 100): unknown[] {
  // n_eff = 50^2 / 100 = 25 = minGames -> covered.
  return [championId, bucket, 30, gamesW, gamesW2];
}

/** `count` distinct champions covered in `bucket`. */
function coveredTable(count: number, bucket = 'DIAMOND'): unknown[] {
  return Array.from({ length: count }, (_, i) => baselineRow(i + 1, bucket));
}

function filesWith(role: Role, baseline: unknown): Record<string, unknown> {
  return { [`roles/${role}/baseline.json`]: baseline };
}

describe('enabledRolesFromFiles', () => {
  it('enables a role at exactly the champion threshold', () => {
    const files = filesWith('TOP', coveredTable(50));
    expect(enabledRolesFromFiles(files, ['TOP'])).toEqual(['TOP']);
  });

  it('disables a role one champion below the threshold', () => {
    const files = filesWith('TOP', coveredTable(49));
    expect(enabledRolesFromFiles(files, ['TOP'])).toEqual([]);
  });

  it('disables a role with an empty baseline', () => {
    expect(enabledRolesFromFiles(filesWith('JUNGLE', []), ['JUNGLE'])).toEqual([]);
  });

  it('disables a role whose baseline file is missing', () => {
    expect(enabledRolesFromFiles({}, ['TOP'])).toEqual([]);
  });

  it('counts only rows in the DIAMOND bucket', () => {
    const files = filesWith('TOP', coveredTable(50, 'IRON'));
    expect(enabledRolesFromFiles(files, ['TOP'])).toEqual([]);
  });

  it('does not let other buckets push a role over the threshold', () => {
    const mixed = [...coveredTable(30, 'DIAMOND'), ...coveredTable(30, 'MASTER_PLUS')];
    // champion ids collide across buckets but coverage is per-champion anyway;
    // 30 distinct DIAMOND champions stay below 50.
    const files = filesWith('TOP', mixed);
    expect(enabledRolesFromFiles(files, ['TOP'])).toEqual([]);
  });

  it('ignores rows below minGames even for many champions', () => {
    // n_eff = 50^2 / 200 = 12.5 < 25.
    const thin = Array.from({ length: 60 }, (_, i) => baselineRow(i + 1, 'DIAMOND', 50, 200));
    expect(enabledRolesFromFiles(filesWith('SUPPORT', thin), ['SUPPORT'])).toEqual([]);
  });

  it('counts a champion once when several rows pass', () => {
    // 51 passing rows but only 49 distinct champions -> stays disabled.
    const rows = [baselineRow(1), baselineRow(1), baselineRow(1), ...coveredTable(49).slice(1)];
    expect(rows).toHaveLength(51);
    expect(enabledRolesFromFiles(filesWith('TOP', rows), ['TOP'])).toEqual([]);
  });

  it('ignores non-baseline files', () => {
    const files: Record<string, unknown> = {
      'roles/TOP/ally-pairs.json': coveredTable(100),
      'roles/TOP/enemy-pairs.json': coveredTable(100),
      'role-prob.json': {},
      'pick-rate.json': {},
    };
    expect(enabledRolesFromFiles(files, ['TOP'])).toEqual([]);
  });

  it('evaluates each exported role independently', () => {
    const files = {
      ...filesWith('SUPPORT', coveredTable(50)),
      ...filesWith('TOP', coveredTable(10)),
      ...filesWith('JUNGLE', coveredTable(75)),
    };
    expect(enabledRolesFromFiles(files, ['SUPPORT', 'TOP', 'JUNGLE'])).toEqual([
      'SUPPORT',
      'JUNGLE',
    ]);
  });
});

describe('loadEnabledRoles', () => {
  function seedCache(roles: Role[], baselineByRole: Record<string, unknown[]>): void {
    const patchFiles: Record<string, unknown> = {
      'champions.json': {},
      'role-prob.json': {},
      ...Object.fromEntries(
        Object.entries(baselineByRole).map(([role, rows]) => [
          `roles/${role}/baseline.json`,
          rows,
        ]),
      ),
    };
    const manifest = {
      patch: '16.22',
      generatedAt: '2026-11-26T00:00:00Z',
      schemaVersion: 7,
      region: 'euw',
      rankBuckets: ['DIAMOND'],
      roles,
      minimalRoles: [],
      files: Object.keys(patchFiles).map((path) => ({
        path,
        sha256: '0'.repeat(64),
      })),
    };
    const byPath: Record<string, unknown> = {
      'latest.json': {
        schemaVersion: 1,
        patch: '16.22',
        manifest: '16.22/manifest.json',
        generatedAt: '2026-11-26T00:00:00Z',
      },
      '16.22/manifest.json': manifest,
      ...Object.fromEntries(
        Object.entries(patchFiles).map(([p, v]) => [`16.22/${p}`, v]),
      ),
    };
    mockRead.mockImplementation(async (name: string) => {
      const value = byPath[name];
      return value === undefined ? null : JSON.stringify(value);
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when nothing is cached', async () => {
    mockRead.mockResolvedValue(null);
    expect(await loadEnabledRoles()).toBeNull();
  });

  it('enables roles whose baseline coverage passes', async () => {
    seedCache(
      ['SUPPORT', 'TOP', 'JUNGLE'],
      {
        SUPPORT: coveredTable(64),
        TOP: coveredTable(112),
        JUNGLE: coveredTable(75),
      },
    );
    expect(await loadEnabledRoles()).toEqual(['SUPPORT', 'TOP', 'JUNGLE']);
  });

  it('keeps a thin role disabled', async () => {
    seedCache(['SUPPORT', 'TOP'], {
      SUPPORT: coveredTable(60),
      TOP: coveredTable(20),
    });
    expect(await loadEnabledRoles()).toEqual(['SUPPORT']);
  });
});
