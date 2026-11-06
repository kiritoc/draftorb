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
});
