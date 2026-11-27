/**
 * Rune catalog tests (BL-030b): id -> name/icon indexing, CDN URL building
 * and the cached `runes.json` loader.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./aggregates', () => ({
  cacheRead: vi.fn(),
}));

import type { RuneTrees } from '@draftorb/shared';

import { cacheRead as readDataFile } from './aggregates';
import { buildRuneIconIndex, loadRuneCatalog, runeIconUrl } from './runes';

const mockRead = vi.mocked(readDataFile);

const TREES: RuneTrees = [
  {
    id: 8000,
    key: 'inspiration',
    name: 'Inspiration',
    icon: 'perk-images/Styles/7200_Inspiration.png',
    slots: [
      {
        runes: [{ id: 8112, key: 'phase-rush', name: 'Phase Rush', icon: 'perk-images/StatMods/StatModsAdaptiveForceIcon.png' }],
      },
      {
        runes: [{ id: 8010, key: 'triple-tadpole', name: 'Triple Toadstool', icon: 'perk-images/StatMods/StatModsAdaptiveForceIcon.png' }],
      },
    ],
  },
  {
    id: 8100,
    key: 'precision',
    name: 'Precision',
    icon: 'perk-images/Styles/7201_Precision.png',
    slots: [
      {
        runes: [{ id: 8005, key: 'conqueror', name: 'Conqueror', icon: 'perk-images/StatMods/StatModsAdaptiveForceIcon.png' }],
      },
    ],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildRuneIconIndex', () => {
  it('indexes style ids and every perk id', () => {
    const index = buildRuneIconIndex(TREES);
    expect(index.get(8000)?.name).toBe('Inspiration');
    expect(index.get(8112)?.name).toBe('Phase Rush');
    expect(index.get(8005)?.name).toBe('Conqueror');
    expect(index.has(9999)).toBe(false);
  });
});

describe('runeIconUrl', () => {
  it('builds the CDN URL and returns null without a version', () => {
    expect(runeIconUrl('16.22.1', 'perk-images/x.png')).toBe(
      'https://ddragon.leagueoflegends.com/cdn/16.22.1/img/perk-images/x.png',
    );
    expect(runeIconUrl(null, 'perk-images/x.png')).toBeNull();
  });
});

describe('loadRuneCatalog', () => {
  it('returns null when the cached release has no catalog', async () => {
    mockRead.mockResolvedValue(null);
    expect(await loadRuneCatalog('16.22')).toBeNull();
  });

  it('parses the cached catalog', async () => {
    mockRead.mockResolvedValue(JSON.stringify(TREES));
    const trees = await loadRuneCatalog('16.22');
    expect(trees).toHaveLength(2);
    expect(mockRead).toHaveBeenCalledWith('16.22/runes.json');
  });

  it('throws on a corrupt catalog (fail-closed)', async () => {
    mockRead.mockResolvedValue('{not json');
    await expect(loadRuneCatalog('16.22')).rejects.toThrow();
  });
});
