/**
 * Per-role matchup context specs and resolvers (BL-056, D-135 follow-up).
 */

import { describe, expect, it } from 'vitest';

import {
  matchupIdsMatch,
  resolveMatchupSpec,
  roleMatchupSpec,
  type MatchupIdLookup,
} from '../src/matchup-context.js';

describe('roleMatchupSpec', () => {
  it('keeps the Support-shaped spec: ally ADC + enemy SUPPORT at L1', () => {
    const spec = roleMatchupSpec('SUPPORT');
    expect(spec).not.toBeNull();
    expect(spec?.l1).toEqual([
      { side: 'ally', role: 'ADC' },
      { side: 'enemy', role: 'SUPPORT' },
    ]);
    expect(spec?.l2).toEqual([{ side: 'enemy', role: 'SUPPORT' }]);
  });

  it('defines TOP vs enemy TOP (+ enemy JUNGLE at L1)', () => {
    const spec = roleMatchupSpec('TOP');
    expect(spec?.l1).toEqual([
      { side: 'enemy', role: 'TOP' },
      { side: 'enemy', role: 'JUNGLE' },
    ]);
    expect(spec?.l2).toEqual([{ side: 'enemy', role: 'TOP' }]);
  });

  it('defines JUNGLE vs enemy JUNGLE (+ enemy MID at L1)', () => {
    const spec = roleMatchupSpec('JUNGLE');
    expect(spec?.l1).toEqual([
      { side: 'enemy', role: 'JUNGLE' },
      { side: 'enemy', role: 'MID' },
    ]);
    expect(spec?.l2).toEqual([{ side: 'enemy', role: 'JUNGLE' }]);
  });

  it('returns null for out-of-scope roles', () => {
    expect(roleMatchupSpec('ADC')).toBeNull();
    expect(roleMatchupSpec('MID')).toBeNull();
  });

  it('keeps every L2 slot inside L1 (L2 widens L1)', () => {
    for (const role of ['SUPPORT', 'TOP', 'JUNGLE'] as const) {
      const spec = roleMatchupSpec(role);
      expect(spec).not.toBeNull();
      for (const l2 of spec?.l2 ?? []) {
        expect(spec?.l1).toContainEqual(l2);
      }
    }
  });
});

describe('resolveMatchupSpec / matchupIdsMatch', () => {
  const lookup: MatchupIdLookup = (side, role) => {
    const table: Record<string, number> = {
      'ally:ADC': 10,
      'enemy:SUPPORT': 200,
      'enemy:ADC': 201,
      'enemy:TOP': 31,
      'enemy:JUNGLE': 32,
      'enemy:MID': 33,
    };
    return table[`${side}:${role}`] ?? null;
  };

  it('resolves every slot through the lookup, preserving order', () => {
    const spec = roleMatchupSpec('TOP');
    expect(spec).not.toBeNull();
    const resolved = resolveMatchupSpec(spec as NonNullable<typeof spec>, lookup);
    expect(resolved.l1).toEqual([31, 32]);
    expect(resolved.l2).toEqual([31]);
  });

  it('keeps unknown slots as null', () => {
    const sparse: MatchupIdLookup = () => null;
    const spec = roleMatchupSpec('JUNGLE');
    const resolved = resolveMatchupSpec(spec as NonNullable<typeof spec>, sparse);
    expect(resolved.l1).toEqual([null, null]);
    expect(resolved.l2).toEqual([null]);
  });

  it('matches only when every required id is known and equal', () => {
    // Unknown requirement disables the level.
    expect(matchupIdsMatch([null], [31])).toBe(false);
    expect(matchupIdsMatch([31, null], [31, 32])).toBe(false);
    // Known requirement vs unknown actual never matches.
    expect(matchupIdsMatch([31], [null])).toBe(false);
    expect(matchupIdsMatch([31, 32], [31, 33])).toBe(false);
    expect(matchupIdsMatch([31, 32], [31, 32])).toBe(true);
    expect(matchupIdsMatch([], [])).toBe(true);
  });
});
