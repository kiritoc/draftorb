import { describe, expect, it } from 'vitest';

import { type Recommendation } from '@draftorb/shared';
import { excludePick, excludedRanks } from './exclude-pick.js';

function rec(championId: number, rank: number, poolRank?: number): Recommendation {
  const base = {
    championId,
    rank,
    score: 0.5,
    reasons: [],
    reliability: { nEff: 100, lowData: false },
    warnings: [],
  } as unknown as Recommendation;
  return poolRank === undefined ? base : { ...base, poolRank };
}

describe('excludePick', () => {
  const overall = [rec(1, 1), rec(2, 2), rec(3, 3)];
  const pool = [rec(1, 1, 1), rec(3, 3, 2)];

  it('returns the list unchanged when no champion is picked', () => {
    expect(excludePick(overall, null, {})).toEqual(overall);
  });

  it('renumbers overall and pool ranks when the pick is ranked first in both', () => {
    const removed = excludedRanks(1, overall, pool);
    expect(excludePick(overall, 1, removed).map((r) => r.rank)).toEqual([1, 2]);
    const poolOut = excludePick(pool, 1, removed);
    expect(poolOut.map((r) => [r.championId, r.rank, r.poolRank])).toEqual([[3, 2, 1]]);
  });

  it('keeps pool ranks when the pick is not in the pool', () => {
    const removed = excludedRanks(2, overall, pool);
    expect(excludePick(pool, 2, removed).map((r) => [r.rank, r.poolRank])).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });

  it('does not mutate its input', () => {
    const removed = excludedRanks(1, overall, pool);
    excludePick(overall, 1, removed);
    expect(overall.map((r) => r.rank)).toEqual([1, 2, 3]);
  });
});
