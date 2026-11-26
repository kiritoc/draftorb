/**
 * Enemy role inference view model (BL-015, SPECS §4).
 *
 * Wraps the engine's `resolveKnownSlots` — the same resolver `recommend`
 * uses — so the pick screen shows the role and confidence that actually
 * affect scoring. A manually chosen role is an override with confidence 1.
 */

import { resolveKnownSlots } from '@draftorb/engine';
import type { ChampionId, ChampionRoleProbabilities, Role, Slot } from '@draftorb/shared';

/** A draft slot that may still be empty (`championId: null`). */
export type EnemyRoleSlot = Omit<Slot, 'championId'> & {
  readonly championId: ChampionId | null;
};

export type EnemyRoleSource = 'manual' | 'inferred' | 'unresolved';

export interface EnemyRoleView {
  readonly championId: ChampionId;
  readonly source: EnemyRoleSource;
  readonly role: Role | null;
  readonly confidence: number | null;
}

/**
 * Returns one view per input slot (`null` for empty slots), aligned by index.
 * Manual roles are reported with confidence 1 only when the engine keeps them;
 * slots the engine drops (missing probabilities, ambiguous fixed roles) stay
 * `unresolved`.
 */
export function enemyRoleViews(
  slots: readonly EnemyRoleSlot[],
  roleProb: ChampionRoleProbabilities,
): readonly (EnemyRoleView | null)[] {
  const filled = slots.filter(
    (slot): slot is EnemyRoleSlot & { championId: ChampionId } => slot.championId !== null,
  );
  const resolved = resolveKnownSlots(
    filled.map((slot) =>
      slot.role === undefined ? { championId: slot.championId } : { ...slot, role: slot.role },
    ),
    'enemy',
    roleProb,
  );
  const byChampion = new Map(resolved.map((slot) => [slot.championId, slot]));

  return slots.map((slot) => {
    if (slot.championId === null) return null;
    const unresolved: EnemyRoleView = {
      championId: slot.championId,
      source: 'unresolved',
      role: null,
      confidence: null,
    };
    const known = byChampion.get(slot.championId);
    if (known === undefined) return unresolved;
    if (slot.role !== undefined) {
      return known.fixed && known.role === slot.role
        ? {
            championId: slot.championId,
            source: 'manual',
            role: known.role,
            confidence: known.confidence,
          }
        : unresolved;
    }
    return {
      championId: slot.championId,
      source: 'inferred',
      role: known.role,
      confidence: known.confidence,
    };
  });
}

/** Formats an engine confidence fraction for display (0.705 -> "71%"). */
export function formatRoleConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}
