/**
 * Draft handoff from the pick screen to the setup screen (BL-058, D-138).
 *
 * The pick screen keeps its draft state mounted while hidden, so it reports
 * the locked champion and the full `DraftInput` (allies/enemies slots, bans,
 * pool, rank, role) upward through `AppShell`. The setup screen reuses them
 * as the champion prefill and as the draft context of its rune/summoner/
 * starter queries, so expert pages can resolve at the lane/matchup levels
 * instead of only `damagemix:`/`global` — every page keeps its D-103
 * `source`/`sourceLevel` label. A new-game reset remounts the pick screen,
 * which reports a fresh empty handoff and clears the prefill again.
 */

import type { ChampionId, DraftInput, Rank, Role } from '@draftorb/shared';

export interface DraftHandoff {
  /** Champion locked in the pick screen's user slot; null when unset. */
  readonly championId: ChampionId | null;
  /** The pick screen's draft input (slots, bans, pool, rank, role). */
  readonly draft: DraftInput;
}

/**
 * Builds the setup screen's `DraftInput` from the handoff: the screen's own
 * role/rank stay authoritative (the user can still change them), while the
 * draft slots, bans and pool come from the pick screen. Without a handoff
 * the slots stay empty, exactly like the pre-BL-058 behavior.
 */
export function setupDraftInput(
  handoff: DraftHandoff | undefined,
  userRole: Role,
  userRank: Rank,
): DraftInput {
  const shared = handoff?.draft;
  return {
    userRank,
    userRole,
    allies: shared?.allies ?? [],
    enemies: shared?.enemies ?? [],
    blindPick: false,
    ...(shared?.bans !== undefined ? { bans: shared.bans } : {}),
    ...(shared?.pool !== undefined ? { pool: shared.pool } : {}),
  };
}
