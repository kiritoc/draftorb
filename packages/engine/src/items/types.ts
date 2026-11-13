/**
 * @draftorb/engine — Items recommendation types (SPECS §8.2, T-125).
 *
 * Result shapes for `recommendItems`: ranked next-item picks with the
 * observational-data provenance (context level, n_eff, lowData flag) the UI
 * needs to phrase "players who bought X here won Y %" honestly, plus the
 * analytic fallback when no data level clears `minGames`.
 */

import type { ItemId } from '@draftorb/shared';

/** Where a pick's score came from. */
export type ItemPickSource = 'data' | 'analytic';

/** Back-off level that produced the pick (SPECS §8.2 step 7). */
export type ItemContextLevel =
  'laneExact' | 'laneArch' | 'profileStateTime' | 'profileTime' | 'timeOnly' | 'championSlot';

export interface ItemPick {
  readonly itemId: ItemId;
  /** Final score (data: shrunk WR delta vs context average; analytic: fight power). */
  readonly score: number;
  /** Observational win rate estimate when source === 'data' (shrunk). */
  readonly winRate?: number;
  /** Effective sample size behind the estimate (data source only). */
  readonly nEff?: number;
  /** True when nEff < minGames: show with the low-data caveat. */
  readonly lowData: boolean;
  /** Pick share inside the matched context (data source only). */
  readonly pickShare?: number;
  readonly source: ItemPickSource;
  readonly contextLevel?: ItemContextLevel;
  /** Human-readable reasons ("enemy team is AD-heavy", "behind -> durability"). */
  readonly reasons: readonly string[];
}

export interface ItemRecommendationResult {
  /** Next items to buy, best first (complete list; UI slices). */
  readonly picks: readonly ItemPick[];
  /** Items the model suggests avoiding right now, worst first (may be empty). */
  readonly avoid: readonly ItemPick[];
  /** False when neither data nor analytic scoring produced a usable list. */
  readonly dataAvailable: boolean;
  /** Slot index the picks are for (0 = starting items). */
  readonly slotIdx: number;
  /** Items already owned that were excluded from candidacy. */
  readonly alreadyOwned: readonly ItemId[];
}
