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
  DEFAULT_PERSONALIZE_CONFIG,
  personalize,
  personalizeContext,
  type PersonalizeContext,
} from '../src/personalize.js';
import {
  makeChampionTags,
  makeData,
  makeInput,
  makeTag,
  must,
} from '../src/recommend-test-utils.js';

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
    favorites: {},
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

const data: RecommendData = makeData({ champions: [1, 2, 3, 10, 200, 201, 30, 31, 32] });

/** Legacy D-073 blend, still selectable via `blendMode` (D-089). */
const RANKNORM_CONFIG = { ...DEFAULT_PERSONALIZE_CONFIG, blendMode: 'rankNorm' as const };

describe('personalize: fallback levels and shrinkage', () => {
  it('matches L1 when ally ADC and enemy support align', () => {
    const games = [1, 2, 3].map(() => makeGame());
    const result = personalize([rec(1, 1, 0.55)], makeProfile(games), L1_CONTEXT, data, NOW_MS);
    const entry = must(result.entries[0]);
    expect(entry.fallbackLevel).toBe(1);
    expect(entry.insufficientData).toBe(false);
    expect(entry.nEff).toBeCloseTo(3, 5);
    // All wins, p shrunk toward p_profile=1.0 -> p = (3 + 15*1)/(3+15) = 1.
    expect(entry.profileWinRate).toBeCloseTo(1, 5);
    // D-080 golden: makeBaselines row [1,'DIAMOND',30,50,0.1,50] gives
    // nE = 50^2/0.1 = 25000, winsE = 30*25000/50 = 15000, gamesE = 25000,
    // w0 = (15000 + 20*0.5)/(25000+20) = 15010/25020 ≈ 0.5997.
    const w0 = 15010 / 25020;
    expect(entry.baselineWinRate).toBeCloseTo(w0, 6);
    expect(entry.baselineBucket).toBe('DIAMOND');
    expect(entry.deltaVsBaselinePp).toBe(Math.round(100 * (1 - w0)));
  });

  it('falls back to L2 when only the enemy support matches', () => {
    const games = [1, 2, 3].map(
      () => makeGame({ allyAdcId: 99 }), // different ally ADC -> L1 impossible
    );
    const result = personalize([rec(1, 1, 0.55)], makeProfile(games), L1_CONTEXT, data, NOW_MS);
    expect(must(result.entries[0]).fallbackLevel).toBe(2);
  });

  it('falls back to L4 (champion overall) when no context matches', () => {
    const games = [1, 2, 3].map(() => makeGame({ allyAdcId: 99, enemySupportId: 88 }));
    const result = personalize([rec(1, 1, 0.55)], makeProfile(games), L1_CONTEXT, data, NOW_MS);
    expect(must(result.entries[0]).fallbackLevel).toBe(4);
  });

  it('L3 matches on the enemy damage/archetype signature', () => {
    // Game enemies all carry AD:marksman tags.
    const tags = makeChampionTags([200, 201, 30, 31, 32]);
    for (const id of [200, 201, 30, 31, 32]) {
      tags[String(id)] = makeTag(id, { damageType: 'AD', archetype: 'marksman' });
    }
    const tagData = makeData({ champions: [1, 2, 3], tags });
    const games = [1, 2, 3].map(() => makeGame({ allyAdcId: 99, enemySupportId: 88 }));
    const context: PersonalizeContext = {
      role: 'SUPPORT',
      allyAdcId: null,
      enemySupportId: null,
      enemySignature: new Set(['AD:marksman']),
      rankBucket: 'DIAMOND',
    };
    const result = personalize([rec(1, 1, 0.55)], makeProfile(games), context, tagData, NOW_MS);
    expect(must(result.entries[0]).fallbackLevel).toBe(3);
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
    const champ1 = must(result.entries.find((e) => e.championId === 1));
    expect(champ1.profileWinRate).toBeCloseTo(7.5 / 18, 5);
    const champ2 = must(result.entries.find((e) => e.championId === 2));
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
    const entry = must(result.entries[0]);
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
      RANKNORM_CONFIG,
    );
    const champ1 = must(result.entries.find((e) => e.championId === 1));
    expect(champ1.insufficientData).toBe(true);
    expect(champ1.profileWinRate).toBeNull();
    expect(champ1.deltaVsBaselinePp).toBeNull();
    expect(champ1.baselineWinRate).toBeNull();
    expect(champ1.baselineBucket).toBeNull();
    expect(champ1.nEff).toBeCloseTo(1, 5);
    expect(champ1.personalizedScore).toBe(1); // metaNorm for rank 1 of 2
    // Champ 2 has zero games -> also insufficient, n_eff 0.
    const champ2 = must(result.entries.find((e) => e.championId === 2));
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
    expect(must(result.entries[0]).rank).toBe(1);
    expect(must(result.entries[0]).personalizedScore).toBeGreaterThan(
      must(result.entries[1]).personalizedScore,
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
    const fewResult = must(
      personalize(recs, profileFew, EMPTY_CONTEXT, data, NOW_MS, RANKNORM_CONFIG).entries[0],
    );
    const manyResult = must(
      personalize(recs, profileMany, EMPTY_CONTEXT, data, NOW_MS, RANKNORM_CONFIG).entries[0],
    );
    // metaNorm = 1 for a single-entry list; p ≈ 0.5 < 1, so a larger trust
    // pulls personalizedScore further below metaNorm.
    expect(manyResult.nEff).toBeGreaterThan(fewResult.nEff);
    expect(manyResult.profileWinRate).toBeCloseTo(must(fewResult.profileWinRate), 5);
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
    // All insufficient -> personalizedScore === metaNorm under 'rankNorm'.
    const result = personalize(
      [rec(1, 1, 0.5), rec(2, 2, 0.5), rec(3, 3, 0.5)],
      makeProfile([]),
      EMPTY_CONTEXT,
      data,
      NOW_MS,
      RANKNORM_CONFIG,
    );
    const byChamp = new Map(result.entries.map((e) => [e.championId, e]));
    expect(must(byChamp.get(1)).personalizedScore).toBe(1);
    expect(must(byChamp.get(2)).personalizedScore).toBeCloseTo(0.5, 5);
    expect(must(byChamp.get(3)).personalizedScore).toBe(0);
  });
});

describe('personalize: D-080 baseline badge', () => {
  it('computes deltaVsBaselinePp against the selected bucket baseline (golden)', () => {
    // Champ 1: 3 wins, 3 losses -> winsW=0... craft 2 wins 1 loss instead.
    const games = [
      makeGame({ championId: 1, win: true }),
      makeGame({ championId: 1, win: true }),
      makeGame({ championId: 1, win: false }),
    ];
    // pProfile = 2/3; p = (2 + 15*(2/3)) / (3 + 15) = 12/18 = 2/3.
    const result = personalize([rec(1, 1, 0.55)], makeProfile(games), EMPTY_CONTEXT, data, NOW_MS);
    const entry = must(result.entries[0]);
    expect(entry.profileWinRate).toBeCloseTo(2 / 3, 5);
    // Baseline [1,'DIAMOND',30,50,0.1,50]: w0 = 15010/25020.
    const w0 = 15010 / 25020;
    expect(entry.baselineWinRate).toBeCloseTo(w0, 6);
    expect(entry.baselineBucket).toBe('DIAMOND');
    expect(entry.deltaVsBaselinePp).toBe(Math.round(100 * (2 / 3 - w0)));
    expect(result.schemaVersion).toBe(2);
  });

  it('omits baseline fields when the champion has no baseline row', () => {
    const noRows = makeData({ champions: [1, 2, 3], baselines: [] });
    const games = [1, 2, 3].map(() => makeGame());
    const result = personalize(
      [rec(1, 1, 0.55)],
      makeProfile(games),
      EMPTY_CONTEXT,
      noRows,
      NOW_MS,
    );
    const entry = must(result.entries[0]);
    expect(entry.insufficientData).toBe(false);
    expect(entry.baselineWinRate).toBeNull();
    expect(entry.baselineBucket).toBeNull();
    expect(entry.deltaVsBaselinePp).toBeNull();
  });

  it('omits baseline fields when the baseline row fails the gate', () => {
    // nE = 1^2/1 = 1 < minGames(25) -> no badge baseline.
    const weak = makeData({
      champions: [1, 2, 3],
      baselines: [[1, 'DIAMOND', 1, 1, 1, 1]],
    });
    const games = [1, 2, 3].map(() => makeGame());
    const result = personalize([rec(1, 1, 0.55)], makeProfile(games), EMPTY_CONTEXT, weak, NOW_MS);
    const entry = must(result.entries[0]);
    expect(entry.baselineWinRate).toBeNull();
    expect(entry.deltaVsBaselinePp).toBeNull();
  });

  it('omits baseline fields when the row has no weighted evidence (gamesE = 0)', () => {
    const empty = makeData({
      champions: [1, 2, 3],
      baselines: [[1, 'DIAMOND', 0, 0, 0, 0]],
    });
    const games = [1, 2, 3].map(() => makeGame());
    const result = personalize([rec(1, 1, 0.55)], makeProfile(games), EMPTY_CONTEXT, empty, NOW_MS);
    expect(must(result.entries[0]).baselineWinRate).toBeNull();
    expect(must(result.entries[0]).deltaVsBaselinePp).toBeNull();
  });

  it('ignores baseline rows from other rank buckets', () => {
    const otherBucket = makeData({
      champions: [1, 2, 3],
      baselines: [[1, 'IRON', 30, 50, 0.1, 50]],
    });
    const games = [1, 2, 3].map(() => makeGame());
    const result = personalize(
      [rec(1, 1, 0.55)],
      makeProfile(games),
      EMPTY_CONTEXT,
      otherBucket,
      NOW_MS,
    );
    expect(must(result.entries[0]).baselineBucket).toBeNull();
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
      enemies: [{ championId: 200 }, { championId: 30 }, { championId: 31 }, { championId: 32 }],
    });
    const context = personalizeContext(input, tagData);
    expect(context.role).toBe('SUPPORT');
    expect(context.allyAdcId).toBe(10);
    expect(context.enemySupportId).toBe(200);
    // BL-056: full role->championId maps for the per-role matchup contexts.
    expect(context.allyRoleIds).toEqual({ ADC: 10 });
    expect(context.enemyRoleIds).toEqual({ SUPPORT: 200, TOP: 30, JUNGLE: 31, MID: 32 });
    expect([...context.enemySignature].sort()).toEqual(['AP:mage', 'MIXED:tank']);
  });
});

describe('personalize: role scope (D-097, BL-032)', () => {
  const contextFor = (role: PersonalizeContext['role']): PersonalizeContext => ({
    ...EMPTY_CONTEXT,
    role,
  });

  it('personalizes TOP games for a TOP draft', () => {
    const games = [1, 2, 3].map(() => makeGame({ role: 'TOP' }));
    const result = personalize(
      [rec(1, 1, 0.55)],
      makeProfile(games),
      contextFor('TOP'),
      data,
      NOW_MS,
    );
    const entry = must(result.entries[0]);
    expect(entry.insufficientData).toBe(false);
    expect(entry.fallbackLevel).toBe(4);
    expect(entry.nEff).toBeCloseTo(3, 5);
  });

  it('personalizes JUNGLE games for a JUNGLE draft', () => {
    const games = [1, 2, 3].map(() => makeGame({ role: 'JUNGLE' }));
    const result = personalize(
      [rec(1, 1, 0.55)],
      makeProfile(games),
      contextFor('JUNGLE'),
      data,
      NOW_MS,
    );
    const entry = must(result.entries[0]);
    expect(entry.insufficientData).toBe(false);
    expect(entry.fallbackLevel).toBe(4);
  });

  it('ignores games played in other roles', () => {
    // Three TOP wins must not leak into a SUPPORT draft (and vice versa).
    const topGames = [1, 2, 3].map(() => makeGame({ role: 'TOP' }));
    const supportResult = personalize(
      [rec(1, 1, 0.55)],
      makeProfile(topGames),
      EMPTY_CONTEXT,
      data,
      NOW_MS,
    );
    expect(must(supportResult.entries[0]).insufficientData).toBe(true);

    const jungleGames = [1, 2, 3].map(() => makeGame({ role: 'JUNGLE' }));
    const jungleAsTop = personalize(
      [rec(1, 1, 0.55)],
      makeProfile(jungleGames),
      contextFor('TOP'),
      data,
      NOW_MS,
    );
    expect(must(jungleAsTop.entries[0]).insufficientData).toBe(true);
  });

  it('scopes p_profile to the drafted role', () => {
    // Champ 1: 3 TOP losses + 3 SUPPORT wins. Champ 2: 3 TOP wins.
    // For a TOP draft p_profile = 3/6 = 0.5 over TOP games only; the
    // SUPPORT wins on champ 1 must not count.
    const games = [
      ...[1, 2, 3].map(() => makeGame({ championId: 1, role: 'TOP', win: false })),
      ...[4, 5, 6].map(() => makeGame({ championId: 1, role: 'SUPPORT', win: true })),
      ...[7, 8, 9].map(() => makeGame({ championId: 2, role: 'TOP', win: true })),
    ];
    const result = personalize(
      [rec(1, 1, 0.5), rec(2, 2, 0.5)],
      makeProfile(games),
      contextFor('TOP'),
      data,
      NOW_MS,
    );
    const champ1 = must(result.entries.find((e) => e.championId === 1));
    expect(champ1.insufficientData).toBe(false);
    // p = (0 + 15*0.5)/(3+15) = 7.5/18 — the SUPPORT wins are excluded.
    expect(champ1.profileWinRate).toBeCloseTo(7.5 / 18, 5);
    const champ2 = must(result.entries.find((e) => e.championId === 2));
    expect(champ2.insufficientData).toBe(false);
  });

  it('reports insufficient data for ADC/MID drafts (roles stored but ignored)', () => {
    for (const role of ['ADC', 'MID'] as const) {
      const games = [1, 2, 3, 4, 5].map(() => makeGame({ role }));
      const result = personalize(
        [rec(1, 1, 0.55)],
        makeProfile(games),
        contextFor(role),
        data,
        NOW_MS,
      );
      const entry = must(result.entries[0]);
      expect(entry.insufficientData).toBe(true);
      expect(entry.profileWinRate).toBeNull();
      expect(entry.nEff).toBe(0);
    }
  });

  it('personalizeContext carries the drafted role', () => {
    const input = makeInput({ userRole: 'JUNGLE' });
    const context = personalizeContext(input, data);
    expect(context.role).toBe('JUNGLE');
  });
});

describe('personalize: logit blendMode (D-089, BL-033)', () => {
  it('is the default blend mode', () => {
    expect(DEFAULT_PERSONALIZE_CONFIG.blendMode).toBe('logit');
    const games = [1, 2, 3].map(() => makeGame());
    const recs = [rec(1, 1, 0.55), rec(2, 2, 0.5)];
    const implicit = personalize(recs, makeProfile(games), EMPTY_CONTEXT, data, NOW_MS);
    const explicit = personalize(recs, makeProfile(games), EMPTY_CONTEXT, data, NOW_MS, {
      ...DEFAULT_PERSONALIZE_CONFIG,
      blendMode: 'logit',
    });
    expect(implicit.entries).toEqual(explicit.entries);
  });

  it('blends metaScore and profile win rate in log-odds space', () => {
    const games = [1, 2, 3].map(() => makeGame());
    const cfg = {
      ...DEFAULT_PERSONALIZE_CONFIG,
      kTrust: 1e9, // trust ~ 0 -> personalizedScore ~= metaScore
      blendMode: 'logit' as const,
    };
    const result = personalize(
      [rec(1, 1, 0.55), rec(2, 2, 0.5)],
      makeProfile(games),
      EMPTY_CONTEXT,
      data,
      NOW_MS,
      cfg,
    );
    const entry = result.entries.find((e) => e.championId === 1);
    expect(entry?.insufficientData).toBe(false);
    expect(entry?.personalizedScore).toBeCloseTo(0.55, 6);
  });

  it('matches the spec formula sigmoid((1-trust)*logit(meta) + trust*logit(p))', () => {
    // 4 wins + 2 losses on champ 1 -> p shrunk toward p_profile = 2/3:
    // p = (4 + 15*(2/3))/(6 + 15) = 14/21 = 2/3.
    const games = [
      ...[1, 2, 3, 4].map(() => makeGame({ championId: 1, win: true })),
      ...[5, 6].map(() => makeGame({ championId: 1, win: false })),
    ];
    const result = personalize([rec(1, 1, 0.55)], makeProfile(games), EMPTY_CONTEXT, data, NOW_MS);
    const entry = must(result.entries[0]);
    expect(entry.insufficientData).toBe(false);
    const p = 14 / 21;
    // L4 fallback (no context match): levelFactor 0.7, nEff 6,
    // trust = 6*0.7 / (6*0.7 + 20) = 4.2/24.2.
    const trust = (6 * 0.7) / (6 * 0.7 + 20);
    const eps = 1e-4;
    const logitOf = (x: number) => {
      const c = Math.min(Math.max(x, eps), 1 - eps);
      return Math.log(c / (1 - c));
    };
    const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
    const expected = sigmoid((1 - trust) * logitOf(0.55) + trust * logitOf(p));
    expect(entry.personalizedScore).toBeCloseTo(expected, 10);
  });

  it('clamps log-odds at p = 0 and p = 1 (no ±Infinity)', () => {
    // All wins -> p = 1 after shrinkage (p_profile = 1); all losses -> p = 0.
    for (const win of [true, false]) {
      const games = Array.from({ length: 10 }, () => makeGame({ win }));
      const result = personalize([rec(1, 1, 0.9)], makeProfile(games), EMPTY_CONTEXT, data, NOW_MS);
      const entry = must(result.entries[0]);
      expect(entry.insufficientData).toBe(false);
      expect(Number.isFinite(entry.personalizedScore)).toBe(true);
      expect(entry.personalizedScore).toBeGreaterThan(0);
      expect(entry.personalizedScore).toBeLessThan(1);
    }
  });

  it('trust grows with n_eff under logit: larger samples land closer to p', () => {
    // All wins -> p = 1 for both profiles; only trust differs, so the
    // larger sample's score sits closer to the clamped logit(1).
    const profileFew = makeProfile(Array.from({ length: 6 }, () => makeGame({ win: true })));
    const profileMany = makeProfile(Array.from({ length: 60 }, () => makeGame({ win: true })));
    const recs = [rec(1, 1, 0.5)];
    const few = must(personalize(recs, profileFew, EMPTY_CONTEXT, data, NOW_MS).entries[0]);
    const many = must(personalize(recs, profileMany, EMPTY_CONTEXT, data, NOW_MS).entries[0]);
    expect(many.nEff).toBeGreaterThan(few.nEff);
    expect(many.personalizedScore).toBeGreaterThan(few.personalizedScore);
    expect(many.personalizedScore).toBeLessThan(1);
  });

  it('keeps insufficient-data entries on the metaScore scale in logit mode', () => {
    const cfg = { ...DEFAULT_PERSONALIZE_CONFIG, blendMode: 'logit' as const };
    const result = personalize(
      [rec(1, 1, 0.42)],
      makeProfile([]),
      EMPTY_CONTEXT,
      data,
      NOW_MS,
      cfg,
    );
    const entry = must(result.entries[0]);
    expect(entry.insufficientData).toBe(true);
    expect(entry.personalizedScore).toBe(0.42);
  });

  it('insufficient-data entries keep metaNorm under rankNorm', () => {
    const result = personalize(
      [rec(1, 1, 0.42), rec(2, 2, 0.4)],
      makeProfile([]),
      EMPTY_CONTEXT,
      data,
      NOW_MS,
      RANKNORM_CONFIG,
    );
    expect(must(result.entries.find((e) => e.championId === 1)).personalizedScore).toBe(1);
    expect(must(result.entries.find((e) => e.championId === 2)).personalizedScore).toBe(0);
  });
});
