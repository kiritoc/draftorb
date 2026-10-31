/**
 * @draftorb/shared — Aggregated table row schemas.
 *
 * Two families of schemas:
 *  1. `supportPair*` / `supportBaseline*` — legacy object/tuple schemas used in
 *     tests and internal code. Updated to use `rankBucketSchema` (8 buckets,
 *     SPECS §3) and include `gamesW2` for `n_eff` computation.
 *  2. Role-keyed export entry/table schemas — tuple formats for
 *     `roles/<ROLE>/{baseline,ally-pairs,enemy-pairs,lane-vs,lane-full}.json`
 *     (DATA_MODEL.md). Every row carries `gamesW2 = sum(w^2)` for `n_eff`.
 *
 * In `laneVs` and `laneFull`, nullable champion-id slots (`null`) represent
 * 1v1 lane groups (TOP, MID, JUNGLE) where an ally partner or second enemy
 * does not exist.
 */

import { z } from 'zod';

import { championIdSchema, rankBucketSchema, roleSchema } from './core.js';

const WEIGHTS = [
  z.number().nonnegative(), // wins_w
  z.number().nonnegative(), // games_w
  z.number().nonnegative(), // games_w2
] as const;

// --- Legacy support-specific schemas (updated: rankBucket + gamesW2) ---

export const supportBaselineEntrySchema = z
  .object({
    championId: championIdSchema,
    rankBucket: rankBucketSchema,
    winsWeighted: z.number().nonnegative(),
    gamesWeighted: z.number().nonnegative(),
    gamesW2: z.number().nonnegative(),
  })
  .strict();
export type SupportBaselineEntry = z.infer<typeof supportBaselineEntrySchema>;

export const supportBaselineTableSchema = z.array(supportBaselineEntrySchema);
export type SupportBaselineTable = z.infer<typeof supportBaselineTableSchema>;

export const supportPairEntrySchema = z.tuple([
  championIdSchema,
  championIdSchema,
  roleSchema,
  rankBucketSchema,
  z.number().nonnegative(), // winsWeighted
  z.number().nonnegative(), // gamesWeighted
  z.number().nonnegative(), // gamesW2
]);
export type SupportPairEntry = z.infer<typeof supportPairEntrySchema>;

export const supportPairTableSchema = z.array(supportPairEntrySchema);
export type SupportPairTable = z.infer<typeof supportPairTableSchema>;

// --- Role-keyed export schemas (DATA_MODEL.md) ---

/**
 * Baseline row: `[championId, bucket, wins_w, games_w, games_w2, games]`.
 * `games` is the raw (unweighted) match count, reported as `rawGames` in
 * `insufficientData`.
 */
export const baselineEntrySchema = z.tuple([
  championIdSchema,
  rankBucketSchema,
  ...WEIGHTS,
  z.number().int().nonnegative(), // games (raw match count)
]);
export type BaselineEntry = z.infer<typeof baselineEntrySchema>;

export const baselineTableSchema = z.array(baselineEntrySchema);
export type BaselineTable = z.infer<typeof baselineTableSchema>;

export const allyPairEntrySchema = z.tuple([
  championIdSchema,
  championIdSchema, // allyId
  roleSchema,
  rankBucketSchema,
  ...WEIGHTS,
]);
export type AllyPairEntry = z.infer<typeof allyPairEntrySchema>;

export const allyPairTableSchema = z.array(allyPairEntrySchema);
export type AllyPairTable = z.infer<typeof allyPairTableSchema>;

export const enemyPairEntrySchema = z.tuple([
  championIdSchema,
  championIdSchema, // enemyId
  roleSchema,
  rankBucketSchema,
  ...WEIGHTS,
]);
export type EnemyPairEntry = z.infer<typeof enemyPairEntrySchema>;

export const enemyPairTableSchema = z.array(enemyPairEntrySchema);
export type EnemyPairTable = z.infer<typeof enemyPairTableSchema>;

export const laneVsEntrySchema = z.tuple([
  championIdSchema,
  championIdSchema, // opp1Id
  championIdSchema.nullable(), // opp2Id (null for 1v1 lane groups)
  rankBucketSchema,
  ...WEIGHTS,
]);
export type LaneVsEntry = z.infer<typeof laneVsEntrySchema>;

export const laneVsTableSchema = z.array(laneVsEntrySchema);
export type LaneVsTable = z.infer<typeof laneVsTableSchema>;

export const laneFullEntrySchema = z.tuple([
  championIdSchema,
  championIdSchema.nullable(), // partnerId (null for 1v1 lane groups)
  championIdSchema, // opp1Id
  championIdSchema.nullable(), // opp2Id (null for 1v1 lane groups)
  rankBucketSchema,
  ...WEIGHTS,
]);
export type LaneFullEntry = z.infer<typeof laneFullEntrySchema>;

export const laneFullTableSchema = z.array(laneFullEntrySchema);
export type LaneFullTable = z.infer<typeof laneFullTableSchema>;
