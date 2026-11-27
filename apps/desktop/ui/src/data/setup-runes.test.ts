/**
 * Setup rune data-path tests (BL-030a): lazy rune-export loading from the
 * aggregate cache and the mode-switched `loadSetupRunes` query.
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
  type RuneExport,
} from '@draftorb/shared';

import { cacheRead as readDataFile } from './aggregates';
import type { PickData } from './export-data';
import { loadRuneExport, loadSetupRunes } from './setup-runes';

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

const runeExport: RuneExport = {
  championId: 7,
  myRole: 'SUPPORT',
  contexts: [
    {
      rankBucket: 'DIAMOND',
      contextKey: 'global',
      contextLevel: 5,
      pages: [
        {
          primaryStyleId: 8000,
          subStyleId: 8100,
          keystoneId: 8112,
          selectedPerkIds: [8010],
          statShardIds: [5001],
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
    runes: {
      keystoneId: 8112,
      primaryStyleId: 7200,
      subStyleId: 7300,
      perkIds: [8112],
      statShardIds: [5001],
    },
    items: [],
    itemsOrdered: null,
    summonerSpells: [4, 7],
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
  manifestSchemaVersion = 7,
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
    ...Object.fromEntries(
      Object.entries(files).map(([p, v]) => [`${PATCH}/${p}`, v]),
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

describe('loadRuneExport', () => {
  it('returns null when nothing is cached or the file is absent', async () => {
    mockRead.mockResolvedValue(null);
    expect(await loadRuneExport('SUPPORT', 7)).toBeNull();
    seedCache({});
    expect(await loadRuneExport('SUPPORT', 7)).toBeNull();
  });

  it('parses the per-champion rune export', async () => {
    seedCache({ 'roles/SUPPORT/runes/7.json': runeExport });
    const loaded = await loadRuneExport('SUPPORT', 7);
    expect(loaded?.contexts).toHaveLength(1);
    expect(loaded?.contexts[0]?.pages[0]?.players).toBe(12);
  });

  it('throws on a corrupt rune export (fail-closed)', async () => {
    seedCache({ 'roles/SUPPORT/runes/7.json': runeExport });
    const base = mockRead.getMockImplementation();
    if (base === undefined) throw new Error('expected seeded mock');
    mockRead.mockImplementation(async (name: string) =>
      name === `${PATCH}/roles/SUPPORT/runes/7.json` ? '{not json' : base(name),
    );
    await expect(loadRuneExport('SUPPORT', 7)).rejects.toThrow();
  });

  it('ignores a cached rune file the current manifest no longer lists', async () => {
    // A same-patch refresh dropped the export: the stale copy survives in
    // the patch directory but must not be served (BL-031b review).
    seedCache({ 'roles/SUPPORT/runes/7.json': runeExport }, 7, []);
    expect(await loadRuneExport('SUPPORT', 7)).toBeNull();
  });

  it('rejects rune exports from a pre-D-102 (v5) cache as unverifiable', async () => {
    // Manifest v5 predates BL-013a: its rune files carry no players count,
    // no weight cap and no distinct-player gate, so the evidence rules the
    // setup result reports cannot be honored. Degrade to "no rune data".
    seedCache({ 'roles/SUPPORT/runes/7.json': runeExport }, 5);
    expect(await loadRuneExport('SUPPORT', 7)).toBeNull();
  });

  it('accepts rune exports from a v6 cache (first evidence-rule layout)', async () => {
    seedCache({ 'roles/SUPPORT/runes/7.json': runeExport }, 6);
    const loaded = await loadRuneExport('SUPPORT', 7);
    expect(loaded?.contexts).toHaveLength(1);
  });
});

describe('loadSetupRunes', () => {
  it('topPlayers mode consumes the rune export with expert evidence', async () => {
    seedCache({ 'roles/SUPPORT/runes/7.json': runeExport });
    const result = await loadSetupRunes({
      mode: 'topPlayers',
      championId: 7,
      draft,
      pickData,
      nowMs: NOW_MS,
    });
    expect(result.mode).toBe('topPlayers');
    expect(result.dataSource).toBe('expertAggregate');
    expect(result.dataAvailable).toBe(true);
    expect(result.pages[0]?.players).toBe(12);
    expect(result.pages[0]?.pickShare).toBe(0.4);
    expect(result.evidence.kind).toBe('expert');
  });

  it('topPlayers mode without a rune file falls back to the labeled broader statistic', async () => {
    seedCache({});
    const result = await loadSetupRunes({
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

  it('topPlayers mode on a v5 cache falls back instead of trusting legacy rune figures', async () => {
    seedCache({ 'roles/SUPPORT/runes/7.json': runeExport }, 5);
    const result = await loadSetupRunes({
      mode: 'topPlayers',
      championId: 7,
      draft,
      pickData,
      nowMs: NOW_MS,
    });
    expect(result.dataAvailable).toBe(false);
    expect(result.pages).toEqual([]);
    expect(result.broaderStatistic?.kind).toBe('championRoleWinRate');
  });

  it('myData mode reads the profile and never touches the rune export', async () => {
    seedCache({ 'roles/SUPPORT/runes/7.json': runeExport });
    const games = Array.from({ length: 6 }, () => makeGame());
    const result = await loadSetupRunes({
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
    expect(result.pages[0]?.games).toBe(6);
    const readNames = mockRead.mock.calls.map(([name]) => name);
    expect(readNames.some((n) => n.includes('/runes/'))).toBe(false);
  });

  it('mode switch re-queries both sources from the same inputs', async () => {
    seedCache({ 'roles/SUPPORT/runes/7.json': runeExport });
    const profile = makeProfile(Array.from({ length: 6 }, () => makeGame()));
    const base = { championId: 7, draft, pickData, nowMs: NOW_MS } as const;
    const top = await loadSetupRunes({ ...base, mode: 'topPlayers' });
    const mine = await loadSetupRunes({ ...base, mode: 'myData', profile });
    const topAgain = await loadSetupRunes({ ...base, mode: 'topPlayers' });
    expect(top.dataSource).toBe('expertAggregate');
    expect(mine.dataSource).toBe('profile');
    expect(JSON.stringify(top)).toBe(JSON.stringify(topAgain));
  });
});
