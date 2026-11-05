import { describe, it, expect } from 'vitest';

import {
  DEFAULT_CONFIG,
  DEFAULT_INFLUENCE,
  RANK_BUCKET_ORDER,
  ROLES,
  SIDES,
  bucketIndex,
  getInfluence,
  influenceConfigSchema,
  rankToBucket,
  rankWeightingConfigSchema,
} from '../src/config.js';
import type { InfluenceMatrix } from '../src/config.js';

// JSON round-trip produces a fully mutable copy (avoids TypeScript's
// "delete on required property" error when building invalid test fixtures).
function mutableClone(m: InfluenceMatrix): InfluenceMatrix {
  return JSON.parse(JSON.stringify(m));
}

describe('rank bucketing', () => {
  it('maps raw ranks to the 8 buckets (MASTER_PLUS merges apex)', () => {
    expect(rankToBucket('IRON')).toBe('IRON');
    expect(rankToBucket('DIAMOND')).toBe('DIAMOND');
    expect(rankToBucket('MASTER')).toBe('MASTER_PLUS');
    expect(rankToBucket('GRANDMASTER')).toBe('MASTER_PLUS');
    expect(rankToBucket('CHALLENGER')).toBe('MASTER_PLUS');
  });

  it('bucketIndex returns 0..7', () => {
    expect(bucketIndex('IRON')).toBe(0);
    expect(bucketIndex('DIAMOND')).toBe(6);
    expect(bucketIndex('MASTER_PLUS')).toBe(7);
  });

  it('RANK_BUCKET_ORDER has 8 entries in ascending strength', () => {
    expect(RANK_BUCKET_ORDER).toHaveLength(8);
    expect(RANK_BUCKET_ORDER[0]).toBe('IRON');
    expect(RANK_BUCKET_ORDER[7]).toBe('MASTER_PLUS');
  });
});

describe('influence matrix validation', () => {
  it('accepts the default matrix', () => {
    expect(
      influenceConfigSchema.parse({ draft: DEFAULT_INFLUENCE, lane: DEFAULT_INFLUENCE }),
    ).toBeTruthy();
  });

  it('accepts a non-support row (TOP)', () => {
    const matrix = mutableClone(DEFAULT_INFLUENCE);
    // TOP enemy row: opponent (TOP) must be the max = 1.0
    expect(matrix.TOP.enemy.TOP).toBe(1.0);
    expect(matrix.TOP.ally.TOP).toBeNull();
    expect(influenceConfigSchema.parse({ draft: matrix, lane: matrix })).toBeTruthy();
  });

  it('rejects an incomplete ally row (missing a role)', () => {
    const matrix = mutableClone(DEFAULT_INFLUENCE);
    const raw = JSON.parse(JSON.stringify(matrix));
    raw.SUPPORT.ally = { TOP: 0.2, MID: 0.3, ADC: 1.0, SUPPORT: null }; // missing JUNGLE
    expect(() => influenceConfigSchema.parse({ draft: raw, lane: raw })).toThrow();
  });

  it('rejects an incomplete enemy row (missing a role)', () => {
    const matrix = mutableClone(DEFAULT_INFLUENCE);
    const raw = JSON.parse(JSON.stringify(matrix));
    raw.TOP.enemy = { TOP: 1.0, JUNGLE: 0.6, ADC: 0.1, SUPPORT: 0.1 }; // missing MID
    expect(() => influenceConfigSchema.parse({ draft: raw, lane: raw })).toThrow();
  });

  it('rejects a non-max opponent cell', () => {
    const matrix = mutableClone(DEFAULT_INFLUENCE);
    // Make TOP enemy JUNGLE larger than the self-role (TOP) which is 1.0
    matrix.TOP.enemy.JUNGLE = 1.5;
    expect(() => influenceConfigSchema.parse({ draft: matrix, lane: matrix })).toThrow();
  });

  it('rejects an ally row whose self-role cell is not null', () => {
    const matrix = mutableClone(DEFAULT_INFLUENCE);
    matrix.SUPPORT.ally.SUPPORT = 0.5;
    expect(() => influenceConfigSchema.parse({ draft: matrix, lane: matrix })).toThrow();
  });

  it('rejects an enemy row with a null cell', () => {
    const matrix = mutableClone(DEFAULT_INFLUENCE);
    matrix.TOP.enemy.MID = null;
    expect(() => influenceConfigSchema.parse({ draft: matrix, lane: matrix })).toThrow();
  });

  it('rejects a cell outside [0, 1]', () => {
    const matrix = mutableClone(DEFAULT_INFLUENCE);
    matrix.SUPPORT.ally.TOP = 1.5;
    expect(() => influenceConfigSchema.parse({ draft: matrix, lane: matrix })).toThrow();

    const matrix2 = mutableClone(DEFAULT_INFLUENCE);
    matrix2.TOP.enemy.TOP = -0.1;
    expect(() => influenceConfigSchema.parse({ draft: matrix2, lane: matrix2 })).toThrow();
  });

  it('accepts an enemy row where another cell ties the opponent (not strictly greater)', () => {
    const matrix = mutableClone(DEFAULT_INFLUENCE);
    matrix.TOP.enemy.JUNGLE = 1.0; // ties opponent (1.0), not greater
    expect(() => influenceConfigSchema.parse({ draft: matrix, lane: matrix })).not.toThrow();
  });
});

describe('rank weighting config', () => {
  it('DEFAULT_CONFIG is valid', () => {
    expect(rankWeightingConfigSchema.parse(DEFAULT_CONFIG)).toEqual(DEFAULT_CONFIG);
  });

  it('rejects unknown fields (strict mode)', () => {
    expect(() => rankWeightingConfigSchema.parse({ ...DEFAULT_CONFIG, bogus: true })).toThrow();
  });

  it('rejects invalid scalar ranges', () => {
    expect(() => rankWeightingConfigSchema.parse({ ...DEFAULT_CONFIG, tau: -1 })).toThrow();
    expect(() => rankWeightingConfigSchema.parse({ ...DEFAULT_CONFIG, decay: 0 })).toThrow();
    expect(() => rankWeightingConfigSchema.parse({ ...DEFAULT_CONFIG, decay: 1.5 })).toThrow();
    expect(() => rankWeightingConfigSchema.parse({ ...DEFAULT_CONFIG, eps: 0 })).toThrow();
    expect(() => rankWeightingConfigSchema.parse({ ...DEFAULT_CONFIG, eps: 0.6 })).toThrow();
    expect(() => rankWeightingConfigSchema.parse({ ...DEFAULT_CONFIG, contextSlots: 0 })).toThrow();
  });
});

describe('getInfluence', () => {
  it('returns the stored value for draft phase', () => {
    expect(getInfluence('SUPPORT', 'ally', 'ADC', 'draft', DEFAULT_CONFIG)).toBe(1.0);
    expect(getInfluence('SUPPORT', 'enemy', 'TOP', 'draft', DEFAULT_CONFIG)).toBe(0.1);
  });

  it('returns the stored value for lane phase', () => {
    expect(getInfluence('TOP', 'enemy', 'TOP', 'lane', DEFAULT_CONFIG)).toBe(1.0);
  });

  it('returns 0 for the omitted ally self-role cell', () => {
    expect(getInfluence('SUPPORT', 'ally', 'SUPPORT', 'draft', DEFAULT_CONFIG)).toBe(0);
  });

  it('derives the mid phase from the lane row (ally)', () => {
    // Ally weights in mid = lane row values
    expect(getInfluence('SUPPORT', 'ally', 'ADC', 'mid', DEFAULT_CONFIG)).toBe(
      getInfluence('SUPPORT', 'ally', 'ADC', 'lane', DEFAULT_CONFIG),
    );
    expect(getInfluence('TOP', 'ally', 'JUNGLE', 'mid', DEFAULT_CONFIG)).toBe(
      getInfluence('TOP', 'ally', 'JUNGLE', 'lane', DEFAULT_CONFIG),
    );
  });

  it('derives the mid phase enemy weight with lambda (no threat data)', () => {
    // enemy mid = lambda * lane_enemy + (1-lambda) * threatShare * enemiesKnown
    // With no threatShares / enemiesKnown: enemy mid = lambda * lane_enemy
    const laneEnemy = getInfluence('SUPPORT', 'enemy', 'TOP', 'lane', DEFAULT_CONFIG);
    expect(getInfluence('SUPPORT', 'enemy', 'TOP', 'mid', DEFAULT_CONFIG)).toBeCloseTo(
      DEFAULT_CONFIG.lambda * laneEnemy,
    );
  });

  it('applies threat shares in the mid phase enemy formula', () => {
    const lambda = DEFAULT_CONFIG.lambda;
    const laneEnemy = getInfluence('SUPPORT', 'enemy', 'TOP', 'lane', DEFAULT_CONFIG);
    const threatShare = 0.5;
    const enemiesKnown = 4;
    const expected = lambda * laneEnemy + (1 - lambda) * threatShare * enemiesKnown;
    expect(
      getInfluence('SUPPORT', 'enemy', 'TOP', 'mid', DEFAULT_CONFIG, {
        threatShares: { TOP: threatShare },
        enemiesKnown,
      }),
    ).toBeCloseTo(expected);
  });
});

describe('ROLES and SIDES', () => {
  it('ROLES has all 5 roles', () => {
    expect(ROLES).toHaveLength(5);
    expect(ROLES).toContain('SUPPORT');
    expect(ROLES).toContain('TOP');
  });

  it('SIDES has ally and enemy', () => {
    expect(SIDES).toEqual(['ally', 'enemy']);
  });
});

describe('exportMinGames / minGames invariant', () => {
  it('accepts exportMinGames equal to minGames', () => {
    expect(rankWeightingConfigSchema.parse({ ...DEFAULT_CONFIG, exportMinGames: 25 })).toBeTruthy();
  });

  it('accepts exportMinGames below minGames', () => {
    expect(rankWeightingConfigSchema.parse({ ...DEFAULT_CONFIG, exportMinGames: 10 })).toBeTruthy();
  });

  it('rejects exportMinGames above minGames', () => {
    expect(() =>
      rankWeightingConfigSchema.parse({ ...DEFAULT_CONFIG, exportMinGames: 30, minGames: 25 }),
    ).toThrow();
  });
});

describe('highLevelMinGames / minGames invariant', () => {
  it('defaults to 100', () => {
    expect(DEFAULT_CONFIG.highLevelMinGames).toBe(100);
  });

  it('accepts highLevelMinGames equal to minGames', () => {
    expect(
      rankWeightingConfigSchema.parse({ ...DEFAULT_CONFIG, highLevelMinGames: 25 }),
    ).toBeTruthy();
  });

  it('rejects highLevelMinGames below minGames', () => {
    expect(() =>
      rankWeightingConfigSchema.parse({ ...DEFAULT_CONFIG, highLevelMinGames: 20, minGames: 25 }),
    ).toThrow();
  });
});
