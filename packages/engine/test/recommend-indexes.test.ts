/**
 * Unit tests for index builders and lookup keys (T-023).
 */

import { describe, it, expect } from 'vitest';
import type { BaselineTable, EnemyPairTable, LaneFullTable, LaneVsTable } from '@draftorb/shared';
import { MISSING_LANE_ID } from '../src/config.js';
import {
  indexBaselines,
  indexLaneFull,
  indexLaneVs,
  indexPairs,
  makeLaneFullKey,
  makeLaneVsKey,
  makePairKey,
} from '../src/recommend-indexes.js';

describe('lookup keys', () => {
  it('encodes every component in order', () => {
    expect(makePairKey(1, 2, 'ADC')).toBe('1:2:ADC');
    expect(makeLaneVsKey(1, 2, 3)).toBe('1:2:3');
    expect(makeLaneFullKey(1, 2, 3, 4)).toBe('1:2:3:4');
  });
});

describe('indexBaselines', () => {
  const table: BaselineTable = [
    [1, 'DIAMOND', 30, 50, 0.1, 50],
    [2, 'MASTER_PLUS', 30, 50, 0.1, 50],
    [3, 'DIAMOND', 5, 10, 10],
  ];

  it('keeps only the requested bucket', () => {
    const idx = indexBaselines(table, 'DIAMOND');
    expect([...idx.keys()].sort((a, b) => a - b)).toEqual([1, 3]);
  });

  it('converts weighted counts to equivalent counts and keeps rawGames', () => {
    const row = indexBaselines(table, 'DIAMOND').get(1);
    expect(row?.nE).toBeCloseTo(25000, 6);
    expect(row?.gamesE).toBeCloseTo(25000, 6);
    expect(row?.winsE).toBeCloseTo((30 * 25000) / 50, 6);
    expect(row?.rawGames).toBe(50);
  });

  it('leaves rawGames undefined when the column is absent', () => {
    expect(indexBaselines(table, 'DIAMOND').get(3)?.rawGames).toBeUndefined();
  });
});

describe('indexPairs', () => {
  it('keys rows by candidate, other champion and role, filtered by bucket', () => {
    const table: EnemyPairTable = [
      [1, 200, 'SUPPORT', 'DIAMOND', 10, 50, 0.1],
      [1, 200, 'ADC', 'DIAMOND', 20, 50, 0.1],
      [1, 200, 'MID', 'MASTER_PLUS', 20, 50, 0.1],
    ];
    const idx = indexPairs(table, 'DIAMOND');
    expect(idx.size).toBe(2);
    expect(idx.get(makePairKey(1, 200, 'SUPPORT'))?.winsW).toBe(10);
    expect(idx.get(makePairKey(1, 200, 'ADC'))?.winsW).toBe(20);
    expect(idx.has(makePairKey(1, 200, 'MID'))).toBe(false);
  });
});

describe('lane indexes', () => {
  it('maps a null opp2 to MISSING_LANE_ID in lane_vs keys', () => {
    const table: LaneVsTable = [[1, 300, null, 'DIAMOND', 30, 50, 0.1]];
    const idx = indexLaneVs(table, 'DIAMOND');
    expect(idx.has(makeLaneVsKey(1, 300, MISSING_LANE_ID))).toBe(true);
  });

  it('maps null partner and opp2 to MISSING_LANE_ID in lane_full keys', () => {
    const table: LaneFullTable = [
      [1, null, 300, null, 'DIAMOND', 30, 50, 0.1],
      [1, 10, 200, 201, 'DIAMOND', 30, 50, 0.1],
      [1, 10, 200, 201, 'GOLD', 30, 50, 0.1],
    ];
    const idx = indexLaneFull(table, 'DIAMOND');
    expect(idx.size).toBe(2);
    expect(idx.has(makeLaneFullKey(1, MISSING_LANE_ID, 300, MISSING_LANE_ID))).toBe(true);
    expect(idx.has(makeLaneFullKey(1, 10, 200, 201))).toBe(true);
  });
});
