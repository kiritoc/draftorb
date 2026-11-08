/**
 * @draftorb/shared — Personalized-list output schemas (D-072/D-080, SPECS §18.2).
 *
 * Mirrors the engine's `PersonalizeResult`: one entry per overall-list
 * champion with the shrunk profile win rate, fallback level and the
 * optional rank-bucket baseline comparison (`deltaVsBaselinePp`, D-080).
 * The baseline fields are null whenever the champion's baseline row has no
 * weighted evidence or fails the baseline gate — a prior-only 50% is never
 * reported.
 */

import { z } from 'zod';

import { PERSONAL_RESULT_SCHEMA_VERSION, championIdSchema, rankBucketSchema } from './core.js';

export const personalizedEntrySchema = z
  .object({
    championId: championIdSchema,
    /** 1-based position in the personalized list. */
    rank: z.number().int().positive(),
    /** Rank in the unchanged overall list (tie-break + meta reference). */
    overallRank: z.number().int().positive(),
    /** Unchanged meta `score(c)` of the input recommendation. */
    metaScore: z.number(),
    /** `(1 - trust) * metaNorm + trust * p`; metaNorm-only when insufficient. */
    personalizedScore: z.number(),
    /** Shrunk profile win rate (fraction); null when data is insufficient. */
    profileWinRate: z.number().min(0).max(1).nullable(),
    /** Effective sample size at the matched fallback level. */
    nEff: z.number().nonnegative(),
    /** Fallback level that supplied the estimate; null when insufficient. */
    fallbackLevel: z
      .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
      .nullable(),
    /** `round(100 * (p - w0))` pp vs the rank-bucket baseline (D-080). */
    deltaVsBaselinePp: z.number().int().nullable(),
    /** Baseline win rate `w0` (fraction) for `baselineBucket`; null when omitted. */
    baselineWinRate: z.number().min(0).max(1).nullable(),
    /** Rank bucket the baseline was read for; null when `baselineWinRate` is. */
    baselineBucket: rankBucketSchema.nullable(),
    /** True when no fallback level reached `minGames` (D-075). */
    insufficientData: z.boolean(),
  })
  .strict();
export type PersonalizedEntry = z.infer<typeof personalizedEntrySchema>;

export const personalizedResultSchema = z
  .object({
    schemaVersion: z.literal(PERSONAL_RESULT_SCHEMA_VERSION),
    entries: z.array(personalizedEntrySchema),
  })
  .strict();
export type PersonalizedResult = z.infer<typeof personalizedResultSchema>;
