import { describe, expect, it } from 'vitest';

import { championPoolSchema, type ChampionPool } from '@draftorb/shared';
import {
  type PoolStorage,
  clearPool,
  filterPoolByCatalogue,
  loadPool,
  readPool,
  savePool,
} from './storage';

function fakeStorage(): PoolStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

describe('pool storage', () => {
  it('loads and round-trips a valid pool', () => {
    const storage = fakeStorage();
    const pool: ChampionPool = { version: 1, pools: { SUPPORT: [412, 1] } };
    savePool(pool, storage);
    expect(loadPool(storage)).toEqual(pool);
  });

  it('returns null for an absent pool', () => {
    expect(loadPool(fakeStorage())).toBeNull();
    expect(readPool(fakeStorage()).issue).toBeNull();
  });

  it('returns null for a corrupt pool instead of throwing', () => {
    const storage = fakeStorage();
    storage.setItem('draftorb.pool.v1', 'not json');
    expect(loadPool(storage)).toBeNull();
    expect(readPool(storage).issue).toBe('corrupt');
  });

  it('returns null for a schema-invalid pool', () => {
    const storage = fakeStorage();
    storage.setItem('draftorb.pool.v1', JSON.stringify({ version: 2, pools: {} }));
    expect(loadPool(storage)).toBeNull();
  });

  it('treats a pool larger than the configured maximum as corrupt', () => {
    const storage = fakeStorage();
    storage.setItem(
      'draftorb.pool.v1',
      JSON.stringify({
        version: 1,
        pools: { SUPPORT: Array.from({ length: 41 }, (_, i) => i + 1) },
      }),
    );
    expect(readPool(storage).issue).toBe('corrupt');
    expect(loadPool(storage)).toBeNull();
  });

  it('an invalid import leaves the stored pool untouched', () => {
    const storage = fakeStorage();
    const existing: ChampionPool = { version: 1, pools: { SUPPORT: [412] } };
    savePool(existing, storage);
    let imported: unknown;
    try {
      imported = championPoolSchema.parse(JSON.parse('{ bad'));
    } catch {
      imported = undefined;
    }
    expect(imported).toBeUndefined();
    expect(loadPool(storage)).toEqual(existing);
  });

  it('savePool ignores storage errors (blocked/quota)', () => {
    const storage: PoolStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
      removeItem: () => undefined,
    };
    expect(savePool({ version: 1, pools: {} }, storage)).toBe(false);
  });

  it('clearPool removes the persisted pool', () => {
    const storage = fakeStorage();
    savePool({ version: 1, pools: { SUPPORT: [412] } }, storage);
    expect(clearPool(storage)).toBe(true);
    expect(loadPool(storage)).toBeNull();
  });

  it('reports blocked storage access', () => {
    const storage: PoolStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readPool(storage).issue).toBe('unavailable');
    expect(savePool({ version: 1, pools: {} }, storage)).toBe(false);
    expect(clearPool(storage)).toBe(false);
  });

  it('filterPoolByCatalogue drops ids absent from the catalogue', () => {
    const { pool, dropped } = filterPoolByCatalogue(
      { version: 1, pools: { SUPPORT: [412, 999], MID: [1] } },
      [412, 1],
    );
    expect(pool.pools.SUPPORT).toEqual([412]);
    expect(pool.pools.MID).toEqual([1]);
    expect(pool.pools.TOP).toBeUndefined();
    expect(dropped).toEqual([999]);
  });
});
