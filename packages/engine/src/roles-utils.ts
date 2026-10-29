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
    // Fixed roles are user overrides: certain regardless of historical data.
    if (slot.role !== undefined) {
      continue;
    }
    if (roleProbability(roleProb, slot.championId, assignedRole) === 0) {
      return false;
    }
  }
  return true;
}

/**
 * Compute the log-probability of an assignment (sum of log roleProb for each
 * slot). Positive probabilities are used as-is. `eps` is only a defensive
 * guard against log(0) for callers that skip `assignmentIsViable`; within
 * `inferRoles` zero-probability roles are rejected first, so it never applies.
 */
export function assignmentLogProb(
  slots: ReadonlyArray<Slot>,
  roleProb: ChampionRoleProbabilities,
  assignment: Assignment,
  eps: number = ROLE_INFERENCE_EPS,
): number {
  let logSum = 0;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const assignedRole = assignment[i];
    if (!slot || !assignedRole) {
      return -Infinity;
    }
    // Fixed roles have probability 1 (log 1 = 0).
    if (slot.role !== undefined) {
      continue;
    }
    // Only floor true zeros; positive observations below `eps` keep their
    // relative order (flooring them could reverse role preferences).
    const raw = roleProbability(roleProb, slot.championId, assignedRole);
    logSum += Math.log(raw > 0 ? raw : eps);
  }
  return logSum;
}
