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

import { championIdSchema, rankSchema, roleSchema } from './core.js';
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
    rawGames: z.number().int().nonnegative(),
  })
  .strict();
export type InsufficientDataEntry = z.infer<typeof insufficientDataEntrySchema>;

export const poolUnavailableEntrySchema = z
  .object({
    championId: championIdSchema,
    reason: z.enum(['insufficientData', 'unknownChampion']),
  })
  .strict();
export type PoolUnavailableEntry = z.infer<typeof poolUnavailableEntrySchema>;

export const draftResultSchema = z
  .object({
    recommendations: z.array(recommendationSchema),
    insufficientData: z.array(insufficientDataEntrySchema),
    poolRecommendations: z.array(recommendationSchema).optional(),
    poolUnavailable: z.array(poolUnavailableEntrySchema).optional(),
  })
  .strict();
export type DraftResult = z.infer<typeof draftResultSchema>;
