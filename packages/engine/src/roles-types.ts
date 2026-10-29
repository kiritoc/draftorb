/**
 * @draftorb/engine — Types for role inference.
 *
 * Pure, deterministic. Takes the slots and a role-probability map (from
 * `role-prob.json`) and returns an inferred role + confidence for each slot
 * (SPECS §4).
 */

import type { ChampionId, Role } from '@draftorb/shared';

/** A slot augmented with the engine's inferred role and a confidence value. */
export interface InferredSlot {
  readonly championId: ChampionId;
  readonly role: Role;
  readonly confidence: number;
}

/**
 * Role assignments for a team, with the confidence of each assignment.
 *
 * `confidence` is the probability mass of the best valid assignment relative to
 * the total probability mass across all valid assignments (SPECS §4: "confidence
 * of each assignment — probability mass of the best assignment vs alternatives").
 * It is 1 when only one valid assignment exists (including all roles fixed).
 */
export interface RoleAssignment {
  readonly slots: InferredSlot[];
  readonly confidence: number;
}
