/**
 * recommendSetupStarters: mode-switched starter-item data path (BL-031b,
 * SPECS §8.3/§18.5, D-086 bundle half via D-134, D-102/D-103) — evidence
 * fields, Master+ toggle, labeled broader-statistic fallback, and the
 * honest no-profile-starter-data state for myData.
 */

import { describe, expect, it } from 'vitest';

import {
  PROFILE_EXPORT_SCHEMA_VERSION,
  SETUP_STARTERS_RESULT_SCHEMA_VERSION,
  setupStartersResultSchema,
  type DraftInput,
  type ProfileExport,
  type ProfileGame,
  type StarterBundleItem,
  type StarterBundlePick,
  type StarterChampionExport,
  type StarterContextEntry,
  type StarterRoleExport,
} from '@draftorb/shared';

import { DEFAULT_CONFIG, DEFAULT_STARTER_CONFIG } from '../src/config.js';
import { recommendSetupStarters, type SetupStartersData } from '../src/setup.js';
import { asRoleProb, makeData, must } from '../src/recommend-test-utils.js';

const NOW_MS = 20_370 * 86_400_000;
const CHAMP = 7;

function draft(overrides: Partial<DraftInput> = {}): DraftInput {
  return {
    userRank: 'DIAMOND',
    userRole: 'SUPPORT',
    allies: [{ championId: 10, role: 'ADC' }],
    enemies: [
      { championId: 20, role: 'SUPPORT' },
      { championId: 30, role: 'ADC' },
    ],
    blindPick: false,
    ...overrides,
  };
}

function items(...pairs: Array<[number, number]>): StarterBundleItem[] {
  return pairs.map(([itemId, count]) => ({ itemId, count }));
}

function bundle(
  bundleItems: StarterBundleItem[],
  over: Partial<StarterBundlePick> = {},
): StarterBundlePick {
  return {
    items: bundleItems,
    winsW: 30,
    gamesW: 50,
    gamesW2: 0.1,
    winrate: 0.6,
    pickShare: 0.4,
    players: 12,
    ...over,
  };
}

function ctx(
  contextKey: string,
  contextLevel: number,
  bundles: StarterBundlePick[],
): StarterContextEntry {
  return { rankBucket: 'DIAMOND', contextKey, contextLevel, bundles };
}

function champExp(contexts: StarterContextEntry[]): StarterChampionExport {
  return { championId: CHAMP, myRole: 'SUPPORT', contexts };
}

function roleExp(contexts: StarterContextEntry[]): StarterRoleExport {
  return { myRole: 'SUPPORT', contexts };
}

const ROLE_PROB = asRoleProb({
  '7': { SUPPORT: 1 },
  '10': { ADC: 1 },
  '20': { SUPPORT: 1 },
  '30': { ADC: 1 },
});

function setupData(): SetupStartersData {
  return makeData({ champions: [7, 10, 20, 30], roleProb: ROLE_PROB });
}

const BLADE = items([2052, 1]);

function makeGame(over: Partial<ProfileGame> = {}): ProfileGame {
  return {
    createdAtDay: 20_370,
    championId: CHAMP,
    role: 'SUPPORT',
    win: true,
    allyAdcId: 10,
    enemySupportId: 20,
    enemyAdcId: 30,
    enemyChampionIds: [20, 30, 40, 41, 42],
    runes: null,
    items: [],
    itemsOrdered: null,
    summonerSpells: [4, 14],
    ...over,
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

describe('recommendSetupStarters — topPlayers mode', () => {
  it('returns expert evidence fields and labeled bundle sources', () => {
    const result = recommendSetupStarters(draft(), CHAMP, setupData(), {
      mode: 'topPlayers',
      championExport: champExp([ctx('champion', 2, [bundle(BLADE)])]),
      roleExport: roleExp([ctx('role', 3, [bundle(BLADE)]), ctx('global', 4, [bundle(BLADE)])]),
      nowMs: NOW_MS,
    });
    expect(result.mode).toBe('topPlayers');
    expect(result.dataSource).toBe('expertAggregate');
    expect(result.dataAvailable).toBe(true);
    expect(result.schemaVersion).toBe(SETUP_STARTERS_RESULT_SCHEMA_VERSION);
    expect(result.evidence).toEqual({
      kind: 'expert',
      playerWeightCap: DEFAULT_CONFIG.evidencePlayerWeightCap,
      minDistinctPlayers: DEFAULT_CONFIG.evidenceMinDistinctPlayers,
      masterPlusOnly: false,
      masterPlusOptional: true,
    });
    const pick = must(result.picks[0]);
    expect(pick.items).toEqual(BLADE);
    expect(pick.winRate).not.toBeNull();
    expect(pick.nEff).toBeGreaterThan(0);
    expect(pick.players).toBe(12);
    expect(pick.pickShare).toBe(0.4);
    expect(pick.source).toBe('championContext');
    expect(pick.sourceLevel).toBe(2);
    expect(pick.insufficientData).toBe(false);
    expect(result.broaderStatistic).toBeNull();
    expect(() => setupStartersResultSchema.parse(result)).not.toThrow();
  });

  it('labels lane, role and global sources separately', () => {
    const laneBundle = bundle(items([2053, 1]), { pickShare: 0.5 });
    const roleBundle = bundle(items([3340, 1]));
    const globalBundle = bundle(items([1055, 1]));
    const result = recommendSetupStarters(draft(), CHAMP, setupData(), {
      mode: 'topPlayers',
      championExport: champExp([
        ctx('lane:a.ADC:10|e.SUPPORT:20|e.ADC:30', 1, [laneBundle]),
        ctx('champion', 2, [bundle(BLADE)]),
      ]),
      roleExport: roleExp([ctx('role', 3, [roleBundle]), ctx('global', 4, [globalBundle])]),
      nowMs: NOW_MS,
      starterConfig: { ...DEFAULT_STARTER_CONFIG, topBundles: 4 },
    });
    const sources = result.picks.map((p) => p.source);
    expect(sources).toContain('laneContext');
    expect(sources).toContain('championContext');
    expect(sources).toContain('roleContext');
    expect(sources).toContain('global');
  });

  it('falls back to the labeled champion role win rate when starter data is absent (D-103)', () => {
    const result = recommendSetupStarters(draft(), CHAMP, setupData(), {
      mode: 'topPlayers',
      nowMs: NOW_MS,
    });
    expect(result.dataAvailable).toBe(false);
    expect(result.picks).toEqual([]);
    expect(result.broaderStatistic?.kind).toBe('championRoleWinRate');
    expect(result.broaderStatistic?.winRate).not.toBeNull();
    expect(() => setupStartersResultSchema.parse(result)).not.toThrow();
  });

  it('flags bundles below the distinct-player gate as insufficient (D-102)', () => {
    const thin = bundle(BLADE, { players: 2 });
    const result = recommendSetupStarters(draft(), CHAMP, setupData(), {
      mode: 'topPlayers',
      championExport: champExp([ctx('champion', 2, [thin])]),
      nowMs: NOW_MS,
    });
    expect(result.picks).toHaveLength(1);
    expect(result.picks[0]?.insufficientData).toBe(true);
    expect(result.dataAvailable).toBe(false);
    expect(result.broaderStatistic?.kind).toBe('championRoleWinRate');
  });
});

describe('recommendSetupStarters — myData mode', () => {
  it('always reports the insufficient-data state: the profile has no starter-window data', () => {
    const games = Array.from({ length: 10 }, () => makeGame());
    const result = recommendSetupStarters(draft(), CHAMP, setupData(), {
      mode: 'myData',
      profile: makeProfile(games),
      nowMs: NOW_MS,
    });
    expect(result.mode).toBe('myData');
    expect(result.dataSource).toBe('profile');
    expect(result.evidence).toEqual({ kind: 'profile', minSetupGames: 5 });
    expect(result.picks).toEqual([]);
    expect(result.dataAvailable).toBe(false);
    // The labeled D-103 profile broader statistic still shows.
    expect(result.broaderStatistic?.kind).toBe('profileChampionWinRate');
    expect(result.broaderStatistic?.winRate).not.toBeNull();
    expect(() => setupStartersResultSchema.parse(result)).not.toThrow();
  });

  it('reports insufficient data without a profile export', () => {
    const result = recommendSetupStarters(draft(), CHAMP, setupData(), {
      mode: 'myData',
      nowMs: NOW_MS,
    });
    expect(result.dataAvailable).toBe(false);
    expect(result.picks).toEqual([]);
    expect(result.broaderStatistic).toBeNull();
  });
});
