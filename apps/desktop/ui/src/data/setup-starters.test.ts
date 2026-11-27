/**
 * Setup starter-item data-path tests (BL-031b): lazy starter-export loading
 * from the aggregate cache and the mode-switched `loadSetupStarters`
 * query, including the honest no-profile-starter-data myData state.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./aggregates', () => ({
  cacheRead: vi.fn(),
}));

import {
  PROFILE_EXPORT_SCHEMA_VERSION,
  type DraftInput,
  type ProfileExport,
  type ProfileGame,
  type RecommendData,
  type StarterChampionExport,
  type StarterRoleExport,
} from '@draftorb/shared';

import { cacheRead as readDataFile } from './aggregates';
import type { PickData } from './export-data';
import { loadSetupStarters, loadStarterExports } from './setup-starters';

const mockRead = vi.mocked(readDataFile);

const PATCH = '16.22';

const recommendData: RecommendData = {
  baselines: [[7, 'DIAMOND', 30, 50, 0.1, 50]],
  allyPairs: [],
  enemyPairs: [],
  laneVs: [],
  laneFull: [],
  roleProb: { '7': { SUPPORT: 1 }, '10': { ADC: 1 }, '20': { SUPPORT: 1 }, '30': { ADC: 1 } },
  tags: {},
  championIds: [7, 10, 20, 30],
};

const pickData: PickData = {
  patch: PATCH,
  generatedAt: '2026-11-21T00:00:00Z',
  champions: [],
  data: recommendData,
  minimal: false,
};

const draft: DraftInput = {
  userRank: 'DIAMOND',
  userRole: 'SUPPORT',
  allies: [{ championId: 10, role: 'ADC' }],
  enemies: [
    { championId: 20, role: 'SUPPORT' },
    { championId: 30, role: 'ADC' },
  ],
  blindPick: false,
};

const BUNDLE = {
  items: [{ itemId: 2052, count: 1 }],
  winsW: 30,
  gamesW: 50,
  gamesW2: 0.1,
  winrate: 0.6,
  pickShare: 0.4,
  players: 12,
};

const championExport: StarterChampionExport = {
  championId: 7,
  myRole: 'SUPPORT',
  contexts: [
    {
      rankBucket: 'DIAMOND',
      contextKey: 'champion',
      contextLevel: 2,
      bundles: [BUNDLE],
    },
  ],
};

const roleExport: StarterRoleExport = {
  myRole: 'SUPPORT',
  contexts: [
    {
      rankBucket: 'DIAMOND',
      contextKey: 'role',
      contextLevel: 3,
      bundles: [BUNDLE],
    },
    {
      rankBucket: 'DIAMOND',
      contextKey: 'global',
      contextLevel: 4,
      bundles: [BUNDLE],
    },
  ],
};

const NOW_MS = 20_370 * 86_400_000;

function makeGame(): ProfileGame {
  return {
    createdAtDay: 20_370,
    championId: 7,
    role: 'SUPPORT',
    win: true,
    allyAdcId: 99,
    enemySupportId: 98,
    enemyAdcId: null,
    enemyChampionIds: [50, 51, 52],
    runes: null,
    items: [],
    itemsOrdered: null,
    summonerSpells: [4, 14],
  };
}

function makeProfile(games: ProfileGame[]): ProfileExport {
  return {
    schemaVersion: PROFILE_EXPORT_SCHEMA_VERSION,
    id: 'test-profile',
    riotId: { gameName: 'Test', tagLine: 'One', platform: 'EUW1' },
    label: "Test's picks",
    syncedAt: NOW_MS,
    gameCount: games.length,
    favorites: { combined: [], recency: [], mastery: [] },
    games,
    mastery: [],
  };
}

function seedCache(
  files: Record<string, unknown>,
  manifestSchemaVersion = 8,
  manifestPaths: string[] = Object.keys(files),
): void {
  const manifest = {
    patch: PATCH,
    generatedAt: '2026-11-21T00:00:00Z',
    schemaVersion: manifestSchemaVersion,
    region: 'euw',
    rankBuckets: ['DIAMOND'],
    roles: ['SUPPORT'],
    minimalRoles: [],
    files: manifestPaths.map((path) => ({ path })),
  };
  const latest = {
    schemaVersion: 1,
    patch: PATCH,
    manifest: `${PATCH}/manifest.json`,
    generatedAt: '2026-11-21T00:00:00Z',
  };
  const byPath: Record<string, unknown> = {
    'latest.json': latest,
    [`${PATCH}/manifest.json`]: manifest,
    ...Object.fromEntries(Object.entries(files).map(([p, v]) => [`${PATCH}/${p}`, v])),
  };
  mockRead.mockImplementation(async (name: string) => {
    const value = byPath[name];
    return value === undefined ? null : JSON.stringify(value);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadStarterExports', () => {
  it('returns empty exports when nothing is cached', async () => {
    mockRead.mockResolvedValue(null);
    expect(await loadStarterExports('SUPPORT', 7)).toEqual({});
  });

  it('loads the champion and role fallback files independently', async () => {
    seedCache({ 'roles/SUPPORT/starters/7.json': championExport });
    const onlyChampion = await loadStarterExports('SUPPORT', 7);
    expect(onlyChampion.championExport?.contexts).toHaveLength(1);
    expect(onlyChampion.roleExport).toBeUndefined();

    seedCache({
      'roles/SUPPORT/starters/7.json': championExport,
      'roles/SUPPORT/starters.json': roleExport,
    });
    const both = await loadStarterExports('SUPPORT', 7);
    expect(both.roleExport?.contexts).toHaveLength(2);
  });

  it('throws on a corrupt starter export (fail-closed)', async () => {
    seedCache({
      'roles/SUPPORT/starters/7.json': championExport,
      'roles/SUPPORT/starters.json': roleExport,
    });
    const base = mockRead.getMockImplementation();
    if (base === undefined) throw new Error('expected seeded mock');
    mockRead.mockImplementation(async (name: string) =>
      name === `${PATCH}/roles/SUPPORT/starters.json` ? '{not json' : base(name),
    );
    await expect(loadStarterExports('SUPPORT', 7)).rejects.toThrow();
  });

  it('ignores cached starter files the current manifest no longer lists', async () => {
    // A same-patch refresh dropped both exports: the stale copies survive
    // in the patch directory but must not be served (BL-031b review).
    seedCache(
      {
        'roles/SUPPORT/starters/7.json': championExport,
        'roles/SUPPORT/starters.json': roleExport,
      },
      8,
      [],
    );
    expect(await loadStarterExports('SUPPORT', 7)).toEqual({});

    // The role fallback may still be listed while the champion file was
    // dropped: each file is checked against the manifest independently.
    seedCache(
      {
        'roles/SUPPORT/starters/7.json': championExport,
        'roles/SUPPORT/starters.json': roleExport,
      },
      8,
      ['roles/SUPPORT/starters.json'],
    );
    const partial = await loadStarterExports('SUPPORT', 7);
    expect(partial.championExport).toBeUndefined();
    expect(partial.roleExport?.contexts).toHaveLength(2);
  });

  it('rejects starter exports from a pre-v8 cache as unverifiable', async () => {
    seedCache(
      {
        'roles/SUPPORT/starters/7.json': championExport,
        'roles/SUPPORT/starters.json': roleExport,
      },
      7,
    );
    expect(await loadStarterExports('SUPPORT', 7)).toEqual({});
  });
});

describe('loadSetupStarters', () => {
  it('topPlayers mode consumes the starter exports with expert evidence', async () => {
    seedCache({
      'roles/SUPPORT/starters/7.json': championExport,
      'roles/SUPPORT/starters.json': roleExport,
    });
    const result = await loadSetupStarters({
      mode: 'topPlayers',
      championId: 7,
      draft,
      pickData,
      nowMs: NOW_MS,
    });
    expect(result.mode).toBe('topPlayers');
    expect(result.dataSource).toBe('expertAggregate');
    expect(result.dataAvailable).toBe(true);
    expect(result.picks[0]?.items).toEqual([{ itemId: 2052, count: 1 }]);
    expect(result.picks[0]?.source).toBe('championContext');
    expect(result.picks[0]?.players).toBe(12);
    expect(result.picks[0]?.pickShare).toBe(0.4);
    expect(result.evidence.kind).toBe('expert');
  });

  it('topPlayers mode without starter files falls back to the labeled broader statistic', async () => {
    seedCache({});
    const result = await loadSetupStarters({
      mode: 'topPlayers',
      championId: 7,
      draft,
      pickData,
      nowMs: NOW_MS,
    });
    expect(result.dataAvailable).toBe(false);
    expect(result.broaderStatistic?.kind).toBe('championRoleWinRate');
    expect(result.broaderStatistic?.winRate).not.toBeNull();
  });

  it('myData mode reports the honest no-starter-data state with the profile broader statistic', async () => {
    seedCache({
      'roles/SUPPORT/starters/7.json': championExport,
      'roles/SUPPORT/starters.json': roleExport,
    });
    const games = Array.from({ length: 6 }, () => makeGame());
    const result = await loadSetupStarters({
      mode: 'myData',
      championId: 7,
      draft,
      pickData,
      profile: makeProfile(games),
      nowMs: NOW_MS,
    });
    expect(result.mode).toBe('myData');
    expect(result.dataSource).toBe('profile');
    expect(result.evidence).toEqual({ kind: 'profile', minSetupGames: 5 });
    expect(result.picks).toEqual([]);
    expect(result.dataAvailable).toBe(false);
    expect(result.broaderStatistic?.kind).toBe('profileChampionWinRate');
    const readNames = mockRead.mock.calls.map(([name]) => name);
    expect(readNames.some((n) => n.includes('/starters'))).toBe(false);
  });

  it('mode switch re-queries both sources from the same inputs', async () => {
    seedCache({
      'roles/SUPPORT/starters/7.json': championExport,
      'roles/SUPPORT/starters.json': roleExport,
    });
    const profile = makeProfile(Array.from({ length: 6 }, () => makeGame()));
    const base = { championId: 7, draft, pickData, nowMs: NOW_MS } as const;
    const top = await loadSetupStarters({ ...base, mode: 'topPlayers' });
    const mine = await loadSetupStarters({ ...base, mode: 'myData', profile });
    const topAgain = await loadSetupStarters({ ...base, mode: 'topPlayers' });
    expect(top.dataSource).toBe('expertAggregate');
    expect(mine.dataSource).toBe('profile');
    expect(JSON.stringify(top)).toBe(JSON.stringify(topAgain));
  });
});
