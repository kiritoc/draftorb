/**
 * Unit tests for reason building and output formatting (T-023, SPECS §5, §7).
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG } from './config.js';
import type { LaneGroupInfo } from './recommend-types.js';
import type { PairDelta } from './recommend-terms.js';
import type { ReasonInputs, ScoredCandidate } from './recommend-reasons.js';
import { buildReasons, toRecommendation } from './recommend-reasons.js';

const EMPTY_LANE: LaneGroupInfo = {
  allies: [],
  enemies: [],
  alliesKnown: [],
  enemiesKnown: [],
  confidence: 1,
  enemyConfidence: 1,
};

const BOT_LANE: LaneGroupInfo = {
  ...EMPTY_LANE,
  allies: [{ championId: 10, role: 'ADC', side: 'ally', confidence: 1, fixed: true }],
  enemies: [
    { championId: 200, role: 'SUPPORT', side: 'enemy', confidence: 1, fixed: true },
    { championId: 201, role: 'ADC', side: 'enemy', confidence: 1, fixed: true },
  ],
};

function pair(side: 'ally' | 'enemy', championId: number, deltaPp: number, n = 25000): PairDelta {
  return {
    side,
    role: 'ADC',
    championId,
    confidence: 1,
    influence: 1,
    term: 0,
    lowData: n < DEFAULT_CONFIG.minGames,
    n,
    deltaPp,
  };
}

function inputs(overrides: Partial<ReasonInputs> = {}): ReasonInputs {
  return {
    pairDeltas: [],
    laneVs: null,
    laneFull: null,
    compDeltaPp: null,
    blindDeltaPp: null,
    laneGroupInfo: EMPTY_LANE,
    ...overrides,
  };
}

describe('buildReasons', () => {
  it('emits reasons in canonical order: pairs, lane_vs, lane_full, comp, blind', () => {
    const lane = { term: 0, lowData: false, n: 25000, deltaPp: 2 };
    const reasons = buildReasons(
      inputs({
        pairDeltas: [pair('ally', 10, 3), pair('enemy', 200, -3)],
        laneVs: lane,
        laneFull: lane,
        compDeltaPp: 0.5,
        blindDeltaPp: -0.5,
        laneGroupInfo: BOT_LANE,
      }),
      DEFAULT_CONFIG,
    );
    expect(reasons.map((r) => r.type)).toEqual([
      'synergy',
      'counter',
      'lane',
      'lane',
      'comp',
      'blind',
    ]);
    expect(reasons[2]?.with).toEqual([200, 201]);
    expect(reasons[3]?.with).toEqual([10, 200, 201]);
  });

  it('gives a lowData pair reason level 0', () => {
    const [r] = buildReasons(inputs({ pairDeltas: [pair('ally', 10, 5, 10)] }), DEFAULT_CONFIG);
    expect(r?.lowData).toBe(true);
    expect(r?.level).toBe(0);
  });

  it('caps positive comp/blind levels at L1 and keeps negative magnitude', () => {
    const reasons = buildReasons(inputs({ compDeltaPp: 5, blindDeltaPp: -5 }), DEFAULT_CONFIG);
    expect(reasons.map((r) => [r.type, r.level, r.n, r.lowData])).toEqual([
      ['comp', 1, 0, false],
      ['blind', -3, 0, false],
    ]);
  });

  it('maps a small unsampled delta to level 0', () => {
    const [r] = buildReasons(inputs({ compDeltaPp: 0.5 }), DEFAULT_CONFIG);
    expect(r?.level).toBe(0);
  });
});

describe('toRecommendation', () => {
  const scored: ScoredCandidate = {
    championId: 1,
    score: 0.6,
    reasons: [
      { type: 'comp', with: [], deltaPp: 1.23456, n: 0, lowData: false, level: 1 },
      { type: 'synergy', with: [10], deltaPp: -0.005, n: 30.5, lowData: false, level: 0 },
    ],
    baselineNEff: 10,
    warnings: ['offRole'],
  };

  it('rounds deltaPp, drops empty with, and keeps a real-valued n', () => {
    const rec = toRecommendation(scored, 3, DEFAULT_CONFIG);
    expect(rec.reasons[0]?.deltaPp).toBe(1.23);
    expect(rec.reasons[0]?.with).toBeUndefined();
    expect(rec.reasons[1]?.with).toEqual([10]);
    expect(rec.reasons[1]?.n).toBe(30.5);
  });

  it('sets rank, omits poolRank unless given, and flags a low baseline n_eff', () => {
    const rec = toRecommendation(scored, 3, DEFAULT_CONFIG);
    expect(rec.rank).toBe(3);
    expect(rec).not.toHaveProperty('poolRank');
    expect(rec.reliability).toEqual({ games: 10, lowData: true });
    expect(rec.warnings).toEqual(['offRole']);
    expect(toRecommendation(scored, 3, DEFAULT_CONFIG, 1).poolRank).toBe(1);
  });
});
