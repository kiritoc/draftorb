/**
 * recommendSetupRunes: mode-switched rune data path (BL-030a, SPECS §8.1/
 * §18.5, D-102/D-103/D-134) — evidence-rule display fields, Master+ toggle,
 * labeled broader-statistic fallback and per-mode data sources.
 */

import { describe, expect, it } from 'vitest';

import {
  PROFILE_EXPORT_SCHEMA_VERSION,
  SETUP_RESULT_SCHEMA_VERSION,
  setupRuneResultSchema,
  type DraftInput,
  type ProfileExport,
  type ProfileGame,
  type RuneContextEntry,
  type RuneContextPage,
  type RuneExport,
} from '@draftorb/shared';

import { DEFAULT_CONFIG } from '../src/config.js';
import { recommendSetupRunes, type SetupRunesData } from '../src/setup.js';
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

function runePage(over: Partial<RuneContextPage> = {}): RuneContextPage {
  return {
    primaryStyleId: 8000,
    subStyleId: 8100,
    keystoneId: 8112,
    selectedPerkIds: [8010, 8020],
    statShardIds: [5001, 5002, 5003],
    winsW: 30,
    gamesW: 50,
    gamesW2: 0.1,
    winrate: 0.6,
    pickShare: 0.4,
    players: 12,
    ...over,
  };
}

function runeExport(contexts: RuneContextEntry[]): RuneExport {
  return { championId: CHAMP, myRole: 'SUPPORT', contexts };
}

const GLOBAL_CTX: RuneContextEntry = {
  rankBucket: 'DIAMOND',
  contextKey: 'global',
  contextLevel: 5,
  pages: [runePage()],
};

const LANE_CTX: RuneContextEntry = {
  rankBucket: 'DIAMOND',
  contextKey: 'lane:a.ADC:10',
  contextLevel: 3,
  pages: [runePage({ keystoneId: 9923, pickShare: 0.25, players: 8 })],
};

/** Role probabilities matching the draft fixture (10=ADC ally, 20=SUP/30=ADC enemies). */
const ROLE_PROB = asRoleProb({
  '7': { SUPPORT: 1 },
  '10': { ADC: 1 },
  '20': { SUPPORT: 1 },
  '30': { ADC: 1 },
});

function setupData(): SetupRunesData {
  return makeData({ champions: [7, 10, 20, 30], roleProb: ROLE_PROB });
}

const PROFILE_PAGE = {
  keystoneId: 8112,
  primaryStyleId: 7200,
  subStyleId: 7300,
  perkIds: [8112, 9923],
  statShardIds: [5001, 5008, 5008],
};

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
    runes: PROFILE_PAGE,
    items: [],
    itemsOrdered: null,
    summonerSpells: [4, 7],
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
    favorites: {},
    games,
    mastery: [],
  };
}

describe('recommendSetupRunes — topPlayers mode', () => {
  it('returns expert evidence fields and labeled page sources', () => {
    const result = recommendSetupRunes(draft(), CHAMP, setupData(), {
      mode: 'topPlayers',
      runeExport: runeExport([GLOBAL_CTX]),
      nowMs: NOW_MS,
    });
    expect(result.mode).toBe('topPlayers');
    expect(result.dataSource).toBe('expertAggregate');
    expect(result.dataAvailable).toBe(true);
    expect(result.schemaVersion).toBe(SETUP_RESULT_SCHEMA_VERSION);
    expect(result.evidence).toEqual({
      kind: 'expert',
      playerWeightCap: DEFAULT_CONFIG.evidencePlayerWeightCap,
      minDistinctPlayers: DEFAULT_CONFIG.evidenceMinDistinctPlayers,
      masterPlusOnly: false,
      masterPlusOptional: true,
    });
    const page = must(result.pages[0]);
    expect(page.winRate).not.toBeNull();
    expect(page.nEff).toBeGreaterThan(0);
    expect(page.players).toBe(12);
    expect(page.pickShare).toBe(0.4);
    expect(page.source).toBe('global');
    expect(page.sourceLevel).toBe(5);
    expect(page.insufficientData).toBe(false);
    expect(result.broaderStatistic).toBeNull();
    expect(() => setupRuneResultSchema.parse(result)).not.toThrow();
  });

  it('labels lane-context pages separately from the global fallback', () => {
    const result = recommendSetupRunes(draft(), CHAMP, setupData(), {
      mode: 'topPlayers',
      runeExport: runeExport([LANE_CTX, GLOBAL_CTX]),
      nowMs: NOW_MS,
    });
    const sources = result.pages.map((p) => p.source);
    expect(sources).toContain('laneContext');
    expect(sources).toContain('global');
  });

  it('Master+ toggle stays off by default and is labeled optional', () => {
    const result = recommendSetupRunes(draft(), CHAMP, setupData(), {
      mode: 'topPlayers',
      runeExport: runeExport([GLOBAL_CTX]),
      nowMs: NOW_MS,
    });
    expect(result.evidence.kind).toBe('expert');
    if (result.evidence.kind === 'expert') {
      expect(result.evidence.masterPlusOnly).toBe(false);
      expect(result.evidence.masterPlusOptional).toBe(true);
    }
  });

  it('reflects the Master+ config when enabled', () => {
    const result = recommendSetupRunes(draft(), CHAMP, setupData(), {
      mode: 'topPlayers',
      runeExport: runeExport([GLOBAL_CTX]),
      nowMs: NOW_MS,
      config: { ...DEFAULT_CONFIG, evidenceMasterPlusOnly: true },
    });
    expect(result.evidence.kind).toBe('expert');
    if (result.evidence.kind === 'expert') {
      expect(result.evidence.masterPlusOnly).toBe(true);
      expect(result.evidence.masterPlusOptional).toBe(true);
    }
    // The MASTER_PLUS-only bucket has no DIAMOND rows -> broader fallback.
    expect(result.dataAvailable).toBe(false);
    expect(result.broaderStatistic?.kind).toBe('championRoleWinRate');
  });

  it('falls back to the labeled champion role win rate when rune data is absent (D-103)', () => {
    const result = recommendSetupRunes(draft(), CHAMP, setupData(), {
      mode: 'topPlayers',
      nowMs: NOW_MS,
    });
    expect(result.dataAvailable).toBe(false);
    expect(result.pages).toEqual([]);
    const stat = result.broaderStatistic;
    expect(stat?.kind).toBe('championRoleWinRate');
    expect(stat?.winRate).not.toBeNull();
    expect(stat?.nEff).toBeGreaterThan(0);
    expect(stat?.insufficientData).toBe(false);
    expect(stat?.games).toBe(50);
    expect(() => setupRuneResultSchema.parse(result)).not.toThrow();
  });

  it('flags pages below the distinct-player gate as insufficient and shows the D-103 fallback', () => {
    const thinCtx: RuneContextEntry = {
      rankBucket: 'DIAMOND',
      contextKey: 'global',
      contextLevel: 5,
      pages: [runePage({ players: 2 })],
    };
    const result = recommendSetupRunes(draft(), CHAMP, setupData(), {
      mode: 'topPlayers',
      runeExport: runeExport([thinCtx]),
      nowMs: NOW_MS,
    });
    // recommendRunes still returns the page, but it cannot count as
    // sufficient evidence: the broader statistic replaces it (D-103).
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.insufficientData).toBe(true);
    expect(result.dataAvailable).toBe(false);
    expect(result.broaderStatistic?.kind).toBe('championRoleWinRate');
    expect(result.broaderStatistic?.winRate).not.toBeNull();
    expect(() => setupRuneResultSchema.parse(result)).not.toThrow();
  });

  it('flags lowData pages as insufficient and keeps sufficient pages usable', () => {
    // nEff = gamesW^2 / gamesW2 = 100 / 10 = 10 < minGames (25) -> lowData.
    // A distinct keystone keeps it a separate displayed page from GLOBAL_CTX.
    const thinPage = runePage({
      keystoneId: 9923,
      winsW: 5,
      gamesW: 10,
      gamesW2: 10,
      players: 12,
    });
    const thinCtx: RuneContextEntry = {
      rankBucket: 'DIAMOND',
      contextKey: 'lane:a.ADC:10',
      contextLevel: 3,
      pages: [thinPage],
    };
    const allThin = recommendSetupRunes(draft(), CHAMP, setupData(), {
      mode: 'topPlayers',
      runeExport: runeExport([thinCtx]),
      nowMs: NOW_MS,
    });
    expect(allThin.pages[0]?.insufficientData).toBe(true);
    expect(allThin.dataAvailable).toBe(false);
    expect(allThin.broaderStatistic?.kind).toBe('championRoleWinRate');

    // A sufficient page alongside a thin one keeps dataAvailable true.
    const mixed = recommendSetupRunes(draft(), CHAMP, setupData(), {
      mode: 'topPlayers',
      runeExport: runeExport([thinCtx, GLOBAL_CTX]),
      nowMs: NOW_MS,
    });
    expect(mixed.dataAvailable).toBe(true);
    expect(mixed.broaderStatistic).toBeNull();
    const insufficient = mixed.pages.filter((p) => p.insufficientData);
    expect(insufficient.length).toBeGreaterThan(0);
    expect(mixed.pages.some((p) => !p.insufficientData)).toBe(true);
  });

  it('treats a page without a players count as below the evidence gate (fail-closed)', () => {
    const noPlayers = runePage();
    delete (noPlayers as { players?: number }).players;
    const ctx: RuneContextEntry = {
      rankBucket: 'DIAMOND',
      contextKey: 'global',
      contextLevel: 5,
      pages: [noPlayers],
    };
    const result = recommendSetupRunes(draft(), CHAMP, setupData(), {
      mode: 'topPlayers',
      runeExport: runeExport([ctx]),
      nowMs: NOW_MS,
    });
    expect(result.pages[0]?.insufficientData).toBe(true);
    expect(result.dataAvailable).toBe(false);
    expect(result.broaderStatistic?.kind).toBe('championRoleWinRate');
  });

  it('reports an insufficient broader statistic when the baseline is thin', () => {
    const data = makeData({
      champions: [7, 10, 20, 30],
      baselines: [[CHAMP, 'DIAMOND', 1, 2, 4, 2]],
    });
    const result = recommendSetupRunes(draft(), CHAMP, data, {
      mode: 'topPlayers',
      nowMs: NOW_MS,
    });
    const stat = result.broaderStatistic;
    expect(stat?.kind).toBe('championRoleWinRate');
    expect(stat?.insufficientData).toBe(true);
    expect(stat?.nEff).toBeCloseTo(1, 3);
  });
});

describe('recommendSetupRunes — myData mode', () => {
  it('returns profile pages with sample sizes and the profile data source', () => {
    // Games that match no matchup level (unknown lane ids, untagged enemies)
    // fall back to the champion level -> 'profileChampion' source.
    const games = Array.from({ length: 6 }, () =>
      makeGame({ allyAdcId: 99, enemySupportId: 98, enemyChampionIds: [50, 51, 52] }),
    );
    const result = recommendSetupRunes(draft(), CHAMP, setupData(), {
      mode: 'myData',
      profile: makeProfile(games),
      nowMs: NOW_MS,
    });
    expect(result.mode).toBe('myData');
    expect(result.dataSource).toBe('profile');
    expect(result.evidence).toEqual({ kind: 'profile', minSetupGames: 5 });
    const page = must(result.pages[0]);
    expect(page.winRate).not.toBeNull();
    expect(page.nEff).toBeCloseTo(6, 3);
    expect(page.games).toBe(6);
    expect(page.insufficientData).toBe(false);
    expect(page.source).toBe('profileChampion');
    expect(result.dataAvailable).toBe(true);
    expect(result.broaderStatistic).toBeNull();
    expect(() => setupRuneResultSchema.parse(result)).not.toThrow();
  });

  it('labels matchup-level profile pages as profileMatchup', () => {
    const games = Array.from({ length: 5 }, () => makeGame());
    // allyAdcId 10 + enemySupportId 20 match the draft -> L1 context.
    const result = recommendSetupRunes(draft(), CHAMP, setupData(), {
      mode: 'myData',
      profile: makeProfile(games),
      nowMs: NOW_MS,
    });
    expect(must(result.pages[0]).source).toBe('profileMatchup');
    expect(must(result.pages[0]).sourceLevel).toBe(1);
  });

  it('falls back to the labeled profile champion win rate when pages are thin (D-103)', () => {
    const games = Array.from({ length: 3 }, () => makeGame());
    const result = recommendSetupRunes(draft(), CHAMP, setupData(), {
      mode: 'myData',
      profile: makeProfile(games),
      nowMs: NOW_MS,
    });
    expect(result.dataAvailable).toBe(false);
    const page = must(result.pages[0]);
    expect(page.insufficientData).toBe(true);
    expect(page.winRate).toBeNull();
    expect(page.nEff).toBeCloseTo(3, 3);
    const stat = result.broaderStatistic;
    expect(stat?.kind).toBe('profileChampionWinRate');
    expect(stat?.winRate).toBeCloseTo(1, 3);
    expect(stat?.games).toBe(3);
    expect(stat?.insufficientData).toBe(true);
    expect(() => setupRuneResultSchema.parse(result)).not.toThrow();
  });

  it('returns an empty insufficient state without a profile export', () => {
    const result = recommendSetupRunes(draft(), CHAMP, setupData(), {
      mode: 'myData',
      nowMs: NOW_MS,
    });
    expect(result.dataAvailable).toBe(false);
    expect(result.pages).toEqual([]);
    expect(result.broaderStatistic).toBeNull();
    expect(result.evidence).toEqual({ kind: 'profile', minSetupGames: 5 });
  });

  it('ignores profile games recorded in another role', () => {
    const games = [
      ...Array.from({ length: 6 }, () => makeGame()),
      ...Array.from({ length: 6 }, () => makeGame({ role: 'TOP' })),
    ];
    const result = recommendSetupRunes(draft(), CHAMP, setupData(), {
      mode: 'myData',
      profile: makeProfile(games),
      nowMs: NOW_MS,
    });
    // Only the 6 SUPPORT games count; the TOP games are out of scope.
    expect(must(result.pages[0]).games).toBe(6);
    expect(result.broaderStatistic).toBeNull();
  });
});

describe('recommendSetupRunes — mode switch', () => {
  it('re-queries both modes from the same inputs without shared state', () => {
    const games = Array.from({ length: 6 }, () => makeGame());
    const profile = makeProfile(games);
    const data = setupData();
    const input = draft();
    const runeExportData = runeExport([GLOBAL_CTX]);

    const top = recommendSetupRunes(input, CHAMP, data, {
      mode: 'topPlayers',
      runeExport: runeExportData,
      nowMs: NOW_MS,
    });
    const mine = recommendSetupRunes(input, CHAMP, data, {
      mode: 'myData',
      profile,
      nowMs: NOW_MS,
    });
    // Switching back reproduces the first result exactly (pure re-query).
    const topAgain = recommendSetupRunes(input, CHAMP, data, {
      mode: 'topPlayers',
      runeExport: runeExportData,
      nowMs: NOW_MS,
    });

    expect(top.dataSource).toBe('expertAggregate');
    expect(mine.dataSource).toBe('profile');
    expect(top.mode).not.toBe(mine.mode);
    expect(JSON.stringify(top)).toBe(JSON.stringify(topAgain));
    expect(top.broaderStatistic).toBeNull();
    expect(mine.broaderStatistic).toBeNull();
  });
});
