import { describe, it, expect } from 'vitest';

import { draftResultSchema } from '@draftorb/shared';
import type { DraftInput } from '@draftorb/shared';

import { recommend } from './recommend.js';
import type { DraftData } from './recommend.js';

const SUP_A = 1; // neutral support
const SUP_B = 2; // better baseline, hard-countered by ENEMY_SUP
const SUP_LOW = 3; // too few games -> insufficientData
const MID_POOL = 5; // mid laner with data, off-role pool pick
const ENEMY_SUP = 10;
const ENEMY_ADC = 11;
const ALLY_ADC = 12;
const TOP_A = 30;
const TOP_B = 31;
const ENEMY_TOP = 40;
const UNKNOWN = 999;

const supportData: DraftData = {
  roleProb: {
    [SUP_A]: { SUPPORT: 1 },
    [SUP_B]: { SUPPORT: 1 },
    [SUP_LOW]: { SUPPORT: 1 },
    [MID_POOL]: { MID: 1 },
    [ENEMY_SUP]: { SUPPORT: 1 },
    [ENEMY_ADC]: { ADC: 1 },
    [ALLY_ADC]: { ADC: 1 },
  },
  baseline: [
    [SUP_A, 'DIAMOND', 50, 100, 100],
    [SUP_B, 'DIAMOND', 52, 100, 100],
    [SUP_LOW, 'DIAMOND', 6, 10, 10],
    [MID_POOL, 'DIAMOND', 50, 100, 100],
  ],
  allyPairs: [[SUP_A, ALLY_ADC, 'ADC', 'DIAMOND', 6, 10, 10]], // lowData pair
  enemyPairs: [[SUP_B, ENEMY_SUP, 'SUPPORT', 'DIAMOND', 30, 200, 200]],
  laneVs: [],
  laneFull: [],
};

function supportInput(overrides: Partial<DraftInput> = {}): DraftInput {
  return {
    userRank: 'DIAMOND',
    userRole: 'SUPPORT',
    allies: [{ championId: ALLY_ADC, role: 'ADC' }],
    enemies: [{ championId: ENEMY_SUP, role: 'SUPPORT' }],
    blindPick: false,
    ...overrides,
  };
}

describe('recommend — SUPPORT golden', () => {
  it('penalizes a hard-countered candidate with a negative counter reason', () => {
    const result = recommend(supportInput(), supportData);
    expect(draftResultSchema.parse(result)).toEqual(result);
    expect(result.recommendations.map((r) => r.championId)).toEqual([SUP_A, SUP_B]);

    const b = result.recommendations[1];
    const counter = b?.reasons.find((r) => r.type === 'counter');
    expect(counter?.with).toEqual([ENEMY_SUP]);
    expect(counter?.level).toBeLessThan(0);
    expect(counter?.lowData).toBe(false);
    expect(b?.warnings.some((w) => w.startsWith('countered by enemy'))).toBe(true);
  });

  it('flags a lowData pair with delta 0 and no level', () => {
    const result = recommend(supportInput(), supportData);
    const a = result.recommendations.find((r) => r.championId === SUP_A);
    const synergy = a?.reasons.find((r) => r.type === 'synergy');
    expect(synergy?.lowData).toBe(true);
    expect(synergy?.deltaPp).toBe(0);
    expect(synergy?.level).toBeUndefined();
  });

  it('sends a low-sample candidate to insufficientData, never ranked', () => {
    const result = recommend(supportInput(), supportData);
    expect(result.recommendations.some((r) => r.championId === SUP_LOW)).toBe(false);
    expect(result.insufficientData).toEqual([{ championId: SUP_LOW, nEff: 10, rawGames: 10 }]);
  });

  it('excludes picked champions, never yields NaN, and sorts desc', () => {
    const recs = recommend(supportInput(), supportData).recommendations;
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i];
      expect(Number.isFinite(r?.score)).toBe(true);
      expect([ENEMY_SUP, ALLY_ADC]).not.toContain(r?.championId);
      expect(r?.rank).toBe(i + 1);
      if (i > 0) {
        expect(r?.score ?? 0).toBeLessThanOrEqual(recs[i - 1]?.score ?? 0);
      }
    }
  });

  it('handles an empty draft and is deterministic', () => {
    const input = supportInput({ allies: [], enemies: [] });
    const a = recommend(input, supportData);
    expect(recommend(input, supportData)).toEqual(a);
    expect(a.recommendations.every((r) => r.reasons.length === 0)).toBe(true);
  });

  it('applies lane_vs then lane_full when the bot lane is fully known', () => {
    const data: DraftData = {
      ...supportData,
      laneVs: [[SUP_A, ENEMY_SUP, ENEMY_ADC, 'DIAMOND', 70, 100, 100]],
      laneFull: [[SUP_A, ALLY_ADC, ENEMY_SUP, ENEMY_ADC, 'DIAMOND', 20, 30, 30]],
    };
    const input = supportInput({
      enemies: [
        { championId: ENEMY_SUP, role: 'SUPPORT' },
        { championId: ENEMY_ADC, role: 'ADC' },
      ],
    });
    const a = recommend(input, data).recommendations.find((r) => r.championId === SUP_A);
    const lanes = a?.reasons.filter((r) => r.type === 'lane') ?? [];
    expect(lanes).toHaveLength(2);
    expect(lanes[0]?.with).toEqual([ENEMY_SUP, ENEMY_ADC]);
    expect(lanes[0]?.deltaPp).toBeGreaterThan(0);
    expect(lanes[1]?.with).toEqual([ALLY_ADC, ENEMY_SUP, ENEMY_ADC]);
  });
});

describe('recommend — TOP golden (1v1, lane_full skipped)', () => {
  const topData: DraftData = {
    roleProb: { [TOP_A]: { TOP: 1 }, [TOP_B]: { TOP: 1 }, [ENEMY_TOP]: { TOP: 1 } },
    baseline: [
      [TOP_A, 'DIAMOND', 48, 100, 100],
      [TOP_B, 'DIAMOND', 52, 100, 100],
    ],
    allyPairs: [],
    enemyPairs: [[TOP_A, ENEMY_TOP, 'TOP', 'DIAMOND', 120, 200, 200]],
    laneVs: [[TOP_A, ENEMY_TOP, null, 'DIAMOND', 280, 400, 400]],
    laneFull: [],
  };

  it('uses the TOP influence row and a single lane_vs layer', () => {
    const input: DraftInput = {
      userRank: 'DIAMOND',
      userRole: 'TOP',
      allies: [],
      enemies: [{ championId: ENEMY_TOP, role: 'TOP' }],
      blindPick: false,
    };
    const result = recommend(input, topData);
    expect(result.recommendations.map((r) => r.championId)).toEqual([TOP_A, TOP_B]);

    const a = result.recommendations[0];
    expect(a?.reasons.map((r) => r.type)).toEqual(['counter', 'lane']);
    expect(a?.reasons[0]?.level).toBeGreaterThan(0);
    expect(a?.reasons[1]?.with).toEqual([ENEMY_TOP]);
  });
});

describe('recommend — pool contract (D-024)', () => {
  const pool = [MID_POOL, SUP_LOW, UNKNOWN, SUP_B];

  it('never changes scores and keeps the roleProb-set order', () => {
    const without = recommend(supportInput(), supportData);
    const withPool = recommend(supportInput({ pool }), supportData);

    for (const r of without.recommendations) {
      const same = withPool.recommendations.find((x) => x.championId === r.championId);
      expect(same?.score).toBe(r.score);
      expect(same?.reasons).toEqual(r.reasons);
    }
    const baseIds = new Set(without.recommendations.map((r) => r.championId));
    const kept = withPool.recommendations.map((r) => r.championId).filter((id) => baseIds.has(id));
    expect(kept).toEqual(without.recommendations.map((r) => r.championId));
  });

  it('returns poolRecommendations in overall order with poolRank', () => {
    const result = recommend(supportInput({ pool }), supportData);
    expect(draftResultSchema.parse(result)).toEqual(result);
    const poolRecs = result.poolRecommendations ?? [];
    const overall = result.recommendations
      .filter((r) => pool.includes(r.championId))
      .map((r) => r.championId);
    expect(poolRecs.map((r) => r.championId)).toEqual(overall);
    expect(poolRecs.map((r) => r.poolRank)).toEqual(poolRecs.map((_, i) => i + 1));
  });

  it('scores an off-role pool champion with the offRole warning', () => {
    const result = recommend(supportInput({ pool }), supportData);
    const mid = result.recommendations.find((r) => r.championId === MID_POOL);
    expect(mid?.warnings).toContain('offRole');
  });

  it('lists pool champions without a score in poolUnavailable', () => {
    const result = recommend(supportInput({ pool }), supportData);
    expect(result.poolUnavailable).toEqual([
      { championId: SUP_LOW, reason: 'insufficientData' },
      { championId: UNKNOWN, reason: 'unknownChampion' },
    ]);
    expect(result.insufficientData.some((e) => e.championId === SUP_LOW)).toBe(true);
    expect(result.insufficientData.some((e) => e.championId === UNKNOWN)).toBe(false);
  });

  it('omits pool fields when the pool is empty', () => {
    const result = recommend(supportInput({ pool: [] }), supportData);
    expect(result.poolRecommendations).toBeUndefined();
    expect(result.poolUnavailable).toBeUndefined();
  });
});
