import { describe, it, expect } from 'vitest';
import { recommendDataSchema } from './recommend-data.js';
import { baselineEntrySchema } from './tables.js';

const valid = {
  baselines: [[1, 'DIAMOND', 30, 50, 0.1, 50]],
  allyPairs: [],
  enemyPairs: [],
  laneVs: [],
  laneFull: [],
  roleProb: { '1': { SUPPORT: 1 } },
  tags: {},
  championIds: [1],
};

describe('recommendDataSchema', () => {
  it('accepts a minimal valid data object', () => {
    expect(recommendDataSchema.safeParse(valid).success).toBe(true);
  });

  it('is strict: rejects unknown keys', () => {
    expect(recommendDataSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
  });

  it('rejects a missing table and an invalid champion id', () => {
    const missing: Record<string, unknown> = { ...valid };
    delete missing.laneFull;
    expect(recommendDataSchema.safeParse(missing).success).toBe(false);
    expect(recommendDataSchema.safeParse({ ...valid, championIds: [0] }).success).toBe(false);
  });
});

describe('baselineEntrySchema games column (B-025)', () => {
  it('accepts the 5-column form (games optional)', () => {
    expect(baselineEntrySchema.safeParse([1, 'DIAMOND', 30, 50, 0.1]).success).toBe(true);
  });

  it('rejects negative or non-integer games', () => {
    expect(baselineEntrySchema.safeParse([1, 'DIAMOND', 30, 50, 0.1, -1]).success).toBe(false);
    expect(baselineEntrySchema.safeParse([1, 'DIAMOND', 30, 50, 0.1, 1.5]).success).toBe(false);
  });
});
