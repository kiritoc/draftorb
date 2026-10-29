/**
 * @draftorb/engine — Helper functions for role inference.
 */

import { ROLE_INFERENCE_EPS } from './config.js';
import type { Assignment } from './roles-permutations.js';
import type { ChampionId, ChampionRoleProbabilities, Role, Slot } from '@draftorb/shared';

/**
 * Look up the probability that champion `championId` plays role `role`.
 * Returns the raw probability from the map, or 0 if the champion or role
 * is absent from the sparse map.
 */
export function roleProbability(
  roleProb: ChampionRoleProbabilities,
  championId: ChampionId,
  role: Role,
): number {
  const probs = roleProb[String(championId)];
  if (!probs) {
    return 0;
  }
  return probs[role] ?? 0;
}

/**
 * Check whether an assignment conflicts with fixed roles.
 * An assignment is valid only if every fixed-role slot keeps its role.
 */
export function assignmentIsValid(slots: ReadonlyArray<Slot>, assignment: Assignment): boolean {
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const assignedRole = assignment[i];
    if (slot && assignedRole && slot.role !== undefined && slot.role !== assignedRole) {
      return false;
    }
  }
  return true;
}

/**
 * Check whether a permutation is viable: every slot must have a non-zero
 * probability for its assigned role (missing champions or champions with
 * zero for all roles make the permutation non-viable).
 */
export function assignmentIsViable(
  slots: ReadonlyArray<Slot>,
  roleProb: ChampionRoleProbabilities,
  assignment: Assignment,
): boolean {
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const assignedRole = assignment[i];
    if (!slot || !assignedRole) {
      return false;
    }
    if (roleProbability(roleProb, slot.championId, assignedRole) === 0) {
      return false;
    }
  }
  return true;
}

/**
 * Compute the log-probability of an assignment (sum of log roleProb for each
 * slot). Zero-probability pairs are floored at ROLE_INFERENCE_EPS to avoid -Infinity.
 */
export function assignmentLogProb(
  slots: ReadonlyArray<Slot>,
  roleProb: ChampionRoleProbabilities,
  assignment: Assignment,
): number {
  let logSum = 0;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const assignedRole = assignment[i];
    if (!slot || !assignedRole) {
      return -Infinity;
    }
    const p = Math.max(
      roleProbability(roleProb, slot.championId, assignedRole),
      ROLE_INFERENCE_EPS,
    );
    logSum += Math.log(p);
  }
  return logSum;
}
