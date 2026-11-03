/**
 * @draftorb/engine — Role-conflict handling for known slots (SPECS §4, D-030).
 */

import type { ChampionId, ChampionRoleProbabilities, Role, Slot } from '@draftorb/shared';
import type { RoleAssignment } from './roles.js';
import type { KnownSlot } from './recommend-types.js';
import { inferRoles } from './roles.js';

/**
 * Keep one copy per championId (a champion is picked once per team). A
 * fixed-role copy wins over an unfixed one (an explicit role is stronger
 * evidence); otherwise the first copy is kept.
 */
export function dedupeTeamSlots(slots: ReadonlyArray<Slot>): Slot[] {
  const fixedIds = new Set<ChampionId>(
    slots.filter((s) => s.role !== undefined).map((s) => s.championId),
  );
  const seen = new Set<ChampionId>();
  return slots.filter((s) => {
    if (seen.has(s.championId)) return false;
    if (s.role === undefined && fixedIds.has(s.championId)) return false;
    seen.add(s.championId);
    return true;
  });
}

export interface ViableSubset {
  readonly source: ReadonlyArray<Slot>;
  readonly resolved: RoleAssignment | null;
}

/**
 * Greedily grow a resolvable subset: start from fixed slots, then add each
 * unfixed slot only if inference still succeeds with it included.
 */
export function resolveViableSubset(
  slots: ReadonlyArray<Slot>,
  roleProb: ChampionRoleProbabilities,
  excludedRoles: readonly Role[] = [],
): ViableSubset {
  let subset: Slot[] = slots.filter((s) => s.role !== undefined);
  let resolved: RoleAssignment | null =
    subset.length > 0 ? inferRoles(subset, roleProb, excludedRoles) : null;
  for (const s of slots) {
    if (s.role !== undefined) continue;
    const attempt = inferRoles([...subset, s], roleProb, excludedRoles);
    if (attempt) {
      subset = [...subset, s];
      resolved = attempt;
    }
  }
  return { source: subset, resolved };
}

/**
 * Last resort: keep only fixed slots (confidence 1). Fixed roles used more
 * than once are ambiguous (D-030) and dropped, so they cannot form a fake
 * complete lane or displace the real opponent.
 */
export function uniqueFixedSlots(slots: ReadonlyArray<Slot>, side: KnownSlot['side']): KnownSlot[] {
  const roleCounts = new Map<Role, number>();
  for (const s of slots) {
    if (s.role !== undefined) roleCounts.set(s.role, (roleCounts.get(s.role) ?? 0) + 1);
  }
  return slots
    .filter((s): s is Slot & { role: Role } => s.role !== undefined)
    .filter((s) => roleCounts.get(s.role) === 1)
    .map((s) => ({ championId: s.championId, role: s.role, side, confidence: 1, fixed: true }));
}
