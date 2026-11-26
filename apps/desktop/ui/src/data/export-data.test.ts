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
import { createRecommendData, loadPickData } from './export-data';

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

function seedCache(overrides: { patchFiles?: Record<string, unknown> } = {}): void {
  const patchFiles: Record<string, unknown> = {
    'champions.json': champions,
    'role-prob.json': { '412': { SUPPORT: 1 } },
    ...roleFiles,
    ...overrides.patchFiles,
  };
  const manifest = {
    patch: '16.22',
    generatedAt: '2026-11-21T00:00:00Z',
    schemaVersion: 4,
    region: 'euw',
    rankBuckets: ['IRON'],
    roles: ['SUPPORT'],
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
          schemaVersion: 4,
          region: 'euw',
          rankBuckets: ['IRON'],
          roles: ['SUPPORT'],
          files: [],
        });
      }
      return base(name);
    });
    await expect(loadPickData('SUPPORT')).rejects.toThrow('does not match');
  });
});
