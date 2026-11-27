/**
 * recommendSetupSpells: mode-switched summoner-spell data path (BL-031b,
 * SPECS §8.5/§18.5, D-102/D-103/D-134) — evidence-rule display fields,
 * Master+ toggle, labeled broader-statistic fallback, per-mode sources.
 */

import { describe, expect, it } from 'vitest';

import {
  PROFILE_EXPORT_SCHEMA_VERSION,
  SETUP_SPELLS_RESULT_SCHEMA_VERSION,
  setupSpellsResultSchema,
  type DraftInput,
  type ProfileExport,
  type ProfileGame,
  type SummonerContextEntry,
  type SummonerExport,
  type SummonerPairExport,
} from '@draftorb/shared';

import { DEFAULT_CONFIG } from '../src/config.js';
import { recommendSetupSpells, type SetupSpellsData } from '../src/setup.js';
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

function pair(over: Partial<SummonerPairExport> = {}): SummonerPairExport {
  return {
    summoner1Id: 4,
    summoner2Id: 14,
    winsW: 30,
    gamesW: 50,
    gamesW2: 0.1,
    winrate: 0.6,
    pickShare: 0.4,
    players: 12,
    ...over,
  };
}

function summonerExport(contexts: SummonerContextEntry[]): SummonerExport {
  return { championId: CHAMP, myRole: 'SUPPORT', contexts };
}

const GLOBAL_CTX: SummonerContextEntry = {
  rankBucket: 'DIAMOND',
  contextKey: 'global',
  contextLevel: 5,
  pairs: [pair()],
};

const LANE_CTX: SummonerContextEntry = {
  rankBucket: 'DIAMOND',
  contextKey: 'lane:a.ADC:10',
  contextLevel: 3,
  pairs: [pair({ summoner1Id: 4, summoner2Id: 7, pickShare: 0.25, players: 8 })],
};

const ROLE_PROB = asRoleProb({
  '7': { SUPPORT: 1 },
  '10': { ADC: 1 },
  '20': { SUPPORT: 1 },
  '30': { ADC: 1 },
});

function setupData(): SetupSpellsData {
  return makeData({ champions: [7, 10, 20, 30], roleProb: ROLE_PROB });
}

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

describe('recommendSetupSpells — topPlayers mode', () => {
  it('returns expert evidence fields and labeled pick sources', () => {
    const result = recommendSetupSpells(draft(), CHAMP, setupData(), {
      mode: 'topPlayers',
      summonerExport: summonerExport([GLOBAL_CTX]),
      nowMs: NOW_MS,
    });
    expect(result.mode).toBe('topPlayers');
    expect(result.dataSource).toBe('expertAggregate');
    expect(result.dataAvailable).toBe(true);
    expect(result.schemaVersion).toBe(SETUP_SPELLS_RESULT_SCHEMA_VERSION);
    expect(result.evidence).toEqual({
      kind: 'expert',
      playerWeightCap: DEFAULT_CONFIG.evidencePlayerWeightCap,
      minDistinctPlayers: DEFAULT_CONFIG.evidenceMinDistinctPlayers,
      masterPlusOnly: false,
      masterPlusOptional: true,
    });
    const pick = must(result.picks[0]);
    expect(pick.spell1Id).toBe(4);
    expect(pick.spell2Id).toBe(14);
    expect(pick.spell1Id).toBeLessThan(pick.spell2Id);
    expect(pick.winRate).not.toBeNull();
    expect(pick.nEff).toBeGreaterThan(0);
    expect(pick.players).toBe(12);
    expect(pick.pickShare).toBe(0.4);
    expect(pick.source).toBe('global');
    expect(pick.sourceLevel).toBe(5);
    expect(pick.insufficientData).toBe(false);
    expect(result.broaderStatistic).toBeNull();
    expect(() => setupSpellsResultSchema.parse(result)).not.toThrow();
  });

  it('labels lane-context picks separately from the global fallback', () => {
    const result = recommendSetupSpells(draft(), CHAMP, setupData(), {
      mode: 'topPlayers',
      summonerExport: summonerExport([LANE_CTX, GLOBAL_CTX]),
      nowMs: NOW_MS,
    });
    const sources = result.picks.map((p) => p.source);
    expect(sources).toContain('laneContext');
    expect(sources).toContain('global');
  });

  it('Master+ toggle stays off by default and is labeled optional', () => {
    const result = recommendSetupSpells(draft(), CHAMP, setupData(), {
      mode: 'topPlayers',
      summonerExport: summonerExport([GLOBAL_CTX]),
      nowMs: NOW_MS,
    });
    expect(result.evidence.kind).toBe('expert');
    if (result.evidence.kind === 'expert') {
      expect(result.evidence.masterPlusOnly).toBe(false);
      expect(result.evidence.masterPlusOptional).toBe(true);
    }
  });

  it('falls back to the labeled champion role win rate when spell data is absent (D-103)', () => {
    const result = recommendSetupSpells(draft(), CHAMP, setupData(), {
      mode: 'topPlayers',
      nowMs: NOW_MS,
    });
    expect(result.dataAvailable).toBe(false);
    expect(result.picks).toEqual([]);
    expect(result.broaderStatistic?.kind).toBe('championRoleWinRate');
    expect(result.broaderStatistic?.winRate).not.toBeNull();
    expect(() => setupSpellsResultSchema.parse(result)).not.toThrow();
  });

  it('flags picks below the distinct-player gate as insufficient (D-102)', () => {
    const thinCtx: SummonerContextEntry = {
      rankBucket: 'DIAMOND',
      contextKey: 'global',
      contextLevel: 5,
      pairs: [pair({ players: 2 })],
    };
    const result = recommendSetupSpells(draft(), CHAMP, setupData(), {
      mode: 'topPlayers',
      summonerExport: summonerExport([thinCtx]),
      nowMs: NOW_MS,
    });
    expect(result.picks).toHaveLength(1);
    expect(result.picks[0]?.insufficientData).toBe(true);
    expect(result.dataAvailable).toBe(false);
    expect(result.broaderStatistic?.kind).toBe('championRoleWinRate');
    expect(() => setupSpellsResultSchema.parse(result)).not.toThrow();
  });
});

describe('recommendSetupSpells — myData mode', () => {
  it('reads the profile spell pairs with games and profile evidence', () => {
    const games = Array.from({ length: 6 }, () => makeGame());
    const result = recommendSetupSpells(draft(), CHAMP, setupData(), {
      mode: 'myData',
      profile: makeProfile(games),
      nowMs: NOW_MS,
    });
    expect(result.mode).toBe('myData');
    expect(result.dataSource).toBe('profile');
    expect(result.evidence).toEqual({ kind: 'profile', minSetupGames: 5 });
    expect(result.dataAvailable).toBe(true);
    const pick = must(result.picks[0]);
    expect([pick.spell1Id, pick.spell2Id]).toEqual([4, 14]);
    expect(pick.games).toBe(6);
    expect(pick.players).toBeUndefined();
    expect(pick.pickShare).toBeUndefined();
    expect(pick.insufficientData).toBe(false);
    expect(() => setupSpellsResultSchema.parse(result)).not.toThrow();
  });

  it('reports insufficient data without a profile export', () => {
    const result = recommendSetupSpells(draft(), CHAMP, setupData(), {
      mode: 'myData',
      nowMs: NOW_MS,
    });
    expect(result.dataAvailable).toBe(false);
    expect(result.picks).toEqual([]);
    expect(result.broaderStatistic).toBeNull();
    expect(() => setupSpellsResultSchema.parse(result)).not.toThrow();
  });

  it('shows the labeled profile broader statistic when profile pairs are thin', () => {
    const games = Array.from({ length: 2 }, () => makeGame());
    const result = recommendSetupSpells(draft(), CHAMP, setupData(), {
      mode: 'myData',
      profile: makeProfile(games),
      nowMs: NOW_MS,
    });
    expect(result.dataAvailable).toBe(false);
    expect(result.broaderStatistic?.kind).toBe('profileChampionWinRate');
    expect(result.broaderStatistic?.winRate).not.toBeNull();
  });
});
