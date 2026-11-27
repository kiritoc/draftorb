/**
 * Public export loader tests (BL-009): latest.json -> manifest -> patch
 * files -> RecommendData, with readDataFile mocked (cache reads).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./aggregates', () => ({
  cacheRead: vi.fn(),
}));

import type { ChampionTagsMap } from '@draftorb/shared';

import { cacheRead as readDataFile } from './aggregates';
import { createRecommendData, loadChampionCatalog, loadPickData } from './export-data';

const mockRead = vi.mocked(readDataFile);

const champions = {
  '412': { id: 412, name: 'Soraka', icon: 'Soraka.png', roles: ['SUPPORT' as const] },
};

const tags: ChampionTagsMap = {
  '412': {
    championId: 412,
    damageType: 'AP',
    archetype: 'enchanter',
    hardEngage: false,
    peel: true,
    poke: false,
    waveclear: false,
    scaling: { early: false, mid: true, late: true },
    range: 'RANGED',
    ccCount: 1,
  },
};

const roleFiles = {
  'roles/SUPPORT/baseline.json': [[412, 'IRON', 6, 10, 10, 3]],
  'roles/SUPPORT/ally-pairs.json': [[412, 22, 'ADC', 'IRON', 2, 4, 4]],
  'roles/SUPPORT/enemy-pairs.json': [[412, 89, 'SUPPORT', 'IRON', 1, 3, 3]],
  'roles/SUPPORT/lane-vs.json': [[412, 89, 22, 'IRON', 1, 3, 3]],
  'roles/SUPPORT/lane-full.json': [[412, 22, 89, 22, 'IRON', 1, 3, 3]],
};

function seedCache(
  overrides: {
    patchFiles?: Record<string, unknown>;
    roles?: ('SUPPORT' | 'ADC')[];
    minimalRoles?: ('SUPPORT' | 'ADC')[];
    schemaVersion?: number;
  } = {},
): void {
  const patchFiles: Record<string, unknown> = {
    'champions.json': champions,
    'role-prob.json': { '412': { SUPPORT: 1 } },
    ...roleFiles,
    ...overrides.patchFiles,
  };
  const manifest = {
    patch: '16.22',
    generatedAt: '2026-11-21T00:00:00Z',
    schemaVersion: overrides.schemaVersion ?? 6,
    region: 'euw',
    rankBuckets: ['IRON'],
    roles: overrides.roles ?? ['SUPPORT'],
    minimalRoles: overrides.minimalRoles ?? [],
    files: [...Object.keys(patchFiles), '/latest.json', '/champion-tags.json'].map((path) => ({
      path,
      sha256: '0'.repeat(64),
    })),
  };
  const latest = {
    schemaVersion: 1,
    patch: '16.22',
    manifest: '16.22/manifest.json',
    generatedAt: '2026-11-21T00:00:00Z',
  };
  const byPath: Record<string, unknown> = {
    'latest.json': latest,
    '16.22/manifest.json': manifest,
    'champion-tags.json': tags,
    ...Object.fromEntries(Object.entries(patchFiles).map(([p, v]) => [`16.22/${p}`, v])),
  };
  mockRead.mockImplementation(async (name: string) => {
    const value = byPath[name];
    return value === undefined ? null : JSON.stringify(value);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createRecommendData', () => {
  it('validates and connects all role-specific files for the role', () => {
    const data = createRecommendData(
      { ...roleFiles, 'role-prob.json': { '412': { SUPPORT: 1 } } },
      Object.values(champions),
      tags,
      'SUPPORT',
    );
    expect(data.baselines).toHaveLength(1);
    expect(data.allyPairs).toHaveLength(1);
    expect(data.enemyPairs).toHaveLength(1);
    expect(data.laneVs).toHaveLength(1);
    expect(data.laneFull).toHaveLength(1);
    expect(data.roleProb['412']).toEqual({ SUPPORT: 1 });
    expect(data.tags['412']?.archetype).toBe('enchanter');
    expect(data.championIds).toEqual([412]);
  });

  it('throws when a required role file is missing', () => {
    const { 'roles/SUPPORT/lane-full.json': _omitted, ...rest } = roleFiles;
    expect(() =>
      createRecommendData({ ...rest, 'role-prob.json': { '412': { SUPPORT: 1 } } }, Object.values(champions), tags, 'SUPPORT'),
    ).toThrow('lane-full.json');
  });

  it('builds empty pair/lane tables for a minimal role without the files (BL-024)', () => {
    const data = createRecommendData(
      {
        'roles/ADC/baseline.json': [[412, 'IRON', 6, 10, 10, 3]],
        'role-prob.json': { '412': { ADC: 1 } },
        'pick-rate.json': { ADC: { '412': 0.5, '1': 0.5 } },
      },
      Object.values(champions),
      tags,
      'ADC',
      true,
    );
    expect(data.baselines).toHaveLength(1);
    expect(data.allyPairs).toEqual([]);
    expect(data.enemyPairs).toEqual([]);
    expect(data.laneVs).toEqual([]);
    expect(data.laneFull).toEqual([]);
    expect(data.pickRate?.ADC?.['412']).toBe(0.5);
  });
});

describe('loadChampionCatalog', () => {
  it('returns null when nothing is cached', async () => {
    mockRead.mockResolvedValue(null);
    expect(await loadChampionCatalog()).toBeNull();
  });

  it('returns the champion catalog without loading role files', async () => {
    seedCache();
    const catalog = await loadChampionCatalog();
    expect(catalog?.patch).toBe('16.22');
    expect(catalog?.champions.map((c) => c.id)).toEqual([412]);
    // Only latest.json, the manifest and champions.json are read.
    const readNames = mockRead.mock.calls.map(([name]) => name);
    expect(readNames).not.toContain('16.22/roles/SUPPORT/baseline.json');
  });

  it('still loads when a role file is corrupt (pool editor use case)', async () => {
    seedCache();
    const base = mockRead.getMockImplementation();
    if (base === undefined) throw new Error('expected seeded mock');
    mockRead.mockImplementation(async (name: string) =>
      name === '16.22/roles/SUPPORT/baseline.json' ? '{not json' : base(name),
    );
    const catalog = await loadChampionCatalog();
    expect(catalog?.champions.map((c) => c.id)).toEqual([412]);
  });
});

describe('loadPickData', () => {
  it('returns null when nothing is cached', async () => {
    mockRead.mockResolvedValue(null);
    expect(await loadPickData('SUPPORT')).toBeNull();
  });

  it('builds PickData from latest.json, manifest and patch files', async () => {
    seedCache();
    const pick = await loadPickData('SUPPORT');
    expect(pick?.patch).toBe('16.22');
    expect(pick?.generatedAt).toBe('2026-11-21T00:00:00Z');
    expect(pick?.champions.map((c) => c.id)).toEqual([412]);
    expect(pick?.data.baselines).toHaveLength(1);
    expect(mockRead).toHaveBeenCalledWith('champion-tags.json');
    // Archive-root manifest entries are not re-read through the manifest loop.
    const readCounts = new Map<string, number>();
    for (const [name] of mockRead.mock.calls) {
      readCounts.set(name, (readCounts.get(name) ?? 0) + 1);
    }
    expect(readCounts.get('latest.json')).toBe(1);
    expect(readCounts.get('champion-tags.json')).toBe(1);
  });

  it('loads a minimal role from baseline.json only and flags it (BL-024)', async () => {
    seedCache({
      roles: ['ADC'],
      minimalRoles: ['ADC'],
      patchFiles: {
        'role-prob.json': { '412': { ADC: 1 } },
        'roles/ADC/baseline.json': [[412, 'IRON', 6, 10, 10, 3]],
        'pick-rate.json': { ADC: { '412': 1 } },
      },
    });
    const pick = await loadPickData('ADC');
    expect(pick?.minimal).toBe(true);
    expect(pick?.data.baselines).toHaveLength(1);
    expect(pick?.data.allyPairs).toEqual([]);
    expect(pick?.data.enemyPairs).toEqual([]);
    expect(pick?.data.laneVs).toEqual([]);
    expect(pick?.data.laneFull).toEqual([]);
    expect(pick?.data.pickRate?.ADC?.['412']).toBe(1);
  });

  it('loads pick-rate-samples.json as display-only PickData, outside RecommendData (BL-052)', async () => {
    seedCache({
      patchFiles: {
        'pick-rate.json': { SUPPORT: { '412': 1 } },
        'pick-rate-samples.json': { SUPPORT: { '412': 30 } },
      },
    });
    const pick = await loadPickData('SUPPORT');
    expect(pick?.pickRateSamples).toEqual({ SUPPORT: { '412': 30 } });
    // Display-only: the engine input schema stays unchanged (D-024/D-101).
    expect('pickRateSamples' in (pick?.data ?? {})).toBe(false);
  });

  it('leaves pickRateSamples undefined on exports without the file', async () => {
    seedCache();
    const pick = await loadPickData('SUPPORT');
    expect(pick?.pickRateSamples).toBeUndefined();
  });

  it('still loads a cached v5 manifest (pre-samples export) without pick share (BL-052)', async () => {
    // Offline launch on a cache written before pick-rate-samples.json
    // existed: the manifest validates against the frozen v5 schema and the
    // optional file is simply absent (PR #168 review).
    seedCache({ schemaVersion: 5 });
    const pick = await loadPickData('SUPPORT');
    expect(pick?.data.baselines).toHaveLength(1);
    expect(pick?.pickRateSamples).toBeUndefined();
  });

  it('rejects a malformed pick-rate-samples.json (fail-closed)', async () => {
    seedCache({
      patchFiles: { 'pick-rate-samples.json': { SUPPORT: { '412': -1 } } },
    });
    await expect(loadPickData('SUPPORT')).rejects.toThrow();
  });

  it('accepts a manifest path without the patch prefix', async () => {
    seedCache();
    const base = mockRead.getMockImplementation();
    if (base === undefined) throw new Error('expected seeded mock');
    mockRead.mockImplementation(async (name: string) => {
      if (name === 'latest.json') {
        return JSON.stringify({
          schemaVersion: 1,
          patch: '16.22',
          manifest: 'manifest.json',
          generatedAt: '2026-11-21T00:00:00Z',
        });
      }
      return base(name);
    });
    const pick = await loadPickData('SUPPORT');
    expect(pick?.patch).toBe('16.22');
  });

  it('throws when the manifest patch does not match latest.json', async () => {
    seedCache();
    const base = mockRead.getMockImplementation();
    if (base === undefined) throw new Error('expected seeded mock');
    mockRead.mockImplementation(async (name: string) => {
      if (name === '16.22/manifest.json') {
        return JSON.stringify({
          patch: '16.21',
          generatedAt: '2026-11-21T00:00:00Z',
          schemaVersion: 6,
          region: 'euw',
          rankBuckets: ['IRON'],
          roles: ['SUPPORT'],
          minimalRoles: [],
          files: [],
        });
      }
      return base(name);
    });
    await expect(loadPickData('SUPPORT')).rejects.toThrow('does not match');
  });
});
