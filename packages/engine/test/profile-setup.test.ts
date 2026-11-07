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
import { makeData } from '../src/recommend-test-utils.js';

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
    favorites: { combined: [], recency: [], mastery: [] },
    games,
    mastery: [],
  };
}

const EMPTY_CONTEXT: PersonalizeContext = {
  allyAdcId: null,
  enemySupportId: null,
  enemySignature: new Set(),
};

const L1_CONTEXT: PersonalizeContext = {
  allyAdcId: 10,
  enemySupportId: 200,
  enemySignature: new Set(),
};

const data: RecommendData = makeData({ champions: [1, 2, 10, 200, 201, 30, 31, 32] });

describe('recommendProfileRunes', () => {
  it('ranks rune pages by shrunk profile WR', () => {
    const games = [
      // Page A: 6 wins; page B: 6 losses -> A ranks first.
      ...Array.from({ length: 6 }, () => makeGame()),
      ...Array.from({ length: 6 }, () => makeGame({ win: false, runes: OTHER_PAGE })),
    ];
    const picks = recommendProfileRunes(makeProfile(games), 1, EMPTY_CONTEXT, data, NOW_MS);
    expect(picks).toHaveLength(2);
    expect(picks[0]!.keystoneId).toBe(8112);
    expect(picks[0]!.insufficientData).toBe(false);
    expect(picks[0]!.winRate).toBeGreaterThan(0.5);
    expect(picks[1]!.keystoneId).toBe(9923);
    expect(picks[1]!.winRate).toBeLessThan(0.5);
    expect(picks[0]!.nEff).toBeCloseTo(6, 3);
    expect(picks[0]!.fallbackLevel).toBe(4);
  });

  it('uses the matched fallback level when context aligns', () => {
    const games = Array.from({ length: 5 }, () => makeGame());
    const picks = recommendProfileRunes(makeProfile(games), 1, L1_CONTEXT, data, NOW_MS);
    expect(picks[0]!.fallbackLevel).toBe(1);
  });

  it('shows insufficient data below 5 effective games', () => {
    const games = Array.from({ length: 3 }, () => makeGame());
    const picks = recommendProfileRunes(makeProfile(games), 1, EMPTY_CONTEXT, data, NOW_MS);
    expect(picks[0]!.insufficientData).toBe(true);
    expect(picks[0]!.winRate).toBeNull();
    expect(picks[0]!.nEff).toBeCloseTo(3, 3);
  });

  it('ignores games on other champions and games without rune data', () => {
    const games = [
      ...Array.from({ length: 5 }, () => makeGame()),
      ...Array.from({ length: 5 }, () => makeGame({ championId: 2 })),
      makeGame({ runes: null }),
    ];
    const picks = recommendProfileRunes(makeProfile(games), 1, EMPTY_CONTEXT, data, NOW_MS);
    expect(picks).toHaveLength(1);
    expect(picks[0]!.games).toBe(5);
  });
});

describe('recommendProfileSpells', () => {
  it('normalizes spell order into one pair', () => {
    const games = [
      ...Array.from({ length: 4 }, () => makeGame({ summonerSpells: [4, 7] })),
      ...Array.from({ length: 4 }, () => makeGame({ summonerSpells: [7, 4] })),
      ...Array.from({ length: 6 }, () => makeGame({ summonerSpells: [4, 13], win: false })),
    ];
    const picks = recommendProfileSpells(makeProfile(games), 1, EMPTY_CONTEXT, data, NOW_MS);
    expect(picks).toHaveLength(2);
    // [4,7] normalized pair: 8 games, all wins -> ranks first.
    expect(picks[0]!.spells).toEqual([4, 7]);
    expect(picks[0]!.games).toBe(8);
    expect(picks[0]!.insufficientData).toBe(false);
    // [4,13]: 6 losses.
    expect(picks[1]!.spells).toEqual([4, 13]);
    expect(picks[1]!.games).toBe(6);
  });

  it('reports insufficient data below 5 effective games', () => {
    const games = Array.from({ length: 2 }, () => makeGame());
    const picks = recommendProfileSpells(makeProfile(games), 1, EMPTY_CONTEXT, data, NOW_MS);
    expect(picks[0]!.insufficientData).toBe(true);
    expect(picks[0]!.winRate).toBeNull();
  });

  it('is deterministic', () => {
    const games = Array.from({ length: 6 }, (_, i) =>
      makeGame({ summonerSpells: i % 2 === 0 ? [4, 7] : [13, 14] }),
    );
    const profile = makeProfile(games);
    const a = recommendProfileSpells(profile, 1, EMPTY_CONTEXT, data, NOW_MS);
    const b = recommendProfileSpells(profile, 1, EMPTY_CONTEXT, data, NOW_MS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
