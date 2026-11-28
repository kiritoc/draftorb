/**
 * @draftorb/engine — Per-role matchup contexts (BL-056, D-135 follow-up).
 *
 * Pure, deterministic. The profile setup fallback (`recommendProfileRunes` /
 * `recommendProfileSpells`, SPECS §18.5) matches the draft context against
 * the profile's own games at levels L1..L3 before widening to the champion
 * levels L4/L5. D-135 recorded that the original predicates were
 * Support-shaped for every role (ally ADC id + enemy support id); this
 * module defines the per-role slot specs so TOP and JUNGLE drafts match
 * their own lane contexts instead of falling through to champion level.
 *
 * A spec lists the `(side, role)` slots each level requires. L1 is the
 * narrowest matchup context (every `l1` slot must match); L2 is the wider
 * lane-opponent context (every `l2` slot must match) and is always a
 * subset of `l1`, so an L1 match is also an L2 match. L3 (enemy
 * `damageType:archetype` signature) and L4/L5 (champion levels) are
 * unchanged and live in `profile-setup.ts`.
 *
 * The same spec type is the shared lane-context definition BL-058 (draft
 * handoff) can reuse: resolve the slots against any `(side, role) ->
 * championId | null` lookup — draft slots on one side, profile games on
 * the other.
 *
 * No DOM, no Node APIs, no network, no file I/O, no randomness.
 */

import type { Role } from '@draftorb/shared';

/** Team side a matchup slot belongs to. */
export type MatchupSide = 'ally' | 'enemy';

/** One matchup slot: the champion playing `role` on `side`. */
export interface MatchupSlotRef {
  readonly side: MatchupSide;
  readonly role: Role;
}

/**
 * Per-role matchup slot spec for the profile fallback levels L1/L2.
 * Invariant: every `l2` slot also appears in `l1` (L2 widens L1).
 */
export interface RoleMatchupSpec {
  /** Slots that must all match for L1 (most specific matchup context). */
  readonly l1: readonly MatchupSlotRef[];
  /** Slots that must all match for L2 (lane-opponent context). */
  readonly l2: readonly MatchupSlotRef[];
}

const ally = (role: Role): MatchupSlotRef => ({ side: 'ally', role });
const enemy = (role: Role): MatchupSlotRef => ({ side: 'enemy', role });

/**
 * Per-role matchup specs for the in-scope roles (D-097/D-136). Out-of-scope
 * roles (ADC/MID) return null: their games never enter the pool anyway.
 *
 * - SUPPORT: the bot-lane duo — ally ADC partner + enemy support opponent
 *   at L1, enemy support alone at L2 (identical to the pre-BL-056
 *   Support-shaped predicates).
 * - TOP: the top-lane opponent (enemy TOP) at L2; L1 adds the enemy
 *   JUNGLE, the role that most shapes the top lane through ganks and
 *   roams. The profile export stores no ally-side ids beyond the ADC, so
 *   the spec is enemy-side only.
 * - JUNGLE: no lane opponent exists; the jungle matchup is the enemy
 *   JUNGLE (mirror matchup) at L2, and L1 adds the enemy MID — the
 *   canonical jungle duo laner (level-2 ganks, roam routes). This pairing
 *   is an implementation assumption pending owner confirmation (PROPOSED,
 *   see the BL-056 report).
 */
export function roleMatchupSpec(role: Role): RoleMatchupSpec | null {
  switch (role) {
    case 'SUPPORT':
      return {
        l1: [ally('ADC'), enemy('SUPPORT')],
        l2: [enemy('SUPPORT')],
      };
    case 'TOP':
      return {
        l1: [enemy('TOP'), enemy('JUNGLE')],
        l2: [enemy('TOP')],
      };
    case 'JUNGLE':
      return {
        l1: [enemy('JUNGLE'), enemy('MID')],
        l2: [enemy('JUNGLE')],
      };
    default:
      return null;
  }
}

/**
 * Lookup resolving a `(side, role)` slot to a champion id; `null` when the
 * side/role is unknown (undrafted slot, role not stored in the profile
 * export, failed role inference).
 */
export type MatchupIdLookup = (side: MatchupSide, role: Role) => number | null;

/** A spec resolved to concrete champion-id requirements (`null` = unknown). */
export interface ResolvedMatchup {
  readonly l1: readonly (number | null)[];
  readonly l2: readonly (number | null)[];
}

/** Resolve every slot of the spec through `lookup`, preserving order. */
export function resolveMatchupSpec(
  spec: RoleMatchupSpec,
  lookup: MatchupIdLookup,
): ResolvedMatchup {
  return {
    l1: spec.l1.map((ref) => lookup(ref.side, ref.role)),
    l2: spec.l2.map((ref) => lookup(ref.side, ref.role)),
  };
}

/**
 * Whether `actual` satisfies `required`: every required id must be known
 * (non-null — an unknown context slot disables the level, D-075-style
 * honesty) and equal to the actual id. `actual` entries may be null; they
 * simply never match a known requirement.
 */
export function matchupIdsMatch(
  required: readonly (number | null)[],
  actual: readonly (number | null)[],
): boolean {
  for (let i = 0; i < required.length; i += 1) {
    const id = required[i];
    if (id === null || id === undefined || actual[i] !== id) return false;
  }
  return true;
}
