/**
 * @draftorb/engine — Role inference for draft slots with unknown roles.
 *
 * Pure, deterministic. Takes the slots and a role-probability map (from
 * `role-prob.json`) and returns an inferred role + confidence for each slot
 * (SPECS §4).
 */

import type { ChampionRoleProbabilities, Role, Slot } from '@draftorb/shared';
import type { Assignment } from './roles-permutations.js';
import type { InferredSlot, RoleAssignment } from './roles-types.js';
import { ALL_ROLES, ROLE_PERMUTATIONS } from './roles-permutations.js';
import { assignmentIsViable, assignmentIsValid, assignmentLogProb } from './roles-utils.js';

export type { Assignment } from './roles-permutations.js';
export type { InferredSlot, RoleAssignment } from './roles-types.js';

/**
 * Infer roles for a team of slots (SPECS §4).
 *
 * - Slots with a fixed `role` keep it (prob 1).
 * - For a full 5-slot team, the remaining slots are assigned roles to maximize
 *   the sum of log roleProb, subject to "one champion per role" (brute-force
 *   over all 120 permutations).
 * - For partial teams (< 5 slots), each unknown slot greedily takes its
 *   most-likely available role.
 * - `confidence` is the probability mass of the best valid assignment relative
 *   to the total across all valid assignments. It is 1 when only one valid
 *   assignment exists, and lower when multiple assignments are plausible.
 *
 * @param slots    The team's draft slots (1–5 entries). Fixed roles honored.
 * @param roleProb The `role-prob.json` map of champion -> role probabilities.
 * @returns        `RoleAssignment` with per-slot role + confidence, or `null`
 *                 if no valid assignment exists (e.g., a fixed-role conflict
 *                 or a champion missing from the map).
 */
export function inferRoles(
  slots: ReadonlyArray<Slot>,
  roleProb: ChampionRoleProbabilities,
): RoleAssignment | null {
  if (slots.length === 0) {
    return null;
  }

  if (slots.length === 5) {
    return inferRolesFull(slots, roleProb);
  }
  return inferRolesPartial(slots, roleProb);
}

/**
 * Full 5-slot team: brute-force over all 120 role permutations.
 * Each slot maps to a position; fixed roles constrain which permutations are valid.
 */
function inferRolesFull(
  slots: ReadonlyArray<Slot>,
  roleProb: ChampionRoleProbabilities,
): RoleAssignment | null {
  const allFixed = slots.every((s) => s.role !== undefined);
  if (allFixed) {
    return {
      slots: slots.map((s) => ({
        championId: s.championId,
        role: s.role as Role,
        confidence: 1,
      })),
      confidence: 1,
    };
  }

  let bestLogProb = -Infinity;
  let bestProb = 0;
  let totalProb = 0;
  let bestAssignment: Assignment | null = null;
  let validCount = 0;

  for (const perm of ROLE_PERMUTATIONS) {
    if (!assignmentIsValid(slots, perm) || !assignmentIsViable(slots, roleProb, perm)) {
      continue;
    }

    validCount++;
    const logProb = assignmentLogProb(slots, roleProb, perm);
    const prob = Math.exp(logProb);

    totalProb += prob;
    if (logProb > bestLogProb) {
      bestLogProb = logProb;
      bestProb = prob;
      bestAssignment = perm;
    }
  }

  if (bestAssignment === null) {
    return null;
  }

  const confidence = validCount === 1 ? 1 : bestProb / totalProb;
  const assignment = bestAssignment as Assignment;

  return {
    slots: slots.map((s, i) => {
      const role = s.role ?? (assignment[i] as Role);
      return {
        championId: s.championId,
        role,
        confidence,
      };
    }),
    confidence,
  };
}

/**
 * Partial team (< 5 slots): greedy assignment of each unknown slot to its
 * most-likely available role. Confidence for each inferred slot is
 * `bestProb / (bestProb + secondBestProb)` — the best role vs the
 * next-best available role.
 */
function inferRolesPartial(
  slots: ReadonlyArray<Slot>,
  roleProb: ChampionRoleProbabilities,
): RoleAssignment | null {
  const usedRoles = new Set<Role>();

  for (const s of slots) {
    if (s.role !== undefined) {
      usedRoles.add(s.role);
    }
  }

  const result: InferredSlot[] = [];
  let minConfidence = 1;
  let anyInferred = false;

  for (const s of slots) {
    if (s.role !== undefined) {
      result.push({
        championId: s.championId,
        role: s.role,
        confidence: 1,
      });
      continue;
    }

    const probs = roleProb[String(s.championId)];
    if (!probs) {
      return null;
    }

    let bestRole: Role | null = null;
    let bestProb = -1;
    let secondBestProb = -1;

    for (const r of ALL_ROLES) {
      if (usedRoles.has(r)) {
        continue;
      }
      const p = probs[r] ?? 0;
      if (p > bestProb) {
        secondBestProb = bestProb;
        bestProb = p;
        bestRole = r;
      } else if (p > secondBestProb) {
        secondBestProb = p;
      }
    }

    if (bestRole === null) {
      // All roles are claimed by fixed slots; pick the highest-probability role.
      for (const r of ALL_ROLES) {
        const p = probs[r] ?? 0;
        if (p > bestProb) {
          bestProb = p;
          bestRole = r;
        }
      }
      if (bestRole === null) {
        return null;
      }
    } else {
      usedRoles.add(bestRole);
    }

    anyInferred = true;
    const slotConfidence = secondBestProb <= 0 ? 1 : bestProb / (bestProb + secondBestProb);

    minConfidence = Math.min(minConfidence, slotConfidence);
    result.push({
      championId: s.championId,
      role: bestRole,
      confidence: slotConfidence,
    });
  }

  if (!anyInferred) {
    return {
      slots: result,
      confidence: 1,
    };
  }

  return {
    slots: result,
    confidence: minConfidence,
  };
}

/**
 * Confidence helper (SPECS §4): confidence of a role assignment,
 * computed as the best role's probability mass relative to the total
 * assignable probability mass.
 *
 * @param assignedProb  The probability of the assigned role.
 * @param alternativeProb  The probability mass of all other assignable roles.
 * @returns            A confidence in [0, 1].
 */
export function assignmentConfidence(assignedProb: number, alternativeProb: number): number {
  const total = assignedProb + alternativeProb;
  if (total <= 0) {
    return 0;
  }
  return assignedProb / total;
}
