/**
 * Setup summoner-spell data-path tests (BL-031b): lazy summoner-export
 * loading from the aggregate cache and the mode-switched `loadSetupSpells`
 * query.
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
  type SummonerExport,
} from '@draftorb/shared';

import { cacheRead as readDataFile } from './aggregates';
import type { PickData } from './export-data';
import { loadSetupSpells, loadSummonerExport } from './setup-spells';

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

const summonerExport: SummonerExport = {
  championId: 7,
  myRole: 'SUPPORT',
  contexts: [
    {
      rankBucket: 'DIAMOND',
      contextKey: 'global',
      contextLevel: 5,
      pairs: [
        {
          summoner1Id: 4,
          summoner2Id: 14,
          winsW: 30,
          gamesW: 50,
          gamesW2: 0.1,
          winrate: 0.6,
          pickShare: 0.4,
          players: 12,
        },
      ],
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
    favorites: {},
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

describe('loadSummonerExport', () => {
  it('returns null when nothing is cached or the file is absent', async () => {
    mockRead.mockResolvedValue(null);
    expect(await loadSummonerExport('SUPPORT', 7)).toBeNull();
    seedCache({});
    expect(await loadSummonerExport('SUPPORT', 7)).toBeNull();
  });

  it('parses the per-champion summoner export', async () => {
    seedCache({ 'roles/SUPPORT/summoners/7.json': summonerExport });
    const loaded = await loadSummonerExport('SUPPORT', 7);
    expect(loaded?.contexts).toHaveLength(1);
    expect(loaded?.contexts[0]?.pairs[0]?.players).toBe(12);
  });

  it('throws on a corrupt summoner export (fail-closed)', async () => {
    seedCache({ 'roles/SUPPORT/summoners/7.json': summonerExport });
    const base = mockRead.getMockImplementation();
    if (base === undefined) throw new Error('expected seeded mock');
    mockRead.mockImplementation(async (name: string) =>
      name === `${PATCH}/roles/SUPPORT/summoners/7.json` ? '{not json' : base(name),
    );
    await expect(loadSummonerExport('SUPPORT', 7)).rejects.toThrow();
  });

  it('ignores a cached summoner file the current manifest no longer lists', async () => {
    // A same-patch refresh dropped the export: the stale copy survives in
    // the patch directory but must not be served (BL-031b review).
    seedCache({ 'roles/SUPPORT/summoners/7.json': summonerExport }, 8, []);
    expect(await loadSummonerExport('SUPPORT', 7)).toBeNull();
  });

  it('rejects summoner exports from a pre-v8 cache as unverifiable', async () => {
    // Manifest v7 predates BL-031a: the files cannot exist there, but a
    // hand-seeded stale file must still be treated as absent (fail-closed).
    seedCache({ 'roles/SUPPORT/summoners/7.json': summonerExport }, 7);
    expect(await loadSummonerExport('SUPPORT', 7)).toBeNull();
  });
});

describe('loadSetupSpells', () => {
  it('topPlayers mode consumes the summoner export with expert evidence', async () => {
    seedCache({ 'roles/SUPPORT/summoners/7.json': summonerExport });
    const result = await loadSetupSpells({
      mode: 'topPlayers',
      championId: 7,
      draft,
      pickData,
      nowMs: NOW_MS,
    });
    expect(result.mode).toBe('topPlayers');
    expect(result.dataSource).toBe('expertAggregate');
    expect(result.dataAvailable).toBe(true);
    expect(result.picks[0]?.spell1Id).toBe(4);
    expect(result.picks[0]?.spell2Id).toBe(14);
    expect(result.picks[0]?.players).toBe(12);
    expect(result.picks[0]?.pickShare).toBe(0.4);
    expect(result.evidence.kind).toBe('expert');
  });

  it('topPlayers mode without a summoner file falls back to the labeled broader statistic', async () => {
    seedCache({});
    const result = await loadSetupSpells({
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

  it('myData mode reads the profile and never touches the summoner export', async () => {
    seedCache({ 'roles/SUPPORT/summoners/7.json': summonerExport });
    const games = Array.from({ length: 6 }, () => makeGame());
    const result = await loadSetupSpells({
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
    expect(result.dataAvailable).toBe(true);
    expect(result.picks[0]?.games).toBe(6);
    const readNames = mockRead.mock.calls.map(([name]) => name);
    expect(readNames.some((n) => n.includes('/summoners/'))).toBe(false);
  });

  it('mode switch re-queries both sources from the same inputs', async () => {
    seedCache({ 'roles/SUPPORT/summoners/7.json': summonerExport });
    const profile = makeProfile(Array.from({ length: 6 }, () => makeGame()));
    const base = { championId: 7, draft, pickData, nowMs: NOW_MS } as const;
    const top = await loadSetupSpells({ ...base, mode: 'topPlayers' });
    const mine = await loadSetupSpells({ ...base, mode: 'myData', profile });
    const topAgain = await loadSetupSpells({ ...base, mode: 'topPlayers' });
    expect(top.dataSource).toBe('expertAggregate');
    expect(mine.dataSource).toBe('profile');
    expect(JSON.stringify(top)).toBe(JSON.stringify(topAgain));
  });
});
