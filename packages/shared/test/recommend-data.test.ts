import { describe, it, expect } from 'vitest';
import { recommendDataSchema } from '../src/schemas/recommend-data.js';
import { baselineEntrySchema } from '../src/schemas/tables.js';

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

  it('accepts an optional pickRate and rejects malformed shares (B-026)', () => {
    expect(recommendDataSchema.safeParse({ ...valid, pickRate: { ADC: { '2': 1 } } }).success).toBe(
      true,
    );
    // Shares per role must sum to 1 and each share must be positive.
    expect(
      recommendDataSchema.safeParse({ ...valid, pickRate: { ADC: { '2': 0.4, '3': 0.4 } } })
        .success,
    ).toBe(false);
    expect(recommendDataSchema.safeParse({ ...valid, pickRate: { ADC: { '2': 0 } } }).success).toBe(
      false,
    );
    expect(
      recommendDataSchema.safeParse({ ...valid, pickRate: { ADC: { '2': 1.5 } } }).success,
    ).toBe(false);
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
