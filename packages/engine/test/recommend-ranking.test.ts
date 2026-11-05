/**
 * recommend(): candidate set, baseline gate, ranking, output shape, determinism.
 */

import { describe, it, expect } from 'vitest';
import type { BaselineTable } from '@draftorb/shared';
import { draftResultSchema } from '@draftorb/shared';
import { recommend } from '../src/recommend.js';
import { DEFAULT_CONFIG, DEFAULT_RECOMMEND_CONFIG } from '../src/config.js';
import {
  BOT_ROLE_PROB,
  asRoleProb,
  makeAllyPairs,
  makeBaselines,
  makeData,
  makeInput,
} from '../src/recommend-test-utils.js';

describe('recommend: candidate set and baseline gate', () => {
  it('includes all champions passing the baseline gate', () => {
    const result = recommend(makeInput(), makeData({ champions: [1, 2, 3] }));
    expect(result.recommendations.map((r) => r.championId).sort((a, b) => a - b)).toEqual([
      1, 2, 3,
    ]);
  });

  it('routes n_eff below minGames to insufficientData with nEff and rawGames', () => {
    const baselines: BaselineTable = [
      [1, 'DIAMOND', 5, 10, 10, 10],
      [2, 'DIAMOND', 30, 50, 0.1, 50],
    ];
    const result = recommend(makeInput(), makeData({ champions: [1, 2], baselines }));
    expect(result.recommendations.map((r) => r.championId)).toEqual([2]);
    expect(result.insufficientData).toHaveLength(1);
    expect(result.insufficientData[0]?.nEff).toBeCloseTo(10, 5);
    expect(result.insufficientData[0]?.rawGames).toBe(10);
  });

  it('excludes champions missing from roleProb entirely', () => {
    const data = makeData({ champions: [1, 2], roleProb: asRoleProb({ '1': { SUPPORT: 1 } }) });
    expect(recommend(makeInput(), data).recommendations.map((r) => r.championId)).toEqual([1]);
  });

  it('reports the exported raw match count, not the weighted sum', () => {
    // 20 half-weight games: games_w = 10, games_w2 = 5, n_eff = 20 < 25.
    const baselines: BaselineTable = [
      [1, 'DIAMOND', 5, 10, 5, 20],
      [2, 'DIAMOND', 30, 50, 0.1, 50],
    ];
    const result = recommend(makeInput(), makeData({ champions: [1, 2], baselines }));
    expect(result.insufficientData.find((i) => i.championId === 1)?.rawGames).toBe(20);
  });

  it('omits rawGames when the baseline games column is 0 or absent', () => {
    const baselines: BaselineTable = [
      [1, 'DIAMOND', 5, 10, 10, 0],
      [2, 'DIAMOND', 5, 10, 10],
      [3, 'DIAMOND', 5, 10, 10, 12],
    ];
    const result = recommend(makeInput(), makeData({ champions: [1, 2, 3], baselines }));
    const byId = (id: number) => result.insufficientData.find((i) => i.championId === id);
    expect(byId(1)).not.toHaveProperty('rawGames');
    expect(byId(2)).not.toHaveProperty('rawGames');
    expect(byId(3)?.rawGames).toBe(12);
  });

  it('a candidate without a baseline row reports nEff 0 and no rawGames', () => {
    const data = makeData({
      champions: [1, 2],
      baselines: makeBaselines([1]),
      roleProb: BOT_ROLE_PROB,
    });
    const entry = recommend(makeInput(), data).insufficientData.find((i) => i.championId === 2);
    expect(entry).toEqual({ championId: 2, nEff: 0 });
  });

  it('ignores rows from other rank buckets', () => {
    const baselines: BaselineTable = [
      [1, 'DIAMOND', 30, 50, 0.1, 50],
      [2, 'MASTER_PLUS', 45, 50, 0.1, 50],
    ];
    const result = recommend(makeInput(), makeData({ champions: [1, 2], baselines }));
    expect(result.recommendations.map((r) => r.championId)).toEqual([1]);
    expect(result.insufficientData.map((i) => i.championId)).toEqual([2]);
  });

  it('maps a MASTER+ userRank to the MASTER_PLUS bucket', () => {
    const baselines: BaselineTable = [
      [1, 'DIAMOND', 30, 50, 0.1, 50],
      [2, 'MASTER_PLUS', 30, 50, 0.1, 50],
    ];
    const data = makeData({ champions: [1, 2], baselines, roleProb: BOT_ROLE_PROB });
    const result = recommend(makeInput({ userRank: 'GRANDMASTER' }), data);
    expect(result.recommendations.map((r) => r.championId)).toEqual([2]);
    expect(result.insufficientData.map((i) => i.championId)).toEqual([1]);
  });

  it('honors an injected roleProbThreshold', () => {
    const high = { ...DEFAULT_RECOMMEND_CONFIG, roleProbThreshold: 1.1 };
    const data = makeData({ champions: [1, 2], roleProb: BOT_ROLE_PROB });
    expect(recommend(makeInput(), data, DEFAULT_CONFIG, high).recommendations).toEqual([]);
  });
});

describe('recommend: sorting and ranking', () => {
  it('sorts by descending score with 1-based sequential ranks', () => {
    const baselines: BaselineTable = [
      [1, 'DIAMOND', 40, 50, 0.1, 50],
      [2, 'DIAMOND', 25, 50, 0.1, 50],
      [3, 'DIAMOND', 10, 50, 0.1, 50],
    ];
    const result = recommend(makeInput(), makeData({ champions: [1, 2, 3], baselines }));
    const [s0 = 0, s1 = 0, s2 = 0] = result.recommendations.map((r) => r.score);
    expect(s0).toBeGreaterThan(s1);
    expect(s1).toBeGreaterThan(s2);
    expect(result.recommendations.map((r) => r.championId)).toEqual([1, 2, 3]);
    expect(result.recommendations.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('orders identical scores by championId ascending', () => {
    const roleProb = asRoleProb({ '4': { MID: 1 }, '7': { MID: 1 }, '9': { MID: 1 } });
    const data = makeData({ champions: [9, 4, 7], roleProb });
    const ids = recommend(makeInput({ userRole: 'MID' }), data).recommendations.map(
      (r) => r.championId,
    );
    expect(ids).toEqual([4, 7, 9]);
  });

  it('orders nearly equal scores by score, not bucketed', () => {
    const baselines: BaselineTable = [
      [1, 'DIAMOND', 30, 50, 0.1, 50],
      [2, 'DIAMOND', 30.0000001, 50, 0.1, 50],
    ];
    const data = makeData({ champions: [1, 2], roleProb: BOT_ROLE_PROB, baselines });
    expect(recommend(makeInput(), data).recommendations.map((r) => r.championId)).toEqual([2, 1]);
  });

  it('a perfect baseline record yields a finite score', () => {
    const baselines: BaselineTable = [[1, 'DIAMOND', 50, 50, 0.1, 50]];
    const data = makeData({ champions: [1], baselines, roleProb: BOT_ROLE_PROB });
    expect(Number.isFinite(recommend(makeInput(), data).recommendations[0]?.score)).toBe(true);
  });

  it('reliability.nEff reports the baseline n_eff', () => {
    const rec = recommend(makeInput(), makeData({ champions: [1] })).recommendations[0];
    expect(rec?.reliability.nEff).toBeCloseTo(50 ** 2 / 0.1, 6);
    expect(rec?.reliability.lowData).toBe(false);
  });
});

describe('recommend: output contract and robustness', () => {
  it('every DraftResult round-trips through the shared zod schema', () => {
    const baselines: BaselineTable = [
      [1, 'DIAMOND', 30, 50, 0.1, 50],
      [2, 'DIAMOND', 5, 10, 10],
      [202, 'DIAMOND', 30, 50, 0.1, 50],
    ];
    const allyPairs = makeAllyPairs([
      { championId: 1, allyId: 10, role: 'ADC', winsW: 10, gamesW: 10, gamesW2: 10 },
    ]);
    const data = makeData({
      champions: [1, 2, 10, 200, 202],
      roleProb: BOT_ROLE_PROB,
      baselines,
      allyPairs,
    });
    const input = makeInput({
      allies: [{ championId: 10, role: 'ADC' }],
      enemies: [{ championId: 200, role: 'SUPPORT' }],
      pool: [1, 2, 200, 999],
    });
    const result = recommend(input, data);
    expect(draftResultSchema.parse(result)).toEqual(result);
    expect(result.recommendations[0]?.reasons.some((r) => r.level === 0)).toBe(true);
    expect(result.poolUnavailable?.some((u) => u.reason === 'picked')).toBe(true);
    expect(result.insufficientData.find((i) => i.championId === 2)).not.toHaveProperty('rawGames');
  });

  it('same input produces identical output', () => {
    const data = makeData({ champions: [1, 2, 3] });
    const input = makeInput({
      allies: [{ championId: 2, role: 'ADC' }],
      enemies: [{ championId: 3, role: 'SUPPORT' }],
      pool: [1],
    });
    expect(recommend(input, data)).toEqual(recommend(input, data));
  });

  it('does not crash on empty boards, blind pick, no baselines or no champions', () => {
    const two = makeData({ champions: [1, 2] });
    expect(recommend(makeInput(), two).recommendations).toHaveLength(2);
    expect(recommend(makeInput({ blindPick: true }), two).recommendations).toHaveLength(2);
    const noBase = recommend(makeInput(), makeData({ champions: [1, 2], baselines: [] }));
    expect(noBase.recommendations).toHaveLength(0);
    expect(noBase.insufficientData).toHaveLength(2);
    expect(recommend(makeInput(), makeData({ champions: [] })).recommendations).toHaveLength(0);
  });
});
