import { describe, expect, it } from 'vitest';
import {
  POOL_CONFIG_MAX_PER_ROLE,
  POOL_CONFIG_SCHEMA_VERSION,
  poolConfigSchema,
} from '../src/index.js';

const entry = (championId: number) => ({ championId, name: `C${championId}` });

describe('poolConfigSchema (SPECS §19.3)', () => {
  it('exposes the version and the per-role cap', () => {
    expect(POOL_CONFIG_SCHEMA_VERSION).toBe(1);
    expect(POOL_CONFIG_MAX_PER_ROLE).toBe(40);
  });

  it('accepts the SPECS example', () => {
    const example = {
      schemaVersion: 1,
      pools: {
        SUPPORT: [{ championId: 267, name: 'Nami' }],
        TOP: [{ championId: 98, name: 'Shen' }],
      },
    };
    expect(poolConfigSchema.parse(example)).toEqual(example);
  });

  it('accepts an empty pools record and a missing name', () => {
    expect(poolConfigSchema.safeParse({ schemaVersion: 1, pools: {} }).success).toBe(true);
    expect(
      poolConfigSchema.safeParse({ schemaVersion: 1, pools: { MID: [{ championId: 1 }] } }).success,
    ).toBe(true);
  });

  it('rejects an empty name', () => {
    const r = poolConfigSchema.safeParse({
      schemaVersion: 1,
      pools: { MID: [{ championId: 1, name: '' }] },
    });
    expect(r.success).toBe(false);
  });

  it('rejects a duplicate champion id within a role', () => {
    const r = poolConfigSchema.safeParse({
      schemaVersion: 1,
      pools: { SUPPORT: [entry(1), entry(1)] },
    });
    expect(r.success).toBe(false);
  });

  it('accepts exactly 40 entries and rejects 41', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => entry(i + 1));
    expect(poolConfigSchema.safeParse({ schemaVersion: 1, pools: { TOP: many(40) } }).success).toBe(
      true,
    );
    expect(poolConfigSchema.safeParse({ schemaVersion: 1, pools: { TOP: many(41) } }).success).toBe(
      false,
    );
  });

  it('accepts the same champion under two roles', () => {
    expect(
      poolConfigSchema.safeParse({
        schemaVersion: 1,
        pools: { TOP: [entry(1)], MID: [entry(1)] },
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown role key, an extra key and a wrong version', () => {
    expect(poolConfigSchema.safeParse({ schemaVersion: 1, pools: { BOT: [] } }).success).toBe(
      false,
    );
    expect(poolConfigSchema.safeParse({ schemaVersion: 1, pools: {}, extra: 1 }).success).toBe(
      false,
    );
    expect(poolConfigSchema.safeParse({ schemaVersion: 2, pools: {} }).success).toBe(false);
    expect(
      poolConfigSchema.safeParse({
        schemaVersion: 1,
        pools: { TOP: [{ championId: 1, extra: true }] },
      }).success,
    ).toBe(false);
  });
});
