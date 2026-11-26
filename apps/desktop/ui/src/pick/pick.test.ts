/**
 * Pick-screen helpers (BL-009): pagination, picked-champion exclusion with
 * rank-gap correction, slot champion availability and pool-unavailable
 * cards.
 */

import { describe, expect, it } from 'vitest';

import type { Champion, Recommendation } from '@draftorb/shared';

import { paginate } from './pagination';
import { excludePick, excludedRanks } from './exclude-pick';
import { championsForSlot } from './champion-availability';
import { buildPoolUnavailableItems } from './pool-unavailable';

const champ = (id: number, name = `C${id}`): Champion => ({
  id,
  name,
  icon: `${name}.png`,
  roles: ['SUPPORT'],
});

const rec = (championId: number, rank: number, poolRank?: number): Recommendation => ({
  championId,
  score: 0.5,
  rank,
  ...(poolRank !== undefined ? { poolRank } : {}),
  reasons: [],
  reliability: { nEff: 100, lowData: false },
  warnings: [],
});

describe('paginate', () => {
  it('splits into fixed-size pages', () => {
    expect(paginate([1, 2, 3, 4, 5, 6, 7], 5)).toEqual([
      [1, 2, 3, 4, 5],
      [6, 7],
    ]);
  });

  it('rejects a non-positive page size', () => {
    expect(() => paginate([1], 0)).toThrow();
  });
});

describe('excludePick / excludedRanks', () => {
  const overall = [rec(1, 1), rec(2, 2), rec(3, 3), rec(4, 4)];
  const pool = [rec(10, 2, 1), rec(3, 3, 2)];

  it('removes the user pick and closes the global rank gap', () => {
    const removed = excludedRanks(2, overall, pool);
    expect(removed).toEqual({ rank: 2, poolRank: undefined });
    const filtered = excludePick(overall, 2, removed);
    expect(filtered.map((r) => r.championId)).toEqual([1, 3, 4]);
    expect(filtered.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('corrects global and pool ranks when the pick is in the pool list', () => {
    const removed = excludedRanks(10, overall, pool);
    expect(removed).toEqual({ rank: 2, poolRank: 1 });
    const filtered = excludePick(pool, 10, removed);
    expect(filtered.map((r) => r.championId)).toEqual([3]);
    expect(filtered[0]?.rank).toBe(2);
    expect(filtered[0]?.poolRank).toBe(1);
  });

  it('keeps ranks untouched when nothing is excluded', () => {
    const removed = excludedRanks(null, overall, pool);
    expect(excludePick(overall, null, removed).map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });
});

describe('championsForSlot', () => {
  const all = [champ(1), champ(2), champ(3)];

  it('filters out champions used in other slots but keeps the slot own pick', () => {
    const result = championsForSlot(all, new Set([1, 2]), 1);
    expect(result.map((c) => c.id)).toEqual([1, 3]);
  });

  it('excludes used champions when the slot is empty', () => {
    expect(championsForSlot(all, new Set([1]), null).map((c) => c.id)).toEqual([2, 3]);
  });
});

describe('buildPoolUnavailableItems', () => {
  it('maps poolUnavailable entries and attaches insufficient-data samples', () => {
    const items = buildPoolUnavailableItems(
      [
        { championId: 99, reason: 'insufficientData' },
        { championId: 100, reason: 'banned' },
      ],
      [{ championId: 99, nEff: 12.4 }],
      100,
    );
    expect(items).toEqual([
      { championId: 99, reason: 'insufficientData', sample: { championId: 99, nEff: 12.4 } },
    ]);
  });
});
