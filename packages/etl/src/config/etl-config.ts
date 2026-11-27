/**
 * @draftorb/etl — ETL-level configuration (D-044/D-045/D-047).
 *
 * camelCase names per the D-045 consequence note; engine scoring parameters
 * stay in `@draftorb/engine` config. Values are priors until the D-023 gate.
 */

export const ETL_CONFIG = Object.freeze({
  /**
   * Raw matches/participants/item_events are kept for the last N patches
   * (SPECS §13). `pnpm etl prune` defaults `--keep-patches` to this; the
   * default ingestion window is `patch_index >= latest - retentionPatches + 1`.
   */
  retentionPatches: 20,

  /**
   * Change weighting (SPECS §14, D-045): OFF by default; enabled only after
   * T-027.a passes the D-023 gate. Neutral weights (1.0) while disabled.
   */
  changeWeightEnabled: false,
  /**
   * Floor for combined change/breakpoint weights (SPECS §14/§16); `reset`
   * breakpoints are 0 and bypass the floor. Prior until the D-023 gate.
   */
  minWeight: 0.05,

  /**
   * Configured-profile sync/export knobs (T-091, D-069/D-074, SPECS §18).
   * All priors until real profile volumes are known.
   */
  /** Recency half-life in days for profile win-rate weights (SPECS §18.2). */
  profileHalfLifeDays: 60,
  /** Export keeps at most the last N days of profile games (D-069). */
  profileMaxAgeDays: 180,
  /** Default per-profile export cap when `options.profileMaxGames` is unset. */
  profileDefaultMaxGames: 500,
  /** Favorites: recency-weighted Support games window (D-074). */
  profileFavRecencyDays: 90,
  profileFavRecencyCount: 15,
  profileFavMasteryCount: 5,
  /** Max new profile games fetched per profile per sync run (resumable). */
  profileSyncMaxGames: 200,

  /**
   * Draft-backtest gate knobs (D-023, BL-014). Priors pending owner
   * confirmation; `pnpm etl backtest draft` reports both resampling units
   * (`match` is the gate unit, `player` is informational).
   */
  backtest: Object.freeze({
    /** Paired-bootstrap resamples per unit (D-023 `bootstrapResamples`). */
    bootstrapResamples: 1000,
    /** Two-sided confidence level for the gate interval. */
    confidenceLevel: 0.95,
    /** Minimum mean log-loss improvement (baseline − engine) to pass. */
    logLossTolerance: 0,
    /**
     * Minimum distinct evaluated holdout matches before the gate can pass —
     * below it the bootstrap only resamples the same matches. Prior pending
     * owner confirmation like the other gate thresholds.
     */
    minHoldoutMatches: 30,
    /**
     * D-129 `matchupShrinkK` candidates tried on the last training patch
     * (train-only selection); 'off' (matchup layers disabled) is always
     * evaluated first as the baseline candidate.
     */
    matchupShrinkKGrid: Object.freeze([0, 25, 50, 100, 200, 400]),
  }),
});
