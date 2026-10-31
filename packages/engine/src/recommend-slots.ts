/**
 * @draftorb/engine — Known-slot and lane-group resolution (SPECS §4-5).
 */

import type { ChampionRoleProbabilities, Role, Slot } from '@draftorb/shared';
import type { RoleAssignment } from './roles.js';
import type { KnownSlot, LaneGroup, LaneGroupInfo } from './recommend-types.js';
import { inferRoles } from './roles.js';

/**
 * Infer roles for a team and convert them into known slots. When inference
 * fails for the whole team (e.g. one unfixed champion lacks role
 * probabilities), retry on the resolvable subset; as a last resort keep only
 * fixed-role slots (confidence 1). Unresolved slots only lose their
 * role-dependent effects.
 */
export function resolveKnownSlots(
  slots: ReadonlyArray<Slot>,
  side: 'ally' | 'enemy',
  roleProb: ChampionRoleProbabilities,
): KnownSlot[] {
  if (slots.length === 0) return [];
  let source: ReadonlyArray<Slot> = slots;
  let resolved: RoleAssignment | null = inferRoles(slots, roleProb);
  if (!resolved) {
    source = slots.filter((s) => s.role !== undefined || roleProb[s.championId] !== undefined);
    resolved = source.length > 0 ? inferRoles(source, roleProb) : null;
  }
  if (!resolved) {
    return slots
      .filter((s): s is Slot & { role: Role } => s.role !== undefined)
      .map((s) => ({ championId: s.championId, role: s.role, side, confidence: 1, fixed: true }));
  }
  return resolved.slots.map((s) => ({
    championId: s.championId,
    role: s.role,
    side,
    confidence: s.confidence,
    fixed: source.find((x) => x.championId === s.championId)?.role !== undefined,
  }));
}

/**
 * Select the lane-group champions in canonical role order; `confidence` is the
 * product of their §4 confidences (`conf_lane`).
 */
export function computeLaneGroup(
  laneGroup: LaneGroup,
  allySlots: KnownSlot[],
  enemySlots: KnownSlot[],
): LaneGroupInfo {
  const allies = allySlots
    .filter((s) => laneGroup.allies.includes(s.role))
    .sort((a, b) => laneGroup.allies.indexOf(a.role) - laneGroup.allies.indexOf(b.role));
  const enemies = enemySlots
    .filter((s) => laneGroup.enemies.includes(s.role))
    .sort((a, b) => laneGroup.enemies.indexOf(a.role) - laneGroup.enemies.indexOf(b.role));

  let confidence = 1;
  for (const s of [...allies, ...enemies]) confidence *= s.confidence;

  return {
    allies,
    enemies,
    alliesKnown: allies.map((s) => s.role),
    enemiesKnown: enemies.map((s) => s.role),
    confidence,
  };
}
