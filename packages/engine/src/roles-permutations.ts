/**
 * @draftorb/engine — Role permutation generation for role inference.
 *
 * Generates all 120 permutations of the 5 roles for brute-force role assignment.
 */

import type { Role } from '@draftorb/shared';

/** All 5 roles in canonical order (matches `roleSchema` enum order). */
export const ALL_ROLES: ReadonlyArray<Role> = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];

export type Assignment = [Role, Role, Role, Role, Role];

/**
 * Generate all permutations of the 5 roles (5! = 120).
 * Each permutation is a candidate assignment of roles to the 5 team slots.
 */
function allRolePermutations(): Assignment[] {
  const result: Assignment[] = [];
  const used: boolean[] = [false, false, false, false, false];
  const current: Role[] = [];

  function backtrack(): void {
    if (current.length === 5) {
      result.push([
        current[0] as Role,
        current[1] as Role,
        current[2] as Role,
        current[3] as Role,
        current[4] as Role,
      ]);
      return;
    }
    for (let i = 0; i < 5; i++) {
      if (!used[i]) {
        used[i] = true;
        current.push(ALL_ROLES[i] as Role);
        backtrack();
        current.pop();
        used[i] = false;
      }
    }
  }

  backtrack();
  return result;
}

/** Memoize permutations so we don't recompute on every call. */
export const ROLE_PERMUTATIONS = allRolePermutations();
