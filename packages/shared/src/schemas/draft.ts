/**
 * @draftorb/shared — Draft input and result schemas.
 *
 * `DraftInput` is the user's partial draft knowledge (SPECS §2). `ChampionPool`
 * is the versioned browser-storage envelope for the user's personal pool (D-024).
 * `poolMaxSize` (default 40 per role) is enforced by `apps/web/src/config.ts`,
 * not by this schema. Each role's array rejects duplicate champion ids.
 * `DraftResult` carries the full recommendation ranking,
 * insufficient-data entries, and optional pool recommendations.
 */

import { z } from 'zod';

import { DRAFT_RESULT_SCHEMA_VERSION, championIdSchema, rankSchema, roleSchema } from './core.js';
import { recommendationSchema } from './reasons.js';

export const slotSchema = z
  .object({
    championId: championIdSchema,
    role: roleSchema.optional(),
  })
  .strict();
export type Slot = z.infer<typeof slotSchema>;

export const draftInputSchema = z
  .object({
    userRank: rankSchema,
    userRole: roleSchema,
    allies: z.array(slotSchema).max(4),
    enemies: z.array(slotSchema).max(5),
    blindPick: z.boolean(),
    pool: z.array(championIdSchema).optional(),
  })
  .strict();
export type DraftInput = z.infer<typeof draftInputSchema>;

const poolChampionsSchema = z
  .array(championIdSchema)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: 'duplicate champion ids are not allowed in a role pool',
  });

export const championPoolSchema = z
  .object({
    version: z.literal(1),
    pools: z.partialRecord(roleSchema, poolChampionsSchema),
  })
  .strict();
export type ChampionPool = z.infer<typeof championPoolSchema>;

export const insufficientDataEntrySchema = z
  .object({
    championId: championIdSchema,
    nEff: z.number().nonnegative(),
    // Omitted when the raw match count is unknown (golden rule 8, B-025).
    rawGames: z.number().int().nonnegative().optional(),
    // Baseline win rate fraction (`p0`, SPECS §5) for the user's rank bucket.
    // Present only when the baseline row has weighted evidence; omitted for
    // missing or empty baseline rows so no prior-only 50% is invented.
    winRate: z.number().min(0).max(1).optional(),
  })
  .strict();
export type InsufficientDataEntry = z.infer<typeof insufficientDataEntrySchema>;

export const poolUnavailableEntrySchema = z
  .object({
    championId: championIdSchema,
    reason: z.enum(['insufficientData', 'unknownChampion', 'picked']),
  })
  .strict();
export type PoolUnavailableEntry = z.infer<typeof poolUnavailableEntrySchema>;

export const draftResultSchema = z
  .object({
    schemaVersion: z.literal(DRAFT_RESULT_SCHEMA_VERSION),
    recommendations: z.array(recommendationSchema),
    insufficientData: z.array(insufficientDataEntrySchema),
    poolRecommendations: z.array(recommendationSchema).optional(),
    poolUnavailable: z.array(poolUnavailableEntrySchema).optional(),
  })
  .strict();
export type DraftResult = z.infer<typeof draftResultSchema>;
