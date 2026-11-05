/**
 * Unit tests for blind safety numeric output (T-023, SPECS §5).
 */

import { describe, it, expect } from 'vitest';
import type { ChampionRoleProbabilities, EnemyPairTable, PickRate } from '@draftorb/shared';
import { DEFAULT_CONFIG, DEFAULT_RECOMMEND_CONFIG, getInfluence } from '../src/config.js';
import { indexPairs, makePairKey } from '../src/recommend-indexes.js';
import { scorePair } from '../src/levels.js';
import type { KnownSlot } from '../src/recommend-types.js';
import {
  blindOpponents,
  blindSafetyFromOpponents,
  computeBlindSafety,
  hardCounterWarnings,
  scorePairs,
} from '../src/recommend-terms.js';
import type { PairDelta } from '../src/recommend-terms.js';
import { roundDeltaPp } from '../src/recommend-reasons.js';

function deltaAt(deltaPp: number): PairDelta {
  return {
    side: 'enemy',
    role: 'SUPPORT',
    championId: 200,
    confidence: 1,
    influence: 1,
    term: 0,
    lowData: false,
    n: 25000,
    deltaPp,
  };
}

const BLIND_WORST_CASE_FACTOR = DEFAULT_RECOMMEND_CONFIG.blindWorstCaseFactor;

const P0 = 0.6;

function termFor(idx: ReturnType<typeof indexPairs>, key: string): number {
  const row = idx.get(key);
  if (!row) throw new Error(`missing row ${key}`);
  return scorePair(row.winsE, row.gamesE, P0, DEFAULT_CONFIG).term;
}

describe('computeBlindSafety', () => {
  const roleProb = {
    '200': { SUPPORT: 1.0 },
    '201': { ADC: 1.0 },
    '202': { ADC: 1.0 },
  } as ChampionRoleProbabilities;
  const table: EnemyPairTable = [
    [1, 200, 'SUPPORT', 'DIAMOND', 10, 50, 0.1],
    [1, 201, 'ADC', 'DIAMOND', 10, 50, 0.1],
  ];
  const idx = indexPairs(table, 'DIAMOND');
  const ids = [1, 200, 201, 202];

  it('equals share-weighted mean (missing matchup neutral) plus worst-case penalty', () => {
    const t = termFor(idx, makePairKey(1, 201, 'ADC'));
    expect(t).toBeLessThan(0);
    const expected = (t + 0) / 2 + BLIND_WORST_CASE_FACTOR * t;
    const actual = computeBlindSafety(
      1,
      ['ADC'],
      new Set(),
      ids,
      roleProb,
      idx,
      P0,
      DEFAULT_CONFIG,
    );
    expect(actual).toBeCloseTo(expected, 12);
  });

  it('sums per-role contributions over several unseen roles', () => {
    const tSup = termFor(idx, makePairKey(1, 200, 'SUPPORT'));
    const tAdc = termFor(idx, makePairKey(1, 201, 'ADC'));
    const expected =
      tSup * (1 + BLIND_WORST_CASE_FACTOR) + (tAdc / 2 + BLIND_WORST_CASE_FACTOR * tAdc);
    const actual = computeBlindSafety(
      1,
      ['SUPPORT', 'ADC'],
      new Set(),
      ids,
      roleProb,
      idx,
      P0,
      DEFAULT_CONFIG,
    );
    expect(actual).toBeCloseTo(expected, 12);
  });

  it('excludes board-picked champions from the distribution', () => {
    const actual = computeBlindSafety(
      1,
      ['ADC'],
      new Set([201]),
      ids,
      roleProb,
      idx,
      P0,
      DEFAULT_CONFIG,
    );
    expect(actual).toBe(0);
  });

  it('ignores opponents below the role-probability threshold', () => {
    const lowShare = { '201': { ADC: 0.04, MID: 0.96 } } as ChampionRoleProbabilities;
    expect(
      computeBlindSafety(1, ['ADC'], new Set(), [1, 201], lowShare, idx, P0, DEFAULT_CONFIG),
    ).toBe(0);
  });

  it('adds no worst-case bonus when every matchup is favorable', () => {
    const goodIdx = indexPairs([[1, 201, 'ADC', 'DIAMOND', 45, 50, 0.1]], 'DIAMOND');
    const t = termFor(goodIdx, makePairKey(1, 201, 'ADC'));
    expect(t).toBeGreaterThan(0);
    const actual = computeBlindSafety(
      1,
      ['ADC'],
      new Set([202]),
      ids,
      roleProb,
      goodIdx,
      P0,
      DEFAULT_CONFIG,
    );
    expect(actual).toBeCloseTo(t, 12);
  });

  it('counts a duplicated championId only once', () => {
    const once = computeBlindSafety(1, ['ADC'], new Set(), ids, roleProb, idx, P0, DEFAULT_CONFIG);
    const dup = computeBlindSafety(
      1,
      ['ADC'],
      new Set(),
      [...ids, 201, 201],
      roleProb,
      idx,
      P0,
      DEFAULT_CONFIG,
    );
    expect(dup).toBe(once);
  });

  it('matches the precomputed path used by recommend (blindOpponents + FromOpponents)', () => {
    const roles = ['SUPPORT', 'ADC'] as const;
    const opponents = blindOpponents(roles, new Set(), ids, roleProb);
    expect(blindSafetyFromOpponents(1, opponents, idx, P0, DEFAULT_CONFIG)).toBe(
      computeBlindSafety(1, roles, new Set(), ids, roleProb, idx, P0, DEFAULT_CONFIG),
    );
  });

  it('never counts the candidate as its own opponent', () => {
    const selfIdx = indexPairs([[201, 201, 'ADC', 'DIAMOND', 0, 50, 0.1]], 'DIAMOND');
    const opponents = blindOpponents(['ADC'], new Set(), [201], roleProb);
    expect(blindSafetyFromOpponents(201, opponents, selfIdx, P0, DEFAULT_CONFIG)).toBe(0);
  });

  it('returns 0 when no champion can play the unseen role', () => {
    expect(computeBlindSafety(1, ['TOP'], new Set(), ids, roleProb, idx, P0, DEFAULT_CONFIG)).toBe(
      0,
    );
  });
});

describe('blind opponent pick share (B-026)', () => {
  // roleProb marks 201 as the only ADC (1.0) and 202 as a 0.04 flex — below
  // blindOpponentMinShare. The exported pick rates rank 202 first instead.
  const roleProb = {
    '201': { ADC: 1.0 },
    '202': { ADC: 0.04, TOP: 0.96 },
  } as ChampionRoleProbabilities;
  const pickRate: PickRate = { ADC: { '201': 0.2, '202': 0.8 } };

  it('weights unseen opponents by pickRate when the export is loaded', () => {
    const opponents = blindOpponents(['ADC'], new Set(), [201, 202], roleProb, undefined, pickRate);
    expect(opponents.get('ADC')).toEqual([
      { championId: 201, share: 0.2 },
      { championId: 202, share: 0.8 },
    ]);
  });

  it('falls back to roleProb shares when no pickRate export is loaded', () => {
    const opponents = blindOpponents(['ADC'], new Set(), [201, 202], roleProb);
    expect(opponents.get('ADC')).toEqual([{ championId: 201, share: 1 }]);
  });

  it('changes blindSafety when pick rates disagree with roleProb', () => {
    // A terrible matchup into the real popular pick (202) must count even
    // though the roleProb approximation would have filtered it out.
    const idx = indexPairs([[1, 202, 'ADC', 'DIAMOND', 0, 50, 0.1]], 'DIAMOND');
    const fallback = computeBlindSafety(
      1,
      ['ADC'],
      new Set(),
      [201, 202],
      roleProb,
      idx,
      P0,
      DEFAULT_CONFIG,
    );
    const withPickRate = computeBlindSafety(
      1,
      ['ADC'],
      new Set(),
      [201, 202],
      roleProb,
      idx,
      P0,
      DEFAULT_CONFIG,
      undefined,
      undefined,
      pickRate,
    );
    expect(fallback).toBe(0);
    expect(withPickRate).toBeLessThan(0);
  });
});

function known(championId: number, role: KnownSlot['role'], side: KnownSlot['side']): KnownSlot {
  return { championId, role, side, confidence: 1, fixed: true };
}

describe('scorePairs', () => {
  const enemyIdx = indexPairs(
    [
      [1, 200, 'SUPPORT', 'DIAMOND', 10, 50, 0.1],
      [1, 201, 'ADC', 'DIAMOND', 10, 50, 0.1],
    ],
    'DIAMOND',
  );
  const allyIdx = indexPairs([[1, 10, 'ADC', 'DIAMOND', 40, 50, 0.1]], 'DIAMOND');

  it('orders by descending influence, then championId, and skips missing rows', () => {
    const slots = [
      known(201, 'ADC', 'enemy'),
      known(200, 'SUPPORT', 'enemy'),
      known(10, 'ADC', 'ally'),
      known(999, 'MID', 'enemy'),
    ];
    const { deltas } = scorePairs(1, 'SUPPORT', slots, allyIdx, enemyIdx, P0, DEFAULT_CONFIG);
    const influence = (s: KnownSlot): number =>
      getInfluence('SUPPORT', s.side, s.role, 'draft', DEFAULT_CONFIG);
    const expected = slots
      .slice(0, 3)
      .sort((a, b) => influence(b) - influence(a) || a.championId - b.championId)
      .map((s) => s.championId);
    expect(deltas.map((d) => d.championId)).toEqual(expected);
  });

  it('sums confidence * influence * term', () => {
    const slot = { ...known(200, 'SUPPORT', 'enemy'), confidence: 0.5 };
    const { sum } = scorePairs(1, 'SUPPORT', [slot], allyIdx, enemyIdx, P0, DEFAULT_CONFIG);
    const inf = getInfluence('SUPPORT', 'enemy', 'SUPPORT', 'draft', DEFAULT_CONFIG);
    expect(sum).toBeCloseTo(0.5 * inf * termFor(enemyIdx, makePairKey(1, 200, 'SUPPORT')), 12);
  });
});

describe('hardCounterWarnings', () => {
  const enemyIdx = indexPairs(
    [
      [1, 200, 'SUPPORT', 'DIAMOND', 10, 50, 0.1],
      [1, 201, 'ADC', 'DIAMOND', 0, 10, 10],
    ],
    'DIAMOND',
  );
  const allyIdx = indexPairs([[1, 10, 'ADC', 'DIAMOND', 50, 50, 0.1]], 'DIAMOND');

  it('warns for a strong counter and stays silent for lowData or missing rows', () => {
    const enemies = [
      known(200, 'SUPPORT', 'enemy'),
      known(201, 'ADC', 'enemy'),
      known(202, 'MID', 'enemy'),
    ];
    const { deltas } = scorePairs(1, 'SUPPORT', enemies, allyIdx, enemyIdx, P0, DEFAULT_CONFIG);
    expect(hardCounterWarnings(deltas)).toEqual(['counteredBy:SUPPORT:200']);
  });

  it('uses the same deltaPp as the counter reason (running log-odds)', () => {
    const slots = [known(10, 'ADC', 'ally'), known(200, 'SUPPORT', 'enemy')];
    const { deltas } = scorePairs(1, 'SUPPORT', slots, allyIdx, enemyIdx, P0, DEFAULT_CONFIG);
    const counter = deltas.find((d) => d.side === 'enemy');
    if (!counter) throw new Error('missing counter delta');
    // Threshold at / one step below the reported (rounded) delta flips the warning.
    const shown = roundDeltaPp(counter.deltaPp);
    expect(hardCounterWarnings(deltas, shown)).toHaveLength(1);
    expect(hardCounterWarnings(deltas, shown - 0.01)).toHaveLength(0);
  });

  it('compares the rounded delta, so warning and displayed reason agree', () => {
    const d = { ...deltaAt(-4.497) };
    // Displayed as -4.5 -> warns at the -4.5 threshold.
    expect(hardCounterWarnings([d], -4.5)).toEqual(['counteredBy:SUPPORT:200']);
    // Displayed as -4.49 -> no warning.
    expect(hardCounterWarnings([deltaAt(-4.494)], -4.5)).toEqual([]);
  });

  it('never warns for ally pairs', () => {
    const { deltas } = scorePairs(
      1,
      'SUPPORT',
      [known(10, 'ADC', 'ally')],
      allyIdx,
      enemyIdx,
      P0,
      DEFAULT_CONFIG,
    );
    expect(hardCounterWarnings(deltas, 100)).toEqual([]);
  });
});
