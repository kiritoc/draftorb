/**
 * @draftorb/shared — Core primitives, enums, and constants.
 *
 * Fundamental schemas shared across all domain modules: champion/item IDs,
 * roles, raw ranks, rank buckets (SPECS §3), damage types, and ranges.
 */

import { z } from 'zod';

export { z };

export const SHARED_VERSION = '0.0.1' as const;

/**
 * Agreed schema version for the exported JSON layout (DATA_MODEL.md §Exported JSON).
 * Bumped on every export format change. v2: 6th baseline column `games` (T-023, B-025).
 * v3: rune contexts retain their source `rankBucket` (T-019 review).
 */
export const MANIFEST_SCHEMA_VERSION = 3;

/**
 * Version of the engine output contract (`DraftResult`, SPECS §7). Bumped on every
 * breaking change so consumers fail loudly instead of misreading fields.
 * v1: `reliability.nEff`, optional `rawGames`, `picked` pool reason, level 0 (D-030).
 */
export const DRAFT_RESULT_SCHEMA_VERSION = 1;

/**
 * Version of the engine rune-recommendation output contract (SPECS §8.1).
 * Bumped on every breaking change so consumers fail loudly instead of
 * misreading fields.
 * v1: initial `RuneRecommendationResult` (T-040).
 */
export const RUNE_RESULT_SCHEMA_VERSION = 1;

export const roleSchema = z.enum(['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT']);
export type Role = z.infer<typeof roleSchema>;

export const rankSchema = z.enum([
  'IRON',
  'BRONZE',
  'SILVER',
  'GOLD',
  'PLATINUM',
  'EMERALD',
  'DIAMOND',
  'MASTER',
  'GRANDMASTER',
  'CHALLENGER',
]);
export type Rank = z.infer<typeof rankSchema>;

export const rankBucketSchema = z.enum([
  'IRON',
  'BRONZE',
  'SILVER',
  'GOLD',
  'PLATINUM',
  'EMERALD',
  'DIAMOND',
  'MASTER_PLUS',
]);
export type RankBucket = z.infer<typeof rankBucketSchema>;

export const championIdSchema = z.number().int().positive();
export type ChampionId = z.infer<typeof championIdSchema>;

export const itemIdSchema = z.number().int().positive();
export type ItemId = z.infer<typeof itemIdSchema>;

export const damageTypeSchema = z.enum(['AD', 'AP', 'MIXED', 'NONE']);
export type DamageType = z.infer<typeof damageTypeSchema>;

export const championRangeSchema = z.enum(['MELEE', 'RANGED']);
export type ChampionRange = z.infer<typeof championRangeSchema>;
