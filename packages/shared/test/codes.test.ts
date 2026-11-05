import { describe, it, expect } from 'vitest';
import { compNeedCategorySchema, warningCodeSchema } from '../src/schemas/codes.js';

describe('warningCodeSchema', () => {
  it('accepts offRole and well-formed counteredBy codes', () => {
    expect(warningCodeSchema.safeParse('offRole').success).toBe(true);
    expect(warningCodeSchema.safeParse('counteredBy:SUPPORT:412').success).toBe(true);
  });

  it('rejects free text, unknown roles and non-numeric ids', () => {
    expect(warningCodeSchema.safeParse('countered by enemy support').success).toBe(false);
    expect(warningCodeSchema.safeParse('counteredBy:BOT:412').success).toBe(false);
    expect(warningCodeSchema.safeParse('counteredBy:SUPPORT:abc').success).toBe(false);
  });

  it('rejects non-positive or zero-padded champion ids', () => {
    expect(warningCodeSchema.safeParse('counteredBy:SUPPORT:0').success).toBe(false);
    expect(warningCodeSchema.safeParse('counteredBy:SUPPORT:012').success).toBe(false);
  });
});

describe('compNeedCategorySchema', () => {
  it('uses snake_case damage codes', () => {
    expect(compNeedCategorySchema.safeParse('ad_damage').success).toBe(true);
    expect(compNeedCategorySchema.safeParse('adDamage').success).toBe(false);
  });
});
