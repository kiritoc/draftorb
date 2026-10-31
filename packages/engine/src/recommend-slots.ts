/**
 * @draftorb/engine — Known-slot and lane-group resolution (SPECS §4-5).
 */

import type { ChampionId, ChampionRoleProbabilities, Role, Slot } from '@draftorb/shared';
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
  // A champion can only be picked once per team: keep one copy per championId
  // so lookups below are unambiguous. A fixed-role copy wins over an unfixed
  // one (an explicit role is stronger evidence), otherwise the first is kept.
  const fixedIds = new Set<ChampionId>(
    slots.filter((s) => s.role !== undefined).map((s) => s.championId),
  );
  const seen = new Set<ChampionId>();
  slots = slots.filter((s) => {
    if (seen.has(s.championId)) return false;
    if (s.role === undefined && fixedIds.has(s.championId)) return false;
    seen.add(s.championId);
    return true;
  });
  if (slots.length === 0) return [];
  let source: ReadonlyArray<Slot> = slots;
  let resolved: RoleAssignment | null = inferRoles(slots, roleProb);
  if (!resolved) {
    // Greedily grow a viable subset: start from fixed slots, then add each
    // unfixed slot only if inference still succeeds with it included.
    const fixedSlots = slots.filter((s) => s.role !== undefined);
    let subset: Slot[] = [...fixedSlots];
    let subsetResolved: RoleAssignment | null =
      subset.length > 0 ? inferRoles(subset, roleProb) : null;
    for (const s of slots) {
      if (s.role !== undefined) continue;
      const attempt = inferRoles([...subset, s], roleProb);
      if (attempt) {
        subset = [...subset, s];
        subsetResolved = attempt;
      }
    }
    source = subset;
    resolved = subsetResolved;
  }
  if (!resolved) {
    // Fixed roles that appear more than once are ambiguous (D-030): drop them so
    // they cannot form a fake complete lane or displace the real opponent.
    const roleCounts = new Map<Role, number>();
    for (const s of slots) {
      if (s.role !== undefined) roleCounts.set(s.role, (roleCounts.get(s.role) ?? 0) + 1);
    }
    return slots
      .filter((s): s is Slot & { role: Role } => s.role !== undefined)
      .filter((s) => roleCounts.get(s.role) === 1)
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

  let enemyConfidence = 1;
  for (const s of enemies) enemyConfidence *= s.confidence;
  let confidence = enemyConfidence;
  for (const s of allies) confidence *= s.confidence;

  return {
    allies,
    enemies,
    alliesKnown: allies.map((s) => s.role),
    enemiesKnown: enemies.map((s) => s.role),
    confidence,
    enemyConfidence,
  };
}
