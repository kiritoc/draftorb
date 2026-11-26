/**
 * Fast draft entry helpers (BL-022): pick-target ordering, digit-key
 * jumps, next-empty advancement and the ban list rules (SPECS §2, §10).
 */

import { describe, expect, it } from 'vitest';

import {
  addBan,
  BAN_LIMIT,
  BAN_TARGET,
  canBan,
  ENTRY_TARGET_COUNT,
  isPickTargetIndex,
  lastBan,
  nextEmptyTarget,
  PICK_TARGETS,
  removeBan,
  targetIndexForDigit,
} from './draft-entry';

describe('PICK_TARGETS', () => {
  it('lists the ten pick slots in entry order: you, four allies, five enemies', () => {
    expect(PICK_TARGETS).toHaveLength(10);
    expect(PICK_TARGETS[0]).toEqual({ kind: 'user' });
    expect(PICK_TARGETS.slice(1, 5)).toEqual([
      { kind: 'ally', index: 0 },
      { kind: 'ally', index: 1 },
      { kind: 'ally', index: 2 },
      { kind: 'ally', index: 3 },
    ]);
    expect(PICK_TARGETS.slice(5)).toEqual([
      { kind: 'enemy', index: 0 },
      { kind: 'enemy', index: 1 },
      { kind: 'enemy', index: 2 },
      { kind: 'enemy', index: 3 },
      { kind: 'enemy', index: 4 },
    ]);
  });
});

describe('targetIndexForDigit', () => {
  it('maps 1-9 and 0 to the ten pick targets in order', () => {
    expect(targetIndexForDigit('1')).toBe(0);
    expect(targetIndexForDigit('5')).toBe(4);
    expect(targetIndexForDigit('9')).toBe(8);
    expect(targetIndexForDigit('0')).toBe(9);
  });

  it('rejects non-digit keys', () => {
    expect(targetIndexForDigit('a')).toBeNull();
    expect(targetIndexForDigit('')).toBeNull();
    expect(targetIndexForDigit('12')).toBeNull();
  });
});

describe('isPickTargetIndex / BAN_TARGET', () => {
  it('accepts 0-9 as pick targets and reserves 10 for bans', () => {
    expect(isPickTargetIndex(0)).toBe(true);
    expect(isPickTargetIndex(9)).toBe(true);
    expect(isPickTargetIndex(BAN_TARGET)).toBe(false);
    expect(isPickTargetIndex(ENTRY_TARGET_COUNT)).toBe(false);
    expect(BAN_TARGET).toBe(10);
    expect(ENTRY_TARGET_COUNT).toBe(11);
  });
});

describe('nextEmptyTarget', () => {
  it('advances to the next unfilled slot', () => {
    expect(nextEmptyTarget(new Set([0]), 0)).toBe(1);
    expect(nextEmptyTarget(new Set([0, 1]), 0)).toBe(2);
  });

  it('skips filled slots and wraps around the end', () => {
    expect(nextEmptyTarget(new Set([1, 2, 3]), 0)).toBe(4);
    expect(nextEmptyTarget(new Set([8, 9]), 7)).toBe(0);
  });

  it('stays on the current target when every slot is filled', () => {
    const all = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(nextEmptyTarget(all, 4)).toBe(4);
  });
});

describe('bans', () => {
  it('allows a ban under the limit for an unpicked champion', () => {
    expect(canBan([1, 2], 3, new Set([9]))).toBe(true);
  });

  it('rejects duplicates, picked champions and a full list', () => {
    expect(canBan([1, 2], 2, new Set())).toBe(false);
    expect(canBan([1, 2], 3, new Set([3]))).toBe(false);
    const full = Array.from({ length: BAN_LIMIT }, (_, i) => i + 1);
    expect(canBan(full, 99, new Set())).toBe(false);
  });

  it('appends a valid ban and returns null otherwise', () => {
    expect(addBan([1, 2], 3, new Set())).toEqual([1, 2, 3]);
    expect(addBan([1, 2], 2, new Set())).toBeNull();
    expect(addBan([1, 2], 3, new Set([3]))).toBeNull();
    const full = Array.from({ length: BAN_LIMIT }, (_, i) => i + 1);
    expect(addBan(full, 99, new Set())).toBeNull();
  });

  it('removes a ban and reports the last one', () => {
    expect(removeBan([1, 2, 3], 2)).toEqual([1, 3]);
    expect(removeBan([1, 2], 9)).toEqual([1, 2]);
    expect(lastBan([1, 2, 3])).toBe(3);
    expect(lastBan([])).toBeUndefined();
  });
});
