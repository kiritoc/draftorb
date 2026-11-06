/**
 * personalize(): recency weighting, shrinkage, fallback levels, trust blend,
 * insufficient-data behavior, determinism (T-095, D-073/D-075, SPECS §18.2).
 */

import { describe, expect, it } from 'vitest';

import {
  PROFILE_EXPORT_SCHEMA_VERSION,
  type ProfileExport,
  type ProfileGame,
  type Recommendation,
  type RecommendData,
} from '@draftorb/shared';

import {
  personalize,
  personalizeContext,
  type PersonalizeContext,
} from '../src/personalize.js';
import { makeChampionTags, makeData, makeInput, makeTag } from '../src/recommend-test-utils.js';

const DAY_MS = 86_400_000;
// Day-aligned clock: games created "today" get weight exactly 1.
const NOW_MS = 20_370 * DAY_MS; // day-aligned: "today" games weigh exactly 1
const NOW_DAYS = NOW_MS / DAY_MS;

function makeGame(over: Partial<ProfileGame> = {}): ProfileGame {
  return {
    createdAtDay: Math.round(NOW_DAYS),
    championId: 1,
    role: 'SUPPORT',
    win: true,
    allyAdcId: 10,
    enemySupportId: 200,
    enemyAdcId: 201,
    enemyChampionIds: [200, 201, 30, 31, 32],
    runes: null,
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

function rec(championId: number, rank: number, score: number): Recommendation {
  return {
    championId,
    rank,
    score,
    reasons: [],
    reliability: { nEff: 0, lowData: false },
    warnings: [],
  } as Recommendation;
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

const data: RecommendData = makeData({ champions: [1, 2, 3, 10, 200, 201, 30, 31, 32] });

describe('personalize: fallback levels and shrinkage', () => {
  it('matches L1 when ally ADC and enemy support align', () => {
    const games = [1, 2, 3].map(() => makeGame());
    const result = personalize([rec(1, 1, 0.55)], makeProfile(games), L1_CONTEXT, data, NOW_MS);
    const entry = result.entries[0]!;
    expect(entry.fallbackLevel).toBe(1);
    expect(entry.insufficientData).toBe(false);
    expect(entry.nEff).toBeCloseTo(3, 5);
    // All wins, p shrunk toward p_profile=1.0 -> p = (3 + 15*1)/(3+15) = 1.
    expect(entry.profileWinRate).toBeCloseTo(1, 5);
    expect(entry.deltaVsMetaPp).toBe(Math.round(100 * (1 - 0.55)));
  });

  it('falls back to L2 when only the enemy support matches', () => {
    const games = [1, 2, 3].map(() =>
      makeGame({ allyAdcId: 99 }), // different ally ADC -> L1 impossible
    );
    const result = personalize([rec(1, 1, 0.55)], makeProfile(games), L1_CONTEXT, data, NOW_MS);
    expect(result.entries[0]!.fallbackLevel).toBe(2);
  });

  it('falls back to L4 (champion overall) when no context matches', () => {
    const games = [1, 2, 3].map(() =>
      makeGame({ allyAdcId: 99, enemySupportId: 88 }),
    );
    const result = personalize([rec(1, 1, 0.55)], makeProfile(games), L1_CONTEXT, data, NOW_MS);
    expect(result.entries[0]!.fallbackLevel).toBe(4);
  });

  it('L3 matches on the enemy damage/archetype signature', () => {
    // Game enemies all carry AD:marksman tags.
    const tags = makeChampionTags([200, 201, 30, 31, 32]);
    for (const id of [200, 201, 30, 31, 32]) {
      tags[String(id)] = makeTag(id, { damageType: 'AD', archetype: 'marksman' });
    }
    const tagData = makeData({ champions: [1, 2, 3], tags });
    const games = [1, 2, 3].map(() =>
      makeGame({ allyAdcId: 99, enemySupportId: 88 }),
    );
    const context: PersonalizeContext = {
      allyAdcId: null,
      enemySupportId: null,
      enemySignature: new Set(['AD:marksman']),
    };
    const result = personalize([rec(1, 1, 0.55)], makeProfile(games), context, tagData, NOW_MS);
    expect(result.entries[0]!.fallbackLevel).toBe(3);
  });

  it('shrinks the profile WR toward the profile global rate', () => {
    // 3 games on champ 1: 1 win 2 losses. pProfile over all in-scope games
    // includes champ-2 games too, so craft a mixed profile.
    const games = [
      ...[1, 2, 3].map(() => makeGame({ championId: 1, win: false })),
      ...[4, 5, 6].map(() => makeGame({ championId: 2, win: true })),
    ];
    // pProfile = 3/6 = 0.5 (all recent, equal weights).
    // champ1: wins_w=0, games_w=3 -> p = (0 + 15*0.5)/(3+15) = 7.5/18 ≈ 0.4167.
    const result = personalize(
      [rec(1, 1, 0.5), rec(2, 2, 0.5)],
      makeProfile(games),
      EMPTY_CONTEXT,
      data,
      NOW_MS,
    );
    const champ1 = result.entries.find((e) => e.championId === 1)!;
    expect(champ1.profileWinRate).toBeCloseTo(7.5 / 18, 5);
    const champ2 = result.entries.find((e) => e.championId === 2)!;
    expect(champ2.profileWinRate).toBeCloseTo((3 + 7.5) / 18, 5);
  });

  it('weights recent games more than old ones (recency half-life)', () => {
    // Three games today (w=1) plus one ~120 days ago (w=0.25):
    // n_eff = 3.25^2 / (3 + 0.0625) ≈ 3.45 — above minGames but visibly
    // below the 4 a flat weighting would give.
    const games = [
      makeGame({ createdAtDay: Math.round(NOW_DAYS) }),
      makeGame({ createdAtDay: Math.round(NOW_DAYS) }),
      makeGame({ createdAtDay: Math.round(NOW_DAYS) }),
      makeGame({ createdAtDay: Math.round(NOW_DAYS) - 120, win: false }),
    ];
    const result = personalize([rec(1, 1, 0.5)], makeProfile(games), EMPTY_CONTEXT, data, NOW_MS);
    const entry = result.entries[0]!;
    expect(entry.nEff).toBeCloseTo((3.25 * 3.25) / 3.0625, 3);
    expect(entry.nEff).toBeLessThan(3.6);
    expect(entry.fallbackLevel).toBe(4);
  });

  it('reports insufficient data with n_eff and no percentage', () => {
    const games = [makeGame({ championId: 1 })]; // single game -> n_eff 1 < 3
    const result = personalize(
      [rec(1, 1, 0.55), rec(2, 2, 0.5)],
      makeProfile(games),
      EMPTY_CONTEXT,
      data,
      NOW_MS,
    );
    const champ1 = result.entries.find((e) => e.championId === 1)!;
    expect(champ1.insufficientData).toBe(true);
    expect(champ1.profileWinRate).toBeNull();
    expect(champ1.deltaVsMetaPp).toBeNull();
    expect(champ1.nEff).toBeCloseTo(1, 5);
    expect(champ1.personalizedScore).toBe(1); // metaNorm for rank 1 of 2
    // Champ 2 has zero games -> also insufficient, n_eff 0.
    const champ2 = result.entries.find((e) => e.championId === 2)!;
    expect(champ2.insufficientData).toBe(true);
    expect(champ2.nEff).toBe(0);
    expect(champ2.personalizedScore).toBe(0); // metaNorm for rank 2 of 2
  });
});

describe('personalize: ordering, trust and purity', () => {
  it('sorts by personalizedScore desc and breaks ties by overall rank', () => {
    // Champ 1: 3 wins -> high p; champ 2: 3 losses -> low p.
    const games = [
      ...[1, 2, 3].map(() => makeGame({ championId: 1, win: true })),
      ...[4, 5, 6].map(() => makeGame({ championId: 2, win: false })),
    ];
    const result = personalize(
      [rec(1, 1, 0.5), rec(2, 2, 0.5)],
      makeProfile(games),
      EMPTY_CONTEXT,
      data,
      NOW_MS,
    );
    expect(result.entries.map((e) => e.championId)).toEqual([1, 2]);
    expect(result.entries[0]!.rank).toBe(1);
    expect(result.entries[0]!.personalizedScore).toBeGreaterThan(
      result.entries[1]!.personalizedScore,
    );
  });

  it('trust grows with n_eff: more games pull the score toward p', () => {
    // Identical win rate, different sample sizes: p is the same, so the
    // only difference is trust — the larger sample lands closer to p.
    const wins = (n: number) =>
      Array.from({ length: n }, (_, i) => makeGame({ championId: 1, win: i % 2 === 0 }));
    const profileFew = makeProfile(wins(6));
    const profileMany = makeProfile(wins(60));
    const recs = [rec(1, 1, 0.5)];
    const fewResult = personalize(recs, profileFew, EMPTY_CONTEXT, data, NOW_MS).entries[0]!;
    const manyResult = personalize(recs, profileMany, EMPTY_CONTEXT, data, NOW_MS).entries[0]!;
    // metaNorm = 1 for a single-entry list; p ≈ 0.5 < 1, so a larger trust
    // pulls personalizedScore further below metaNorm.
    expect(manyResult.nEff).toBeGreaterThan(fewResult.nEff);
    expect(manyResult.profileWinRate).toBeCloseTo(fewResult.profileWinRate!, 5);
    expect(manyResult.personalizedScore).toBeLessThan(fewResult.personalizedScore);
    expect(manyResult.fallbackLevel).toBe(fewResult.fallbackLevel);
  });

  it('is deterministic and does not mutate the input', () => {
    const games = [1, 2, 3].map(() => makeGame());
    const profile = makeProfile(games);
    const recs = [rec(1, 1, 0.55), rec(2, 2, 0.5)];
    const snapshot = JSON.stringify(recs);
    const first = personalize(recs, profile, L1_CONTEXT, data, NOW_MS);
    const second = personalize(recs, profile, L1_CONTEXT, data, NOW_MS);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(recs)).toBe(snapshot);
  });

  it('metaNorm uses rank position: top of a 3-entry list gets 1, bottom 0', () => {
    // All insufficient -> personalizedScore === metaNorm.
    const result = personalize(
      [rec(1, 1, 0.5), rec(2, 2, 0.5), rec(3, 3, 0.5)],
      makeProfile([]),
      EMPTY_CONTEXT,
      data,
      NOW_MS,
    );
    const byChamp = new Map(result.entries.map((e) => [e.championId, e]));
    expect(byChamp.get(1)!.personalizedScore).toBe(1);
    expect(byChamp.get(2)!.personalizedScore).toBeCloseTo(0.5, 5);
    expect(byChamp.get(3)!.personalizedScore).toBe(0);
  });
});

describe('personalizeContext', () => {
  it('resolves ally ADC and enemy support and builds the enemy signature', () => {
    const tags = makeChampionTags([10, 200, 30, 31, 32]);
    tags['10'] = makeTag(10, { damageType: 'AD', archetype: 'marksman' });
    tags['200'] = makeTag(200, { damageType: 'AP', archetype: 'mage' });
    const tagData = makeData({
      champions: [1, 10, 200, 30, 31, 32],
      tags,
      roleProb: {
        '10': { ADC: 1 },
        '200': { SUPPORT: 1 },
        '30': { TOP: 1 },
        '31': { JUNGLE: 1 },
        '32': { MID: 1 },
      } as RecommendData['roleProb'],
    });
    const input = makeInput({
      allies: [{ championId: 10 }],
      enemies: [
        { championId: 200 },
        { championId: 30 },
        { championId: 31 },
        { championId: 32 },
      ],
    });
    const context = personalizeContext(input, tagData);
    expect(context.allyAdcId).toBe(10);
    expect(context.enemySupportId).toBe(200);
    expect([...context.enemySignature].sort()).toEqual(['AP:mage', 'MIXED:tank']);
  });
});
