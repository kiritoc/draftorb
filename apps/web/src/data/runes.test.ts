import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RuneExport, RuneTrees } from '@draftorb/shared';
import { buildRuneIconIndex, loadRuneCatalog, loadRuneExport, runeIconUrl } from './runes';

const originalFetch = globalThis.fetch;

const runeExportFixture: RuneExport = {
  championId: 412,
  myRole: 'SUPPORT',
  contexts: [
    {
      rankBucket: 'DIAMOND',
      contextKey: 'lane:a.ADC:10,e.SUPPORT:20,e.ADC:30',
      contextLevel: 1,
      pages: [
        {
          primaryStyleId: 8000,
          subStyleId: 8400,
          keystoneId: 8005,
          selectedPerkIds: [8005, 8010],
          statShardIds: [5008],
          winsW: 100,
          gamesW: 200,
          gamesW2: 400,
          winrate: 0.5,
          pickShare: 0.4,
        },
      ],
    },
  ],
};

const treesFixture: RuneTrees = [
  {
    id: 8000,
    key: 'Precision',
    icon: 'perk-images/Styles/7201_Precision.png',
    name: 'Precision',
    slots: [
      {
        runes: [
          {
            id: 8005,
            key: 'PressTheAttack',
            name: 'Press the Attack',
            icon: 'perk-images/Styles/Precision/PressTheAttack/PressTheAttack.png',
          },
          {
            id: 8010,
            key: 'PresenceOfMind',
            name: 'Presence of Mind',
            icon: 'perk-images/Styles/Precision/PresenceOfMind/PresenceOfMind.png',
          },
        ],
      },
    ],
  },
  {
    id: 8400,
    key: 'Domination',
    icon: 'perk-images/Styles/7204_Domination.png',
    name: 'Domination',
    slots: [
      {
        runes: [
          {
            id: 8128,
            key: 'Electrocute',
            name: 'Electrocute',
            icon: 'perk-images/Styles/Domination/Electrocute/Electrocute.png',
          },
        ],
      },
    ],
  },
];

describe('rune data helpers', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('loads and validates a per-champion rune export', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(runeExportFixture), { status: 200 }),
    );
    const result = await loadRuneExport('16.21', 'SUPPORT', 412);
    expect(result?.championId).toBe(412);
    expect(globalThis.fetch).toHaveBeenCalledWith('16.21/roles/SUPPORT/runes/412.json');
  });

  it('returns null on 404 and throws on other failures', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('not found', { status: 404 }),
    );
    await expect(loadRuneExport('16.21', 'SUPPORT', 999)).resolves.toBeNull();

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('boom', { status: 500 }),
    );
    await expect(loadRuneExport('16.21', 'SUPPORT', 999)).rejects.toThrow(/Failed to load/);
  });

  it('loads and validates the static rune catalog', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(treesFixture), { status: 200 }),
    );
    const trees = await loadRuneCatalog('16.21');
    expect(trees).toHaveLength(2);
    expect(globalThis.fetch).toHaveBeenCalledWith('16.21/runes.json');
  });

  it('indexes style and perk ids for icon lookup', () => {
    const index = buildRuneIconIndex(treesFixture);
    expect(index.get(8000)?.name).toBe('Precision');
    expect(index.get(8400)?.icon).toBe('perk-images/Styles/7204_Domination.png');
    expect(index.get(8005)?.name).toBe('Press the Attack');
    expect(index.get(8128)?.name).toBe('Electrocute');
    // Stat shard ids are not part of the catalog.
    expect(index.get(5008)).toBeUndefined();
  });

  it('builds CDN urls only with a resolved version', () => {
    expect(runeIconUrl(null, 'perk-images/x.png')).toBeNull();
    expect(runeIconUrl('16.21.1', 'perk-images/x.png')).toBe(
      'https://ddragon.leagueoflegends.com/cdn/16.21.1/img/perk-images/x.png',
    );
  });
});
