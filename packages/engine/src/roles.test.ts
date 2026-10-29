/**
 * Tests for role inference (SPECS §4).
 *
 * Covers: fixed roles, all-unassigned teams, flex champions, partially known
 * teams, peaked vs flat distributions, single-role champions, missing
 * champions, and the confidence helper.
 */

import { describe, expect, it } from 'vitest';

import { inferRoles, assignmentConfidence } from './roles.js';
import type { ChampionRoleProbabilities, Role, Slot } from '@draftorb/shared';

/**
 * Build a role-prob map. Keys are champion ids (as strings, matching the
 * `ChampionRoleProbabilities` type which is `z.record(z.string(), ...)`).
 */
function makeRoleProb(
  entries: Record<number, Partial<Record<string, number>>>,
): ChampionRoleProbabilities {
  const map: Record<string, Partial<Record<string, number>>> = {};
  for (const [champId, probs] of Object.entries(entries)) {
    map[String(champId)] = probs;
  }
  return map as unknown as ChampionRoleProbabilities;
}

/** A typical 5-slot team with champion ids 1-5. */
function makeSlots(roles?: (Role | undefined)[]): Slot[] {
  const defaults = [1, 2, 3, 4, 5];
  return defaults.map((champId, i) => ({
    championId: champId,
    role: roles?.[i],
  }));
}

/** Assert non-null and return the assignment. */
function expectAssignment(result: ReturnType<typeof inferRoles>): RoleAssignment {
  expect(result).not.toBeNull();
  return result as RoleAssignment;
}

import type { RoleAssignment } from './roles.js';

describe('inferRoles — fixed roles', () => {
  it('returns all-fixed teams with confidence 1', () => {
    const slots = makeSlots(['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT']);
    const roleProb = makeRoleProb({ 1: { TOP: 1 } });
    const result = expectAssignment(inferRoles(slots, roleProb));

    expect(result.confidence).toBe(1);
    expect(result.slots.map((s) => s.role)).toEqual(['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT']);
  });

  it('returns null for an empty team', () => {
    const roleProb = makeRoleProb({});
    expect(inferRoles([], roleProb)).toBeNull();
  });
});

describe('inferRoles — all-unassigned', () => {
  it('assigns roles to maximize total log-probability', () => {
    // Champ 1 strongly prefers TOP, Champ 2 strongly prefers JUNGLE, etc.
    const roleProb = makeRoleProb({
      1: { TOP: 0.9, JUNGLE: 0.025, MID: 0.025, ADC: 0.025, SUPPORT: 0.025 },
      2: { TOP: 0.025, JUNGLE: 0.9, MID: 0.025, ADC: 0.025, SUPPORT: 0.025 },
      3: { TOP: 0.025, JUNGLE: 0.025, MID: 0.9, ADC: 0.025, SUPPORT: 0.025 },
      4: { TOP: 0.025, JUNGLE: 0.025, MID: 0.025, ADC: 0.9, SUPPORT: 0.025 },
      5: { TOP: 0.025, JUNGLE: 0.025, MID: 0.025, ADC: 0.025, SUPPORT: 0.9 },
    });

    const slots = makeSlots();
    const result = expectAssignment(inferRoles(slots, roleProb));

    expect(result.slots.map((s) => s.role)).toEqual(['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT']);
    // With one dominant assignment, confidence should be high.
    expect(result.confidence).toBeGreaterThan(0.99);
  });

  it('picks the best permutation when preferences are mixed', () => {
    // Champ 1 prefers TOP, Champ 2 prefers TOP too (conflict), Champ 3 is a jungler.
    const roleProb = makeRoleProb({
      1: { TOP: 0.8, JUNGLE: 0.1, MID: 0.025, ADC: 0.025, SUPPORT: 0.05 },
      2: { TOP: 0.7, JUNGLE: 0.1, MID: 0.025, ADC: 0.025, SUPPORT: 0.05 },
      3: { TOP: 0.1, JUNGLE: 0.7, MID: 0.05, ADC: 0.05, SUPPORT: 0.1 },
      4: { TOP: 0.05, JUNGLE: 0.05, MID: 0.7, ADC: 0.1, SUPPORT: 0.1 },
      5: { TOP: 0.05, JUNGLE: 0.05, MID: 0.05, ADC: 0.7, SUPPORT: 0.15 },
    });

    const slots = makeSlots();
    const result = expectAssignment(inferRoles(slots, roleProb));

    // Champ 1 and 2 both want TOP, so one gets TOP and the other takes its next-best.
    const assignedRoles = result.slots.map((s) => s.role);
    expect(assignedRoles).toContain('TOP');
    expect(assignedRoles).toContain('JUNGLE');
    expect(assignedRoles).toContain('MID');
    expect(assignedRoles).toContain('ADC');
    expect(assignedRoles).toContain('SUPPORT');
    expect(new Set(assignedRoles).size).toBe(5);
  });
});

describe('inferRoles — flex champions', () => {
  it('handles a flex champion that can play two roles', () => {
    // Champ 2 is a flex: 50% JUNGLE, 50% TOP.
    const roleProb = makeRoleProb({
      1: { TOP: 0.9, JUNGLE: 0.025, MID: 0.025, ADC: 0.025, SUPPORT: 0.025 },
      2: { TOP: 0.5, JUNGLE: 0.5, MID: 0.0, ADC: 0.0, SUPPORT: 0.0 },
      3: { TOP: 0.025, JUNGLE: 0.025, MID: 0.9, ADC: 0.025, SUPPORT: 0.025 },
      4: { TOP: 0.025, JUNGLE: 0.025, MID: 0.025, ADC: 0.9, SUPPORT: 0.025 },
      5: { TOP: 0.025, JUNGLE: 0.025, MID: 0.025, ADC: 0.025, SUPPORT: 0.9 },
    });

    const slots = makeSlots();
    const result = expectAssignment(inferRoles(slots, roleProb));

    // Champ 1 wants TOP, Champ 2 flexes to JUNGLE, Champ 3 wants MID, etc.
    const roleMap = new Map(result.slots.map((s, i) => [i + 1, s.role]));
    expect(roleMap.get(1)).toBe('TOP');
    expect(roleMap.get(2)).toBe('JUNGLE');
    expect(roleMap.get(3)).toBe('MID');
    expect(roleMap.get(4)).toBe('ADC');
    expect(roleMap.get(5)).toBe('SUPPORT');
  });
});

describe('inferRoles — partially known team', () => {
  it('respects one fixed role and assigns the rest', () => {
    const roleProb = makeRoleProb({
      1: { TOP: 0.9, JUNGLE: 0.025, MID: 0.025, ADC: 0.025, SUPPORT: 0.025 },
      2: { TOP: 0.025, JUNGLE: 0.9, MID: 0.025, ADC: 0.025, SUPPORT: 0.025 },
      3: { TOP: 0.025, JUNGLE: 0.025, MID: 0.9, ADC: 0.025, SUPPORT: 0.025 },
      4: { TOP: 0.025, JUNGLE: 0.025, MID: 0.025, ADC: 0.9, SUPPORT: 0.025 },
      5: { TOP: 0.025, JUNGLE: 0.025, MID: 0.025, ADC: 0.025, SUPPORT: 0.9 },
    });

    // Slot 1 fixed as TOP, rest unassigned.
    const slots = makeSlots();
    slots[0] = { championId: 1, role: 'TOP' };
    const result = expectAssignment(inferRoles(slots, roleProb));

    expect(result.slots.map((s) => s.role)).toEqual(['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT']);
  });

  it('returns null if fixed roles conflict (two TOPs)', () => {
    const roleProb = makeRoleProb({
      1: { TOP: 1.0 },
      2: { TOP: 1.0 },
      3: { JUNGLE: 1.0 },
      4: { MID: 1.0 },
      5: { ADC: 1.0 },
    });

    const slots = makeSlots(['TOP', 'TOP', undefined, undefined, undefined]);
    const result = inferRoles(slots, roleProb);

    // Two fixed TOPs means no valid permutation (one champion per role).
    expect(result).toBeNull();
  });
});

describe('inferRoles — peakness affects confidence', () => {
  it('gives higher confidence for peaked distributions', () => {
    // Peaked: each champion is 90% one role.
    const peaked = makeRoleProb({
      1: { TOP: 0.9, JUNGLE: 0.025, MID: 0.025, ADC: 0.025, SUPPORT: 0.025 },
      2: { TOP: 0.025, JUNGLE: 0.9, MID: 0.025, ADC: 0.025, SUPPORT: 0.025 },
      3: { TOP: 0.025, JUNGLE: 0.025, MID: 0.9, ADC: 0.025, SUPPORT: 0.025 },
      4: { TOP: 0.025, JUNGLE: 0.025, MID: 0.025, ADC: 0.9, SUPPORT: 0.025 },
      5: { TOP: 0.025, JUNGLE: 0.025, MID: 0.025, ADC: 0.025, SUPPORT: 0.9 },
    });

    // Flat: each champion is 20% every role (uniform).
    const flat = makeRoleProb({
      1: { TOP: 0.2, JUNGLE: 0.2, MID: 0.2, ADC: 0.2, SUPPORT: 0.2 },
      2: { TOP: 0.2, JUNGLE: 0.2, MID: 0.2, ADC: 0.2, SUPPORT: 0.2 },
      3: { TOP: 0.2, JUNGLE: 0.2, MID: 0.2, ADC: 0.2, SUPPORT: 0.2 },
      4: { TOP: 0.2, JUNGLE: 0.2, MID: 0.2, ADC: 0.2, SUPPORT: 0.2 },
      5: { TOP: 0.2, JUNGLE: 0.2, MID: 0.2, ADC: 0.2, SUPPORT: 0.2 },
    });

    const slots = makeSlots();
    const peakedResult = expectAssignment(inferRoles(slots, peaked));
    const flatResult = expectAssignment(inferRoles(slots, flat));

    expect(peakedResult.confidence).toBeGreaterThan(flatResult.confidence);
  });

  it('gives confidence 1 when only one valid permutation exists', () => {
    // Single-role champions: each champion can only play one role.
    const roleProb = makeRoleProb({
      1: { TOP: 1.0 },
      2: { JUNGLE: 1.0 },
      3: { MID: 1.0 },
      4: { ADC: 1.0 },
      5: { SUPPORT: 1.0 },
    });

    const slots = makeSlots();
    const result = expectAssignment(inferRoles(slots, roleProb));

    expect(result.confidence).toBe(1);
    expect(result.slots.map((s) => s.role)).toEqual(['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT']);
  });
});

describe('inferRoles — single-role champion', () => {
  it('a champion with only one role forces that role even if slot was unassigned', () => {
    // Champ 1 only plays TOP. Even though slot is unassigned, it must get TOP.
    const roleProb = makeRoleProb({
      1: { TOP: 1.0 },
      2: { JUNGLE: 0.8, MID: 0.1, TOP: 0.1 },
      3: { MID: 0.8, JUNGLE: 0.1, TOP: 0.1 },
      4: { ADC: 0.9, SUPPORT: 0.1 },
      5: { SUPPORT: 0.9, ADC: 0.1 },
    });

    const slots = makeSlots();
    const result = expectAssignment(inferRoles(slots, roleProb));

    const [first] = result.slots;
    expect(first?.role).toBe('TOP');
  });
});

describe('inferRoles — missing champions', () => {
  it('returns null if a champion is missing from the roleProb map', () => {
    const roleProb = makeRoleProb({
      1: { TOP: 1.0 },
      // 2 is missing
    });

    const slots = makeSlots();
    const result = inferRoles(slots, roleProb);

    expect(result).toBeNull();
  });
});

describe('inferRoles — partial team (< 5 slots)', () => {
  it('greedily assigns roles to available slots', () => {
    const roleProb = makeRoleProb({
      1: { TOP: 0.9, JUNGLE: 0.05, MID: 0.025, ADC: 0.025, SUPPORT: 0.0 },
      2: { TOP: 0.05, JUNGLE: 0.9, MID: 0.025, ADC: 0.025, SUPPORT: 0.0 },
      3: { TOP: 0.025, JUNGLE: 0.025, MID: 0.9, ADC: 0.025, SUPPORT: 0.025 },
    });

    const slots: Slot[] = [{ championId: 1 }, { championId: 2 }, { championId: 3 }];
    const result = expectAssignment(inferRoles(slots, roleProb));

    expect(result.slots.map((s) => s.role)).toEqual(['TOP', 'JUNGLE', 'MID']);
    const [first] = result.slots;
    expect(first?.confidence).toBeGreaterThan(0.9);
  });

  it('does not let a flex champion steal a single-role champion role', () => {
    const roleProb = makeRoleProb({
      1: { TOP: 0.6, JUNGLE: 0.4 },
      2: { TOP: 1.0 },
    });

    const slots: Slot[] = [{ championId: 1 }, { championId: 2 }];
    const result = expectAssignment(inferRoles(slots, roleProb));

    expect(result.slots.map((s) => s.role)).toEqual(['JUNGLE', 'TOP']);
  });

  it('returns null for duplicate fixed roles in a partial team', () => {
    const roleProb = makeRoleProb({ 1: { TOP: 1.0 }, 2: { TOP: 1.0 } });
    const slots: Slot[] = [
      { championId: 1, role: 'TOP' },
      { championId: 2, role: 'TOP' },
    ];
    expect(inferRoles(slots, roleProb)).toBeNull();
  });
});

describe('inferRoles — fixed-role regressions', () => {
  it('returns null for duplicate roles in an all-fixed team', () => {
    const slots = makeSlots(['TOP', 'TOP', 'MID', 'ADC', 'SUPPORT']);
    expect(inferRoles(slots, makeRoleProb({}))).toBeNull();
  });

  it('honors an off-role fixed pick in a full team', () => {
    const roleProb = makeRoleProb({
      1: { TOP: 1.0 },
      2: { TOP: 0.9, JUNGLE: 0.1 },
      3: { JUNGLE: 0.9, TOP: 0.1 },
      4: { ADC: 1.0 },
      5: { SUPPORT: 1.0 },
    });
    const slots = makeSlots(['MID', undefined, undefined, undefined, undefined]);
    const result = expectAssignment(inferRoles(slots, roleProb));

    expect(result.slots.map((s) => s.role)).toEqual(['MID', 'TOP', 'JUNGLE', 'ADC', 'SUPPORT']);
  });

  it('keeps confidence 1 for fixed and forced slots when others are ambiguous', () => {
    const roleProb = makeRoleProb({
      2: { JUNGLE: 0.5, MID: 0.5 },
      3: { JUNGLE: 0.5, MID: 0.5 },
      4: { ADC: 1.0 },
      5: { SUPPORT: 1.0 },
    });
    const slots = makeSlots(['TOP', undefined, undefined, undefined, undefined]);
    const result = expectAssignment(inferRoles(slots, roleProb));

    expect(result.slots[0]?.confidence).toBe(1);
    expect(result.slots[3]?.confidence).toBe(1);
    expect(result.slots[1]?.confidence).toBeCloseTo(0.5);
    expect(result.confidence).toBeCloseTo(0.5);
  });

  it('does not flatten positive probabilities below eps', () => {
    // Flooring both of champ 2's rare roles to eps would tie the two
    // assignments and let the first-enumerated (worse) one win.
    const roleProb = makeRoleProb({
      1: { TOP: 0.5, JUNGLE: 0.5 },
      2: { TOP: 5e-5, JUNGLE: 1e-5 },
    });
    const slots: Slot[] = [{ championId: 1 }, { championId: 2 }];
    const result = expectAssignment(inferRoles(slots, roleProb));

    expect(result.slots.map((s) => s.role)).toEqual(['JUNGLE', 'TOP']);
  });

  it('includes every viable role in partial-team confidence', () => {
    const roleProb = makeRoleProb({
      1: { TOP: 0.2, JUNGLE: 0.2, MID: 0.2, ADC: 0.2, SUPPORT: 0.2 },
    });
    const result = expectAssignment(inferRoles([{ championId: 1 }], roleProb));

    expect(result.slots[0]?.confidence).toBeCloseTo(0.2);
    expect(result.confidence).toBeCloseTo(0.2);
  });

  it('respects fixed roles in a partial team', () => {
    const roleProb = makeRoleProb({
      1: { TOP: 1.0 },
      2: { JUNGLE: 0.9, MID: 0.1 },
      3: { MID: 0.9, JUNGLE: 0.1 },
    });

    const slots: Slot[] = [{ championId: 1, role: 'TOP' }, { championId: 2 }, { championId: 3 }];
    const result = expectAssignment(inferRoles(slots, roleProb));

    expect(result.slots.map((s) => s.role)).toEqual(['TOP', 'JUNGLE', 'MID']);
  });
});

describe('assignmentConfidence', () => {
  it('returns 0 when both probs are 0', () => {
    expect(assignmentConfidence(0, 0)).toBe(0);
  });

  it('returns the ratio of assigned to total', () => {
    expect(assignmentConfidence(0.9, 0.1)).toBeCloseTo(0.9);
    expect(assignmentConfidence(0.5, 0.5)).toBeCloseTo(0.5);
  });
});
