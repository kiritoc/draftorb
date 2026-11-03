/**
 * @draftorb/engine — Role inference for draft slots with unknown roles.
 *
 * Pure, deterministic. Takes the slots and a role-probability map (from
 * `role-prob.json`) and returns an inferred role + confidence for each slot
 * (SPECS §4).
 */

import type { ChampionRoleProbabilities, Role, Slot } from '@draftorb/shared';
import type { Assignment } from './roles-permutations.js';
import type { RoleAssignment } from './roles-types.js';
import { ROLE_PERMUTATIONS } from './roles-permutations.js';
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
 * - Partial teams (< 5 slots) use the same exact solver over distinct
 *   one-to-one role assignments of the present slots (no greedy step).
 * - Per-slot `confidence` is the marginal probability mass of the chosen role
 *   across all viable assignments (1 for fixed or forced slots).
 * - Team `confidence` is the probability mass of the best viable assignment
 *   relative to the total across all viable assignments. It is 1 when only one
 *   viable assignment exists.
 *
 * @param slots    The team's draft slots (1–5 entries). Fixed roles honored.
 * @param roleProb The `role-prob.json` map of champion -> role probabilities.
 * @param excludedRoles Roles no unfixed slot may take (e.g. the user's own
 *                 role on the ally team, D-050). A fixed slot holding an
 *                 excluded role makes the call return `null`.
 * @returns        `RoleAssignment` with per-slot role + confidence, or `null`
 *                 if no valid assignment exists (e.g., a fixed-role conflict
 *                 or a champion missing from the map).
 */
export function inferRoles(
  slots: ReadonlyArray<Slot>,
  roleProb: ChampionRoleProbabilities,
  excludedRoles: readonly Role[] = [],
): RoleAssignment | null {
  if (slots.length === 0 || slots.length > 5) {
    return null;
  }

  // Reject duplicate fixed roles (one champion per role) and fixed roles that
  // are excluded (callers drop those slots beforehand; a leftover one is a
  // conflict).
  const fixedRoles = new Set<Role>();
  for (const s of slots) {
    if (s.role !== undefined) {
      if (fixedRoles.has(s.role) || excludedRoles.includes(s.role)) {
        return null;
      }
      fixedRoles.add(s.role);
    }
  }

  return inferRolesExact(slots, roleProb, excludedRoles);
}

/**
 * Exact solver for 1–5 slots: enumerates role permutations (deduplicated on
 * the first `slots.length` positions). Fixed slots are certain (prob 1).
 * Per-slot confidence = marginal mass of the chosen role across viable
 * assignments; team confidence = best assignment mass / total mass.
 */
function inferRolesExact(
  slots: ReadonlyArray<Slot>,
  roleProb: ChampionRoleProbabilities,
  excludedRoles: readonly Role[] = [],
): RoleAssignment | null {
  let bestLogProb = -Infinity;
  let bestProb = 0;
  let totalProb = 0;
  let bestAssignment: Assignment | null = null;
  const slotMass: Map<Role, number>[] = slots.map(() => new Map<Role, number>());
  const seen = new Set<string>();

  for (const perm of ROLE_PERMUTATIONS) {
    // Partial teams only use the first `slots.length` positions; dedupe prefixes.
    const key = perm.slice(0, slots.length).join(',');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    if (!assignmentIsValid(slots, perm) || !assignmentIsViable(slots, roleProb, perm)) {
      continue;
    }

    // An excluded role may never land on an unfixed slot (fixed slots with an
    // excluded role were already rejected in `inferRoles`).
    if (excludedRoles.length > 0) {
      let excluded = false;
      for (let i = 0; i < slots.length; i++) {
        if (slots[i]?.role === undefined && excludedRoles.includes(perm[i] as Role)) {
          excluded = true;
          break;
        }
      }
      if (excluded) {
        continue;
      }
    }

    const logProb = assignmentLogProb(slots, roleProb, perm);
    const prob = Math.exp(logProb);

    totalProb += prob;
    for (let i = 0; i < slots.length; i++) {
      const r = perm[i] as Role;
      const mass = slotMass[i];
      if (mass) {
        mass.set(r, (mass.get(r) ?? 0) + prob);
      }
    }
    if (logProb > bestLogProb) {
      bestLogProb = logProb;
      bestProb = prob;
      bestAssignment = perm;
    }
  }

  if (bestAssignment === null) {
    return null;
  }

  const assignment = bestAssignment;

  return {
    slots: slots.map((s, i) => {
      const role = s.role ?? (assignment[i] as Role);
      const confidence =
        s.role !== undefined || totalProb <= 0 ? 1 : (slotMass[i]?.get(role) ?? 0) / totalProb;
      return {
        championId: s.championId,
        role,
        confidence,
      };
    }),
    confidence: totalProb > 0 ? bestProb / totalProb : 1,
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
