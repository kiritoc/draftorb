import { describe, expect, it } from 'vitest';
import { poolConfigSchema, type PoolConfig, type Role } from '@draftorb/shared';
import {
  championPoolRoles,
  dropUnknownChampions,
  emptyPool,
  parsePoolConfig,
  poolDiffers,
  serializePoolConfig,
  setChampionRoles,
} from './pool-model';

const ids = (pool: PoolConfig, role: Role): number[] =>
  (pool.pools[role] ?? []).map((e) => e.championId);

describe('setChampionRoles', () => {
  it('adds a champion to the given roles at the end, with its name', () => {
    const a = setChampionRoles(emptyPool(), 1, ['SUPPORT', 'MID'], 'Annie').pool;
    const b = setChampionRoles(a, 2, ['SUPPORT']).pool;
    expect(ids(b, 'SUPPORT')).toEqual([1, 2]);
    expect(ids(b, 'MID')).toEqual([1]);
    expect(b.pools.SUPPORT?.[0]).toEqual({ championId: 1, name: 'Annie' });
  });

  it('keeps existing entries in place and removes unlisted roles', () => {
    let pool = setChampionRoles(emptyPool(), 1, ['SUPPORT', 'MID']).pool;
    pool = setChampionRoles(pool, 2, ['SUPPORT']).pool;
    pool = setChampionRoles(pool, 1, ['SUPPORT']).pool;
    expect(ids(pool, 'SUPPORT')).toEqual([1, 2]);
    expect(ids(pool, 'MID')).toEqual([]);
  });

  it('empty roles removes the champion everywhere', () => {
    const pool = setChampionRoles(
      setChampionRoles(emptyPool(), 1, ['TOP', 'MID']).pool,
      1,
      [],
    ).pool;
    expect(ids(pool, 'TOP')).toEqual([]);
    expect(ids(pool, 'MID')).toEqual([]);
  });

  it('rejects an add to a full role and leaves that role unchanged', () => {
    let pool = emptyPool();
    for (let i = 1; i <= 40; i++) pool = setChampionRoles(pool, i, ['TOP']).pool;
    const result = setChampionRoles(pool, 99, ['TOP', 'MID']);
    expect(result.rejectedRoles).toEqual(['TOP']);
    expect(ids(result.pool, 'TOP')).toHaveLength(40);
    expect(ids(result.pool, 'MID')).toEqual([99]);
  });

  it('is idempotent and does not mutate its input', () => {
    const start = setChampionRoles(emptyPool(), 1, ['TOP']).pool;
    const snapshot = JSON.stringify(start);
    const once = setChampionRoles(start, 2, ['TOP', 'JUNGLE']).pool;
    const twice = setChampionRoles(once, 2, ['TOP', 'JUNGLE']).pool;
    expect(twice).toEqual(once);
    expect(JSON.stringify(start)).toBe(snapshot);
  });
});

describe('championPoolRoles', () => {
  it('returns the roles a champion currently occupies, in role order', () => {
    const pool = setChampionRoles(setChampionRoles(emptyPool(), 7, ['MID', 'TOP']).pool, 8, [
      'SUPPORT',
    ]).pool;
    expect(championPoolRoles(pool, 7)).toEqual(['TOP', 'MID']);
    expect(championPoolRoles(pool, 8)).toEqual(['SUPPORT']);
    expect(championPoolRoles(pool, 9)).toEqual([]);
  });
});

describe('poolDiffers', () => {
  it('ignores order, names and empty roles', () => {
    const a = setChampionRoles(setChampionRoles(emptyPool(), 1, ['TOP'], 'A').pool, 2, [
      'TOP',
    ]).pool;
    const b = setChampionRoles(
      setChampionRoles(emptyPool(), 2, ['TOP']).pool,
      1,
      ['TOP'],
      'Z',
    ).pool;
    expect(poolDiffers(a, b)).toBe(false);
    expect(poolDiffers(emptyPool(), { schemaVersion: 1, pools: { MID: [] } })).toBe(false);
  });

  it('detects a different champion set in any role', () => {
    const a = setChampionRoles(emptyPool(), 1, ['TOP']).pool;
    expect(poolDiffers(a, emptyPool())).toBe(true);
    expect(poolDiffers(a, setChampionRoles(emptyPool(), 1, ['MID']).pool)).toBe(true);
  });
});

describe('serializePoolConfig / parsePoolConfig', () => {
  it('serializes in role order, omitting empty roles, with a trailing newline', () => {
    const pool: PoolConfig = {
      schemaVersion: 1,
      pools: { MID: [{ championId: 3 }], SUPPORT: [{ championId: 2, name: 'B' }], TOP: [] },
    };
    const text = serializePoolConfig(pool);
    expect(text.endsWith('\n')).toBe(true);
    expect(Object.keys(JSON.parse(text).pools)).toEqual(['MID', 'SUPPORT']);
    expect(text).toContain('\n  "schemaVersion": 1,');
  });

  it('is independent of role key insertion order and schema-valid', () => {
    const a: PoolConfig = {
      schemaVersion: 1,
      pools: { SUPPORT: [{ championId: 2 }], TOP: [{ championId: 1 }] },
    };
    const b: PoolConfig = {
      schemaVersion: 1,
      pools: { TOP: [{ championId: 1 }], SUPPORT: [{ championId: 2 }] },
    };
    expect(serializePoolConfig(a)).toBe(serializePoolConfig(b));
    expect(poolConfigSchema.safeParse(JSON.parse(serializePoolConfig(a))).success).toBe(true);
  });

  it('round-trips', () => {
    const pool = setChampionRoles(
      setChampionRoles(emptyPool(), 5, ['TOP', 'JUNGLE'], 'Five').pool,
      6,
      ['TOP'],
    ).pool;
    expect(parsePoolConfig(serializePoolConfig(pool))).toEqual({ pool });
  });

  it('treats a missing file (null) as empty without a notice', () => {
    expect(parsePoolConfig(null)).toEqual({ pool: emptyPool() });
  });

  it.each([
    '',
    '{',
    '[]',
    '{"schemaVersion":2,"pools":{}}',
    '{"schemaVersion":1,"pools":{"TOP":[{"championId":1},{"championId":1}]}}',
  ])('resets %j to an empty pool with a notice', (raw) => {
    const parsed = parsePoolConfig(raw);
    expect(parsed.pool).toEqual(emptyPool());
    expect(parsed.notice).toBeTruthy();
  });
});

describe('dropUnknownChampions', () => {
  it('drops ids missing from the catalogue and reports each once', () => {
    let pool = setChampionRoles(emptyPool(), 1, ['TOP', 'MID']).pool;
    pool = setChampionRoles(pool, 999, ['TOP', 'MID']).pool;
    const result = dropUnknownChampions(pool, new Set([1]));
    expect(ids(result.pool, 'TOP')).toEqual([1]);
    expect(ids(result.pool, 'MID')).toEqual([1]);
    expect(result.dropped).toEqual([999]);
  });

  it('returns the pool untouched when everything is known', () => {
    const pool = setChampionRoles(emptyPool(), 1, ['TOP']).pool;
    expect(dropUnknownChampions(pool, new Set([1]))).toEqual({ pool, dropped: [] });
  });
});
