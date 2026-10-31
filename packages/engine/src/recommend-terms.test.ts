/**
 * Unit tests for blind safety numeric output (T-023, SPECS §5).
 */

import { describe, it, expect } from 'vitest';
import type { ChampionRoleProbabilities, EnemyPairTable } from '@draftorb/shared';
import { BLIND_WORST_CASE_FACTOR, DEFAULT_CONFIG } from './config.js';
import { indexPairs, makePairKey } from './recommend-indexes.js';
import { scorePair } from './levels.js';
import { computeBlindSafety } from './recommend-terms.js';

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

  it('returns 0 when no champion can play the unseen role', () => {
    expect(computeBlindSafety(1, ['TOP'], new Set(), ids, roleProb, idx, P0, DEFAULT_CONFIG)).toBe(
      0,
    );
  });
});
