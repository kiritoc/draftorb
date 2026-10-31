/**
 * recommend(): layer 4 (comp need) and layer 5 (blind safety), including config injection.
 */

import { describe, it, expect } from 'vitest';
import type { ChampionTags, ChampionTagsMap, EnemyPairTable, RecommendData, Role } from '@draftorb/shared';
import { recommend } from './recommend.js';
import { DEFAULT_COMP_CONFIG, DEFAULT_CONFIG, DEFAULT_RECOMMEND_CONFIG } from './config.js';
import {
  BOT_ROLE_PROB,
  FIXED_BOT,
  HIGH_GAMES,
  asRoleProb,
  makeBaselines,
  makeChampionTags,
  makeData,
  makeEnemyPairs,
  makeInput,
  makeTag,
  noUtilityTag,
} from './recommend-test-utils.js';

type Rec = ReturnType<typeof recommend>['recommendations'][number];

const blindOf = (rec: Rec | undefined) => rec?.reasons.find((r) => r.type === 'blind');
const hasComp = (rec: Rec | undefined): boolean =>
  rec?.reasons.some((r) => r.type === 'comp') ?? false;

/** Candidate 1 vs unseen ADC 201 with a bad (winsW 10) or custom matchup. */
function blindData(winsW = 10, champions = [1, 201]): RecommendData {
  const enemyPairs = makeEnemyPairs([
    { championId: 1, enemyId: 201, role: 'ADC', ...HIGH_GAMES, winsW },
  ]);
  return makeData({ champions, roleProb: BOT_ROLE_PROB, enemyPairs });
}

describe('recommend: blind safety triggers', () => {
  it('ranks by unseen likely opponents in blind pick', () => {
    const enemyPairs = makeEnemyPairs([
      { championId: 1, enemyId: 201, role: 'ADC', ...HIGH_GAMES, winsW: 10 },
      { championId: 2, enemyId: 201, role: 'ADC', ...HIGH_GAMES, winsW: 40 },
    ]);
    const data = makeData({ champions: [1, 2, 201], roleProb: BOT_ROLE_PROB, enemyPairs });
    const result = recommend(makeInput({ blindPick: true }), data);
    expect(result.recommendations.map((r) => r.championId)).toEqual([2, 1]);
    expect(blindOf(result.recommendations[0])).toBeDefined();
  });

  it.each<Role>(['ADC', 'MID', 'JUNGLE'])(
    'applies for %s when the lane enemy is unknown and blindPick is false',
    (role) => {
      const roleProb = asRoleProb({ '11': { [role]: 1 }, '12': { [role]: 1 }, '201': { [role]: 1 } });
      const enemyPairs = makeEnemyPairs([
        { championId: 11, enemyId: 201, role, ...HIGH_GAMES, winsW: 10 },
      ]);
      // 201 has no baseline: it is only a likely opponent, never scored itself.
      const data = makeData({
        champions: [11, 12, 201],
        baselines: makeBaselines([11, 12]),
        roleProb,
        enemyPairs,
      });
      const result = recommend(makeInput({ userRole: role }), data);
      expect(blindOf(result.recommendations.find((r) => r.championId === 11))).toBeDefined();
      expect(result.recommendations.map((r) => r.championId)).toEqual([12, 11]);
    },
  );

  it('never fires for a known 1v1 enemy without blindPick', () => {
    const roleProb = asRoleProb({ '1': { TOP: 1 }, '2': { TOP: 1 }, '300': { TOP: 1 } });
    const enemyPairs = makeEnemyPairs([
      { championId: 1, enemyId: 300, role: 'TOP', ...HIGH_GAMES, winsW: 10 },
    ]);
    const data = makeData({ champions: [1, 2, 300], roleProb, enemyPairs });
    const input = makeInput({ userRole: 'TOP', enemies: [{ championId: 300, role: 'TOP' }] });
    for (const rec of recommend(input, data).recommendations) expect(blindOf(rec)).toBeUndefined();
  });

  it('does not re-score a known enemy', () => {
    const enemyPairs = makeEnemyPairs([
      { championId: 1, enemyId: 200, role: 'SUPPORT', ...HIGH_GAMES, winsW: 10 },
    ]);
    const roleProb = asRoleProb({ '1': { SUPPORT: 1 }, '200': { SUPPORT: 1 } });
    const data = makeData({ champions: [1, 200], roleProb, enemyPairs });
    const rec = recommend(makeInput({ enemies: [{ championId: 200, role: 'SUPPORT' }] }), data)
      .recommendations[0];
    expect(blindOf(rec)).toBeUndefined();
  });

  it('with only the enemy SUPPORT known, scores only the unseen ADC role', () => {
    const roleProb = asRoleProb({ ...BOT_ROLE_PROB, '202': { SUPPORT: 1 } });
    const blindFor = (enemyPairs: EnemyPairTable): number | undefined =>
      blindOf(
        recommend(
          makeInput({ blindPick: true, enemies: [{ championId: 200, role: 'SUPPORT' }] }),
          makeData({ champions: [1, 200, 201, 202], roleProb, enemyPairs }),
        ).recommendations.find((r) => r.championId === 1),
      )?.deltaPp;
    expect(blindFor([[1, 201, 'ADC', 'DIAMOND', 10, 50, 0.1]])).toBeLessThan(0);
    // A bad matchup vs an unseen SUPPORT must not matter: SUPPORT is already known.
    expect(blindFor([[1, 202, 'SUPPORT', 'DIAMOND', 10, 50, 0.1]])).toBeUndefined();
  });

  it('adds nothing with blindPick and a fully known lane', () => {
    const roleProb = asRoleProb({ ...BOT_ROLE_PROB, '202': { ADC: 1 } });
    const enemyPairs: EnemyPairTable = [[1, 202, 'ADC', 'DIAMOND', 10, 50, 0.1]];
    const data = makeData({ champions: [1, 200, 201, 202], roleProb, enemyPairs });
    const rec = recommend(makeInput({ blindPick: true, enemies: FIXED_BOT }), data)
      .recommendations.find((r) => r.championId === 1);
    expect(blindOf(rec)).toBeUndefined();
  });
});

describe('recommend: blind safety values and levels', () => {
  it('gives blind reasons a negative level for a bad unseen matchup', () => {
    const rec = recommend(makeInput({ blindPick: true }), blindData()).recommendations[0];
    expect(blindOf(rec)?.level).toBeLessThan(0);
  });

  it('caps positive blind levels at L1 even when highLevelMinGames equals minGames', () => {
    const config = { ...DEFAULT_CONFIG, highLevelMinGames: DEFAULT_CONFIG.minGames };
    const rec = recommend(makeInput({ blindPick: true }), blindData(48), config).recommendations[0];
    expect(blindOf(rec)?.level).toBe(1);
  });

  it('keeps negative blind levels when minGames is 0', () => {
    const config = { ...DEFAULT_CONFIG, minGames: 0 };
    const rec = recommend(makeInput({ blindPick: true }), blindData(5), config).recommendations[0];
    expect(blindOf(rec)?.level).toBeLessThan(0);
  });

  it('missing matchups dilute the expected term instead of being skipped', () => {
    const delta = (d: RecommendData): number =>
      blindOf(recommend(makeInput({ blindPick: true }), d).recommendations[0])?.deltaPp ?? 0;
    expect(delta(blindData(10, [1, 201, 202]))).toBeGreaterThan(delta(blindData()));
  });

  it('honors an injected wBlind of 0', () => {
    const rc = { ...DEFAULT_RECOMMEND_CONFIG, wBlind: 0 };
    const rec = recommend(makeInput({ blindPick: true }), blindData(), DEFAULT_CONFIG, rc)
      .recommendations[0];
    expect(blindOf(rec)).toBeUndefined();
  });
});

describe('recommend: comp need', () => {
  const withNoUtilityAlly = (): RecommendData =>
    makeData({
      champions: [1, 77],
      roleProb: asRoleProb({ ...BOT_ROLE_PROB, '77': { ADC: 1 } }),
      tags: { ...makeChampionTags([1]), '77': noUtilityTag(77) },
    });
  const fixedAlly77 = makeInput({ allies: [{ championId: 77, role: 'ADC' }] });

  it('emits no comp reason when no ally is known', () => {
    for (const rec of recommend(makeInput(), makeData({ champions: [1, 2] })).recommendations) {
      expect(hasComp(rec)).toBe(false);
    }
  });

  it('uses a tagged ally whose role could not be inferred', () => {
    const tags: ChampionTagsMap = { ...makeChampionTags([1, 2]), '77': noUtilityTag(77) };
    const data = makeData({ champions: [1, 2, 77], roleProb: BOT_ROLE_PROB, tags });
    for (const rec of recommend(makeInput({ allies: [{ championId: 77 }] }), data).recommendations) {
      expect(hasComp(rec)).toBe(true);
    }
  });

  it('an unresolved, untagged ally creates no comp reason', () => {
    const data = makeData({ champions: [1, 2, 77], roleProb: BOT_ROLE_PROB });
    for (const rec of recommend(makeInput({ allies: [{ championId: 77 }] }), data).recommendations) {
      expect(hasComp(rec)).toBe(false);
    }
  });

  it('applies the AD/AP damage-mix need with MIXED allies counted on both sides', () => {
    const full = (id: number, damageType: ChampionTags['damageType']): ChampionTags =>
      makeTag(id, { damageType, poke: true });
    const tags: ChampionTagsMap = {
      '1': full(1, 'AP'),
      '2': full(2, 'AD'),
      '10': full(10, 'AD'),
      '11': full(11, 'AD'),
      '20': full(20, 'MIXED'),
    };
    const roleProb = asRoleProb({ ...BOT_ROLE_PROB, '20': { MID: 1 } });
    const data = makeData({ champions: [1, 2, 10, 11, 20], roleProb, tags });
    // AD side: 10, 11, 20 = 3; AP side: 20 = 1 -> AP share 0.25 < 0.5.
    const input = makeInput({
      allies: [
        { championId: 10, role: 'ADC' },
        { championId: 11, role: 'TOP' },
        { championId: 20, role: 'MID' },
      ],
    });
    const recs = recommend(input, data).recommendations;
    expect(hasComp(recs.find((r) => r.championId === 1))).toBe(true);
    expect(hasComp(recs.find((r) => r.championId === 2))).toBe(false);
  });

  it('passes a custom comp config through recommend', () => {
    const score = (engage: number): number =>
      recommend(fixedAlly77, withNoUtilityAlly(), DEFAULT_CONFIG, {
        ...DEFAULT_RECOMMEND_CONFIG,
        comp: { ...DEFAULT_COMP_CONFIG, engage },
      }).recommendations[0]?.score ?? 0;
    expect(score(0.5)).toBeGreaterThan(score(0.1));
  });

  it('caps a positive comp delta >= 2pp at L1', () => {
    const rc = { ...DEFAULT_RECOMMEND_CONFIG, wComp: 5 };
    const comp = recommend(fixedAlly77, withNoUtilityAlly(), DEFAULT_CONFIG, rc)
      .recommendations[0]?.reasons.find((r) => r.type === 'comp');
    expect(comp?.deltaPp).toBeGreaterThanOrEqual(2);
    expect(comp?.level).toBe(1);
  });

  it('emits no comp reason with wComp 0', () => {
    const rc = { ...DEFAULT_RECOMMEND_CONFIG, wComp: 0 };
    for (const rec of recommend(fixedAlly77, withNoUtilityAlly(), DEFAULT_CONFIG, rc)
      .recommendations) {
      expect(hasComp(rec)).toBe(false);
    }
  });
});
