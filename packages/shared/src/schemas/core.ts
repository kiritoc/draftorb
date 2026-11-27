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
 * v5: manifest gains `minimalRoles` (ADC/MID baseline-only exports, BL-024).
 * v6: item build entries gain `players` (D-102 evidence rule, BL-013a).
 * v7: `pick-rate-samples.json` export added (pick-share denominators,
 * BL-052); merges the BL-013a v6 shape so both features ship together.
 * v8: `roles/<ROLE>/summoners/<championId>.json`, `roles/<ROLE>/starters/`
 * and `roles/<ROLE>/starters.json` exports added (BL-031a).
 */
export const MANIFEST_SCHEMA_VERSION = 8;

/**
 * Version of the engine output contract (`DraftResult`, SPECS §7). Bumped on every
 * breaking change so consumers fail loudly instead of misreading fields.
 * v1: `reliability.nEff`, optional `rawGames`, `picked` pool reason, level 0 (D-030).
 * v2: `banned` pool reason (D-106, BL-012).
 */
export const DRAFT_RESULT_SCHEMA_VERSION = 2;

/**
 * Version of the engine rune-recommendation output contract (SPECS §8.1).
 * Bumped on every breaking change so consumers fail loudly instead of
 * misreading fields.
 * v1: initial `RuneRecommendationResult` (T-040).
 */
export const RUNE_RESULT_SCHEMA_VERSION = 1;

/**
 * Version of the engine summoner-recommendation output contract (SPECS §8.1,
 * BL-031a). Bumped on every breaking change so consumers fail loudly instead
 * of misreading fields.
 * v1: initial `SummonerRecommendationResult`.
 */
export const SUMMONER_RESULT_SCHEMA_VERSION = 1;

/**
 * Version of the engine starter-bundle recommendation output contract
 * (SPECS §8.3/§18.5, BL-031b). Bumped on every breaking change so consumers
 * fail loudly instead of misreading fields.
 * v1: initial `StarterRecommendationResult`.
 */
export const STARTER_RESULT_SCHEMA_VERSION = 1;

/**
 * Version of `data/profiles.config.json` (D-068). Bumped on every breaking
 * change to the committed profile configuration format.
 */
export const PROFILE_CONFIG_SCHEMA_VERSION = 1;

/**
 * Version of the exported profile JSON under `data/public/profiles/`
 * (`<id>.json` and `index.json`, D-069). Bumped on every breaking change.
 */
export const PROFILE_EXPORT_SCHEMA_VERSION = 1;

/**
 * Version of the engine personalization output contract (`PersonalizedResult`,
 * SPECS §18.2). Bumped on every breaking change so consumers fail loudly
 * instead of misreading fields.
 * v1: initial `personalize` output (T-095).
 * v2: `deltaVsMetaPp` replaced by the D-080 rank-bucket baseline comparison
 * (`deltaVsBaselinePp`, `baselineWinRate`, `baselineBucket`).
 */
export const PERSONAL_RESULT_SCHEMA_VERSION = 2;

/**
 * Version of the engine setup-screen rune output contract
 * (`SetupRuneResult`, SPECS §18.5, BL-030a). Bumped on every breaking change
 * so consumers fail loudly instead of misreading fields.
 * v1: initial mode-switched rune setup result (top players / my data).
 */
export const SETUP_RESULT_SCHEMA_VERSION = 1;

/**
 * Version of the engine setup-screen summoner-spell output contract
 * (`SetupSpellsResult`, SPECS §18.5, BL-031b). Bumped on every breaking
 * change so consumers fail loudly instead of misreading fields.
 * v1: initial mode-switched summoner setup result (top players / my data).
 */
export const SETUP_SPELLS_RESULT_SCHEMA_VERSION = 1;

/**
 * Version of the engine setup-screen starter-item output contract
 * (`SetupStartersResult`, SPECS §18.5, BL-031b). Bumped on every breaking
 * change so consumers fail loudly instead of misreading fields.
 * v1: initial mode-switched starter setup result (top players / my data).
 */
export const SETUP_STARTERS_RESULT_SCHEMA_VERSION = 1;

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
