/**
 * recommendProfileRunes / recommendProfileSpells: shrinkage, fallback
 * levels, spell-pair normalization, insufficient-data (T-097, D-073/D-075).
 */

import { describe, expect, it } from 'vitest';

import {
  PROFILE_EXPORT_SCHEMA_VERSION,
  type ProfileExport,
  type ProfileGame,
  type RecommendData,
} from '@draftorb/shared';

import { recommendProfileRunes, recommendProfileSpells } from '../src/profile-setup.js';
import type { PersonalizeContext } from '../src/personalize.js';
import { asRoleProb, makeData, must } from '../src/recommend-test-utils.js';

const NOW_MS = 20_370 * 86_400_000;

const RUNE_PAGE = {
  keystoneId: 8112,
  primaryStyleId: 7200,
  subStyleId: 7300,
  perkIds: [8112, 9923],
  statShardIds: [5001, 5008, 5008],
};

const OTHER_PAGE = {
  keystoneId: 9923,
  primaryStyleId: 7200,
  subStyleId: 7300,
  perkIds: [9923],
  statShardIds: [5001, 5008, 5008],
};

function makeGame(over: Partial<ProfileGame> = {}): ProfileGame {
  return {
    createdAtDay: 20_370,
    championId: 1,
    role: 'SUPPORT',
    win: true,
    allyAdcId: 10,
    enemySupportId: 200,
    enemyAdcId: 201,
    enemyChampionIds: [200, 201, 30, 31, 32],
    runes: RUNE_PAGE,
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

const EMPTY_CONTEXT: PersonalizeContext = {
  role: 'SUPPORT',
  allyAdcId: null,
  enemySupportId: null,
  enemySignature: new Set(),
  rankBucket: 'DIAMOND',
};

const L1_CONTEXT: PersonalizeContext = {
  role: 'SUPPORT',
  allyAdcId: 10,
  enemySupportId: 200,
  enemySignature: new Set(),
  rankBucket: 'DIAMOND',
};

const data: RecommendData = makeData({ champions: [1, 2, 10, 200, 201, 30, 31, 32] });

describe('recommendProfileRunes', () => {
  it('ranks rune pages by shrunk profile WR', () => {
    const games = [
      // Page A: 6 wins; page B: 6 losses -> A ranks first.
      ...Array.from({ length: 6 }, () => makeGame()),
      ...Array.from({ length: 6 }, () => makeGame({ win: false, runes: OTHER_PAGE })),
    ];
    const picks = recommendProfileRunes(
      makeProfile(games),
      1,
      'SUPPORT',
      EMPTY_CONTEXT,
      data,
      NOW_MS,
    );
    expect(picks).toHaveLength(2);
    expect(must(picks[0]).keystoneId).toBe(8112);
    expect(must(picks[0]).insufficientData).toBe(false);
    expect(must(picks[0]).winRate).toBeGreaterThan(0.5);
    expect(must(picks[1]).keystoneId).toBe(9923);
    expect(must(picks[1]).winRate).toBeLessThan(0.5);
    expect(must(picks[0]).nEff).toBeCloseTo(6, 3);
    expect(must(picks[0]).fallbackLevel).toBe(4);
  });

  it('uses the matched fallback level when context aligns', () => {
    const games = Array.from({ length: 5 }, () => makeGame());
    const picks = recommendProfileRunes(makeProfile(games), 1, 'SUPPORT', L1_CONTEXT, data, NOW_MS);
    expect(must(picks[0]).fallbackLevel).toBe(1);
  });

  it('shows insufficient data below 5 effective games', () => {
    const games = Array.from({ length: 3 }, () => makeGame());
    const picks = recommendProfileRunes(
      makeProfile(games),
      1,
      'SUPPORT',
      EMPTY_CONTEXT,
      data,
      NOW_MS,
    );
    expect(must(picks[0]).insufficientData).toBe(true);
    expect(must(picks[0]).winRate).toBeNull();
    expect(must(picks[0]).nEff).toBeCloseTo(3, 3);
  });

  it('ignores games on other champions and games without rune data', () => {
    const games = [
      ...Array.from({ length: 5 }, () => makeGame()),
      ...Array.from({ length: 5 }, () => makeGame({ championId: 2 })),
      makeGame({ runes: null }),
    ];
    const picks = recommendProfileRunes(
      makeProfile(games),
      1,
      'SUPPORT',
      EMPTY_CONTEXT,
      data,
      NOW_MS,
    );
    expect(picks).toHaveLength(1);
    expect(must(picks[0]).games).toBe(5);
  });
});

describe('recommendProfileSpells', () => {
  it('normalizes spell order into one pair', () => {
    const games = [
      ...Array.from({ length: 4 }, () => makeGame({ summonerSpells: [4, 7] })),
      ...Array.from({ length: 4 }, () => makeGame({ summonerSpells: [7, 4] })),
      ...Array.from({ length: 6 }, () => makeGame({ summonerSpells: [4, 13], win: false })),
    ];
    const picks = recommendProfileSpells(
      makeProfile(games),
      1,
      'SUPPORT',
      EMPTY_CONTEXT,
      data,
      NOW_MS,
    );
    expect(picks).toHaveLength(2);
    // [4,7] normalized pair: 8 games, all wins -> ranks first.
    expect(must(picks[0]).spells).toEqual([4, 7]);
    expect(must(picks[0]).games).toBe(8);
    expect(must(picks[0]).insufficientData).toBe(false);
    // [4,13]: 6 losses.
    expect(must(picks[1]).spells).toEqual([4, 13]);
    expect(must(picks[1]).games).toBe(6);
  });

  it('reports insufficient data below 5 effective games', () => {
    const games = Array.from({ length: 2 }, () => makeGame());
    const picks = recommendProfileSpells(
      makeProfile(games),
      1,
      'SUPPORT',
      EMPTY_CONTEXT,
      data,
      NOW_MS,
    );
    expect(must(picks[0]).insufficientData).toBe(true);
    expect(must(picks[0]).winRate).toBeNull();
  });

  it('is deterministic', () => {
    const games = Array.from({ length: 6 }, (_, i) =>
      makeGame({ summonerSpells: i % 2 === 0 ? [4, 7] : [13, 14] }),
    );
    const profile = makeProfile(games);
    const a = recommendProfileSpells(profile, 1, 'SUPPORT', EMPTY_CONTEXT, data, NOW_MS);
    const b = recommendProfileSpells(profile, 1, 'SUPPORT', EMPTY_CONTEXT, data, NOW_MS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('role scope (D-097, BL-032)', () => {
  const contextFor = (role: PersonalizeContext['role']): PersonalizeContext => ({
    ...EMPTY_CONTEXT,
    role,
  });

  it('recommends runes from TOP games for a TOP draft', () => {
    const games = Array.from({ length: 6 }, () => makeGame({ role: 'TOP' }));
    const picks = recommendProfileRunes(
      makeProfile(games),
      1,
      'TOP',
      contextFor('TOP'),
      data,
      NOW_MS,
    );
    expect(picks).toHaveLength(1);
    expect(must(picks[0]).insufficientData).toBe(false);
    expect(must(picks[0]).fallbackLevel).toBe(4);
  });

  it('recommends spells from JUNGLE games for a JUNGLE draft', () => {
    const games = Array.from({ length: 6 }, () => makeGame({ role: 'JUNGLE' }));
    const picks = recommendProfileSpells(
      makeProfile(games),
      1,
      'JUNGLE',
      contextFor('JUNGLE'),
      data,
      NOW_MS,
    );
    expect(picks).toHaveLength(1);
    expect(must(picks[0]).insufficientData).toBe(false);
    expect(must(picks[0]).spells).toEqual([4, 7]);
  });

  it('ignores games played in other roles', () => {
    // Six SUPPORT games must not feed a TOP draft's "Profile's best".
    const games = Array.from({ length: 6 }, () => makeGame({ role: 'SUPPORT' }));
    const runePicks = recommendProfileRunes(
      makeProfile(games),
      1,
      'TOP',
      contextFor('TOP'),
      data,
      NOW_MS,
    );
    expect(runePicks).toHaveLength(0);
    const spellPicks = recommendProfileSpells(
      makeProfile(games),
      1,
      'JUNGLE',
      contextFor('JUNGLE'),
      data,
      NOW_MS,
    );
    expect(spellPicks).toHaveLength(0);
  });

  it('reports insufficient data for ADC/MID drafts', () => {
    for (const role of ['ADC', 'MID'] as const) {
      const games = Array.from({ length: 6 }, () => makeGame({ role }));
      const picks = recommendProfileRunes(
        makeProfile(games),
        1,
        role,
        contextFor(role),
        data,
        NOW_MS,
      );
      expect(picks).toHaveLength(0);
    }
  });
});

/**
 * Per-role matchup contexts (BL-056, D-135): TOP matches enemy TOP
 * (+ enemy JUNGLE at L1), JUNGLE matches enemy JUNGLE (+ enemy MID at L1).
 * Enemy roles are not stored in the export — the engine infers them from
 * `enemyChampionIds` via `roleProb`, so the fixture gives each enemy
 * champion a single fixed role probability.
 */
describe('per-role matchup contexts (BL-056)', () => {
  // Enemy team: 200 SUPPORT, 201 ADC, 31 TOP, 32 JUNGLE, 33 MID.
  const LANE_CHAMPS = [1, 2, 10, 31, 32, 33, 200, 201];
  const ENEMY_TEAM = [200, 201, 31, 32, 33];
  const laneData = makeData({
    champions: LANE_CHAMPS,
    roleProb: asRoleProb({
      '1': { TOP: 1 },
      '2': { JUNGLE: 1 },
      '10': { ADC: 1 },
      '31': { TOP: 1 },
      '32': { JUNGLE: 1 },
      '33': { MID: 1 },
      '200': { SUPPORT: 1 },
      '201': { ADC: 1 },
    }),
  });

  const laneGame = (over: Partial<ProfileGame> = {}): ProfileGame =>
    makeGame({
      enemyChampionIds: [...ENEMY_TEAM],
      ...over,
    });

  const contextWithEnemies = (
    role: PersonalizeContext['role'],
    enemyRoleIds: Partial<Record<string, number>>,
  ): PersonalizeContext => ({
    ...EMPTY_CONTEXT,
    role,
    enemyRoleIds: enemyRoleIds as PersonalizeContext['enemyRoleIds'],
  });

  it('TOP draft: same enemy TOP + enemy JUNGLE resolves at L1', () => {
    const games = Array.from({ length: 5 }, () => laneGame({ role: 'TOP' }));
    const context = contextWithEnemies('TOP', {
      SUPPORT: 200,
      ADC: 201,
      TOP: 31,
      JUNGLE: 32,
      MID: 33,
    });
    const picks = recommendProfileRunes(makeProfile(games), 1, 'TOP', context, laneData, NOW_MS);
    expect(must(picks[0]).fallbackLevel).toBe(1);
    expect(must(picks[0]).insufficientData).toBe(false);
  });

  it('TOP draft: same enemy TOP alone resolves at L2 when JUNGLE differs', () => {
    const games = Array.from({ length: 5 }, () => laneGame({ role: 'TOP' }));
    // Draft shows a different enemy jungler -> L1 cannot match, L2 can.
    const context = contextWithEnemies('TOP', { TOP: 31, JUNGLE: 99 });
    const picks = recommendProfileRunes(makeProfile(games), 1, 'TOP', context, laneData, NOW_MS);
    expect(must(picks[0]).fallbackLevel).toBe(2);
  });

  it('TOP draft: enemy signature resolves at L3 when lane ids are unknown', () => {
    const games = Array.from({ length: 5 }, () => laneGame({ role: 'TOP' }));
    const context: PersonalizeContext = {
      ...EMPTY_CONTEXT,
      role: 'TOP',
      // Every test tag is MIXED:tank, so the game signature is a subset match.
      enemySignature: new Set(['MIXED:tank']),
    };
    const picks = recommendProfileRunes(makeProfile(games), 1, 'TOP', context, laneData, NOW_MS);
    expect(must(picks[0]).fallbackLevel).toBe(3);
  });

  it('JUNGLE draft: same enemy JUNGLE + enemy MID resolves at L1', () => {
    const games = Array.from({ length: 5 }, () => laneGame({ role: 'JUNGLE' }));
    const context = contextWithEnemies('JUNGLE', { JUNGLE: 32, MID: 33 });
    const picks = recommendProfileRunes(makeProfile(games), 1, 'JUNGLE', context, laneData, NOW_MS);
    expect(must(picks[0]).fallbackLevel).toBe(1);
  });

  it('JUNGLE draft: same enemy JUNGLE alone resolves at L2', () => {
    const games = Array.from({ length: 5 }, () => laneGame({ role: 'JUNGLE' }));
    const context = contextWithEnemies('JUNGLE', { JUNGLE: 32 });
    const picks = recommendProfileSpells(
      makeProfile(games),
      1,
      'JUNGLE',
      context,
      laneData,
      NOW_MS,
    );
    expect(must(picks[0]).fallbackLevel).toBe(2);
  });

  it('TOP draft: unresolvable enemy roles degrade to champion level, never a guess', () => {
    // Default makeRoleProb marks every champion SUPPORT-only, so inferRoles
    // cannot assign TOP/JUNGLE/MID -> matchup slots stay unknown.
    const weakData = makeData({ champions: LANE_CHAMPS });
    const games = Array.from({ length: 5 }, () => laneGame({ role: 'TOP' }));
    const context = contextWithEnemies('TOP', { TOP: 31, JUNGLE: 32 });
    const picks = recommendProfileRunes(makeProfile(games), 1, 'TOP', context, weakData, NOW_MS);
    expect(must(picks[0]).fallbackLevel).toBe(4);
  });
});
