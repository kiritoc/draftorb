/**
 * recommend(): pool contract (D-024) end to end, plus the seeded invariance property test.
 * Pool unit tests (candidate set, poolUnavailable building) live in recommend-pool.test.ts.
 */

import { describe, it, expect } from 'vitest';
import type { BaselineTable, ChampionId, Role } from '@draftorb/shared';
import { recommend } from './recommend.js';
import {
  BOT_ROLE_PROB,
  HIGH_GAMES,
  asRoleProb,
  makeBaselines,
  makeData,
  makeEnemyPairs,
  makeInput,
} from './recommend-test-utils.js';

const ids = (recs: Array<{ championId: ChampionId }>): ChampionId[] =>
  recs.map((r) => r.championId);

describe('recommend: pool lists', () => {
  it('poolRecommendations is an ordered subsequence with global rank and poolRank', () => {
    const result = recommend(makeInput({ pool: [2, 4] }), makeData({ champions: [1, 2, 3, 4, 5] }));
    const overall = ids(result.recommendations);
    const pool = result.poolRecommendations ?? [];
    expect(overall).toHaveLength(5);
    expect(pool.map((r) => r.poolRank)).toEqual([1, 2]);
    const idx = pool.map((r) => overall.indexOf(r.championId));
    expect(idx[1]).toBeGreaterThan(idx[0] ?? Infinity);
    pool.forEach((r, i) => expect(r.rank).toBe((idx[i] ?? -1) + 1));
  });

  it('an empty pool still returns the full overall list and no pool list', () => {
    const result = recommend(makeInput({ pool: [] }), makeData({ champions: [1, 2, 3] }));
    expect(result.recommendations).toHaveLength(3);
    expect(result.poolRecommendations).toBeUndefined();
  });

  it('deduplicates repeated pool ids', () => {
    const data = makeData({ champions: [1, 2], roleProb: BOT_ROLE_PROB });
    expect(ids(recommend(makeInput({ pool: [1, 1] }), data).poolRecommendations ?? [])).toEqual([
      1,
    ]);
    expect(recommend(makeInput({ pool: [999, 999] }), data).poolUnavailable).toHaveLength(1);
  });
});

describe('recommend: pool champions that cannot be scored', () => {
  it('without baseline data -> poolUnavailable insufficientData + insufficientData', () => {
    const data = makeData({ champions: [1, 2, 3], baselines: makeBaselines([1, 2]) });
    const result = recommend(makeInput({ pool: [3] }), data);
    expect(result.poolUnavailable).toEqual([{ championId: 3, reason: 'insufficientData' }]);
    expect(result.insufficientData.some((i) => i.championId === 3)).toBe(true);
  });

  it('below the gate reports nEff and rawGames', () => {
    const baselines: BaselineTable = [
      [1, 'DIAMOND', 30, 50, 0.1, 50],
      [2, 'DIAMOND', 5, 10, 10, 12],
    ];
    const data = makeData({ champions: [1, 2], roleProb: BOT_ROLE_PROB, baselines });
    const result = recommend(makeInput({ pool: [2] }), data);
    const entry = result.insufficientData.find((i) => i.championId === 2);
    expect(entry?.nEff).toBeCloseTo(10, 5);
    expect(entry?.rawGames).toBe(12);
    expect(result.poolUnavailable).toEqual([{ championId: 2, reason: 'insufficientData' }]);
  });

  it('an off-role pool champion below the gate is never scored', () => {
    const roleProb = asRoleProb({ ...BOT_ROLE_PROB, '99': { TOP: 1 } });
    const baselines: BaselineTable = [
      [1, 'DIAMOND', 30, 50, 0.1, 50],
      [99, 'DIAMOND', 5, 10, 10, 10],
    ];
    const result = recommend(
      makeInput({ pool: [99] }),
      makeData({ champions: [1, 99], roleProb, baselines }),
    );
    expect(ids(result.recommendations)).not.toContain(99);
    expect(result.poolUnavailable).toEqual([{ championId: 99, reason: 'insufficientData' }]);
    expect(result.poolRecommendations).toEqual([]);
  });

  it('an unknown id is reported as unknownChampion and never scored, even with a baseline row', () => {
    const data = makeData({ champions: [1, 2], baselines: makeBaselines([1, 2, 999]) });
    const result = recommend(makeInput({ pool: [999] }), data);
    expect(ids(result.recommendations)).not.toContain(999);
    expect(result.poolUnavailable).toEqual([{ championId: 999, reason: 'unknownChampion' }]);
  });

  it('a board pick is reported as picked and never scored', () => {
    const data = makeData({ champions: [1, 2, 200], roleProb: BOT_ROLE_PROB });
    const input = makeInput({ enemies: [{ championId: 200, role: 'SUPPORT' }], pool: [200] });
    const result = recommend(input, data);
    expect(ids(result.recommendations)).not.toContain(200);
    expect(result.poolRecommendations).toEqual([]);
    expect(result.poolUnavailable).toEqual([{ championId: 200, reason: 'picked' }]);
  });

  it('reports picked, unknownChampion and insufficientData together', () => {
    const baselines: BaselineTable = [
      [1, 'DIAMOND', 30, 50, 0.1, 50],
      [2, 'DIAMOND', 5, 10, 10, 10],
      [200, 'DIAMOND', 30, 50, 0.1, 50],
    ];
    const data = makeData({ champions: [1, 2, 200], baselines, roleProb: BOT_ROLE_PROB });
    const input = makeInput({
      enemies: [{ championId: 200, role: 'SUPPORT' }],
      pool: [1, 2, 200, 999],
    });
    const result = recommend(input, data);
    const unavailable = [...(result.poolUnavailable ?? [])].sort(
      (a, b) => a.championId - b.championId,
    );
    expect(unavailable).toEqual([
      { championId: 2, reason: 'insufficientData' },
      { championId: 200, reason: 'picked' },
      { championId: 999, reason: 'unknownChampion' },
    ]);
    expect(ids(result.poolRecommendations ?? [])).toEqual([1]);
  });
});

describe('recommend: off-role pool champions', () => {
  it('are scored with an offRole warning, with or without a roleProb entry', () => {
    const roleProb = asRoleProb({ ...BOT_ROLE_PROB, '3': { TOP: 1 } });
    const result = recommend(
      makeInput({ pool: [3, 88] }),
      makeData({ champions: [1, 2, 3, 88], roleProb }),
    );
    for (const id of [3, 88]) {
      expect(result.recommendations.find((r) => r.championId === id)?.warnings).toContain(
        'offRole',
      );
    }
    expect(ids(result.poolRecommendations ?? []).sort((a, b) => a - b)).toEqual([3, 88]);
  });
});

describe('recommend: pool invariance property (D-024)', () => {
  // Deterministic LCG so the property test is reproducible (engine purity rule).
  function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
  }

  it('scores, reasons and relative order never change with any pool (100 seeded drafts)', () => {
    const champions: ChampionId[] = [1, 2, 3, 4, 5, 6, 10, 200, 201];
    const roleProb = asRoleProb({
      '1': { SUPPORT: 1 },
      '2': { SUPPORT: 1 },
      '3': { SUPPORT: 0.5, MID: 0.5 },
      '4': { TOP: 1 },
      '5': { SUPPORT: 1 },
      '6': { JUNGLE: 1 },
      '10': { ADC: 1 },
      '200': { SUPPORT: 1 },
      '201': { ADC: 1 },
    });
    for (let seed = 1; seed <= 100; seed++) {
      const rnd = lcg(seed);
      const baselines: BaselineTable = champions.map((c) => [
        c,
        'DIAMOND',
        20 + Math.floor(rnd() * 20),
        50,
        0.1,
        50,
      ]);
      const enemyPairs = makeEnemyPairs(
        [1, 2, 3, 4, 5].map((c) => ({
          championId: c,
          enemyId: 200,
          role: 'SUPPORT' as Role,
          ...HIGH_GAMES,
          winsW: 10 + Math.floor(rnd() * 30),
        })),
      );
      const data = makeData({ champions, baselines, roleProb, enemyPairs });
      const enemies = rnd() < 0.5 ? [{ championId: 200, role: 'SUPPORT' as Role }] : [];
      const blindPick = rnd() < 0.5;
      const pool = [1, 2, 3, 4, 5, 6, 999].filter(() => rnd() < 0.5);
      const base = recommend(makeInput({ enemies, blindPick }), data).recommendations;
      const pooled = recommend(makeInput({ enemies, blindPick, pool }), data).recommendations;
      for (const rec of base) {
        const other = pooled.find((r) => r.championId === rec.championId);
        expect(other?.score).toBe(rec.score);
        expect(other?.reasons).toEqual(rec.reasons);
      }
      const baseIds = ids(base);
      expect(ids(pooled).filter((id) => baseIds.includes(id))).toEqual(baseIds);
    }
  });
});
