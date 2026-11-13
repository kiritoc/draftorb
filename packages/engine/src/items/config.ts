/**
 * @draftorb/engine — Item-recommendation config (SPECS §8.2, T-125).
 *
 * Priors until the D-023 backtest calibrates them. `stateBucketMode` selects
 * the D-085 time-normalized bucketing (`timeNormalized` reads goldSd from
 * `state-scale.json`; `legacyAbsolute` keeps the fixed thresholds).
 */

import type { StateBucketMode } from '../item-context.js';

export interface ItemsConfig {
  /** D-085: `timeNormalized` divides gold diff by the per-time-bucket SD. */
  readonly stateBucketMode: StateBucketMode;
  /** Minimum n_eff for the data layer to replace the analytic score. */
  readonly minGames: number;
  /** Shrinkage prior strength (equivalent games) toward the context average. */
  readonly kItem: number;
  /** Number of picks returned. */
  readonly topItems: number;
  /** Number of `avoid` entries returned. */
  readonly avoidItems: number;
  /** Analytic fight-power fallback when no data level clears minGames. */
  readonly analyticEnabled: boolean;
  /** Weight of the fed-enemy threat in defensive-stat valuation. */
  readonly fedDefenseWeight: number;
  /** Bonus multiplier applied to resists/HP when the team is behind. */
  readonly behindDefenseMult: number;
  /** Bonus multiplier applied to damage stats when the team is ahead. */
  readonly aheadDamageMult: number;
}

export const DEFAULT_ITEMS_CONFIG: ItemsConfig = Object.freeze({
  stateBucketMode: 'legacyAbsolute',
  minGames: 25,
  kItem: 40,
  topItems: 3,
  avoidItems: 3,
  analyticEnabled: true,
  fedDefenseWeight: 0.5,
  behindDefenseMult: 1.5,
  aheadDamageMult: 1.25,
});
