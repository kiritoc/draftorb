/**
 * @draftorb/engine — Team role resolution for the recommendation engine (T-023).
 */

import type { ChampionId, ChampionRoleProbabilities, Role, Slot } from '@draftorb/shared';

import { ROLES } from './config.js';
import type { Side } from './config.js';
import { inferRoles } from './roles.js';
import { roleProbability } from './roles-utils.js';

/** A draft slot with a resolved role and its §4 confidence. */
export interface KnownSlot {
  readonly championId: ChampionId;
  readonly role: Role;
  readonly confidence: number;
  readonly side: Side;
}

/** Champion id of the slot that reserves the user's role during ally inference. */
const USER_SENTINEL = -1;

/**
 * Resolve the roles of one team (SPECS §4). On the allied side, `reservedRole`
 * (the user's role) is never given to an ally (D-030).
 */
export function resolveTeam(
  slots: ReadonlyArray<Slot>,
  roleProb: ChampionRoleProbabilities,
  side: Side,
  reservedRole?: Role,
): KnownSlot[] {
  if (slots.length === 0) {
    return [];
  }
  // A sentinel slot fixed to the user's role keeps unknown allies off it.
  const reserve = reservedRole !== undefined && slots.length < 5;
  const inferred = reserve
    ? inferRoles([...slots, { championId: USER_SENTINEL, role: reservedRole }], {
        ...roleProb,
        [USER_SENTINEL]: { [reservedRole]: 1 },
      })
    : inferRoles(slots, roleProb);
  if (inferred) {
    return inferred.slots
      .filter((s) => !(reserve && s.championId === USER_SENTINEL))
      .map((s) => ({ ...s, side }));
  }
  // No valid assignment: drop only the unknown slots that cannot take any free
  // role (e.g. an ally who only plays the user's role), then retry, so other
  // inferable allies keep their pair and lane evidence.
  const taken = new Set<Role>(slots.flatMap((s) => (s.role !== undefined ? [s.role] : [])));
  if (reservedRole !== undefined) {
    taken.add(reservedRole);
  }
  const free = ROLES.filter((r) => !taken.has(r));
  const kept = slots.filter(
    (s) => s.role !== undefined || free.some((r) => roleProbability(roleProb, s.championId, r) > 0),
  );
  if (kept.length > 0 && kept.length < slots.length) {
    return resolveTeam(kept, roleProb, side, reservedRole);
  }
  // Still no valid assignment: keep only user-fixed roles (confidence 1).
  return slots.flatMap((s) =>
    s.role !== undefined ? [{ championId: s.championId, role: s.role, confidence: 1, side }] : [],
  );
}
