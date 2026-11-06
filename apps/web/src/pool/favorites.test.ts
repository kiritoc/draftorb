import { describe, expect, it } from 'vitest';

import { championPoolSchema, type ChampionPool } from '@draftorb/shared';

import { poolMaxSize } from '../config.js';
import { applyFavoritesMode, FAVORITES_MODES, importFavoritesIntoPool } from './favorites';

function poolWithSupport(ids: number[]): ChampionPool {
  return { version: 1, pools: { SUPPORT: ids } };
}

describe('importFavoritesIntoPool', () => {
  it('creates a SUPPORT pool from null', () => {
    const result = importFavoritesIntoPool(null, [23, 42]);
    expect(result.pool.pools.SUPPORT).toEqual([23, 42]);
    expect(result.added).toEqual([23, 42]);
    expect(result.skipped).toBe(0);
    expect(championPoolSchema.parse(result.pool)).toEqual(result.pool);
  });

  it('appends only missing favorites and preserves other roles', () => {
    const pool: ChampionPool = {
      version: 1,
      pools: { SUPPORT: [23, 99], MID: [7] },
    };
    const result = importFavoritesIntoPool(pool, [23, 42, 99, 7]);
    expect(result.pool.pools.SUPPORT).toEqual([23, 99, 42, 7]);
    expect(result.pool.pools.MID).toEqual([7]);
    expect(result.added).toEqual([42, 7]);
    expect(result.skipped).toBe(0);
  });

  it('respects poolMaxSize and reports skipped favorites', () => {
    const existing = Array.from({ length: poolMaxSize - 1 }, (_, i) => 1000 + i);
    const result = importFavoritesIntoPool(poolWithSupport(existing), [1, 2, 3]);
    expect(result.pool.pools.SUPPORT).toHaveLength(poolMaxSize);
    expect(result.added).toEqual([1]);
    expect(result.skipped).toBe(2);
  });

  it('does not duplicate ids already in the pool', () => {
    const result = importFavoritesIntoPool(poolWithSupport([5, 6]), [5, 6, 5]);
    expect(result.pool.pools.SUPPORT).toEqual([5, 6]);
    expect(result.added).toEqual([]);
    expect(result.skipped).toBe(0);
  });
});

describe('applyFavoritesMode', () => {
  const entries = [{ championId: 1 }, { championId: 2 }, { championId: 3 }];
  const favorites = new Set([2]);

  it('include returns every entry in order', () => {
    expect(applyFavoritesMode(entries, 'include', favorites)).toEqual(entries);
    expect(applyFavoritesMode(entries, 'include', favorites)).not.toBe(entries);
  });

  it('only keeps favorites', () => {
    expect(applyFavoritesMode(entries, 'only', favorites)).toEqual([{ championId: 2 }]);
  });

  it('hide removes favorites', () => {
    expect(applyFavoritesMode(entries, 'hide', favorites)).toEqual([
      { championId: 1 },
      { championId: 3 },
    ]);
  });

  it('only with an empty favorite set shows nothing; hide shows everything', () => {
    const empty = new Set<number>();
    expect(applyFavoritesMode(entries, 'only', empty)).toEqual([]);
    expect(applyFavoritesMode(entries, 'hide', empty)).toEqual(entries);
    expect(applyFavoritesMode(entries, 'include', empty)).toEqual(entries);
  });

  it('never mutates the input array', () => {
    const input = Object.freeze([...entries]);
    applyFavoritesMode(input, 'hide', favorites);
    applyFavoritesMode(input, 'only', favorites);
    expect(input).toEqual(entries);
  });
});

describe('favorites mode coverage', () => {
  it('exposes exactly the three spec modes', () => {
    expect(FAVORITES_MODES).toEqual(['include', 'only', 'hide']);
  });
});
