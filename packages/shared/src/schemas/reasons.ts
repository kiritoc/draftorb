/**
 * @draftorb/shared — Reason, reliability, and recommendation schemas.
 *
 * Defines the `Reason` type (with `with` as ChampionId[] per B-011, the `lane`
 * reason type, `lowData` flag, and `n_eff` as a real number), `Reliability`
 * (`nEff` = baseline n_eff), and `Recommendation` (with optional `poolRank` per D-024).
 *
 * `Reason.lowData` is a required boolean: the engine always emits it. It is
 * `true` when the reason's supporting term has `n_eff < minGames` (the term
 * contributes 0 to the score, SPECS §5); `false` otherwise — including for
 * non-data-driven reasons (e.g. `comp`) that carry no sample-size gate.
 */

import { z } from 'zod';

import { championIdSchema } from './core.js';
import { warningCodeSchema } from './codes.js';

export const reasonTypeSchema = z.enum(['synergy', 'counter', 'lane', 'comp', 'blind']);
export type ReasonType = z.infer<typeof reasonTypeSchema>;

export const reasonLevelSchema = z.union([
  z.literal(-3),
  z.literal(-2),
  z.literal(-1),
  z.literal(0), // lowData or |deltaPp| < 1pp: no badge (SPECS §5)
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);
export type ReasonLevel = z.infer<typeof reasonLevelSchema>;

export const reasonSchema = z
  .object({
    type: reasonTypeSchema,
    with: z.array(championIdSchema).optional(),
    level: reasonLevelSchema.optional(),
    deltaPp: z.number().optional(),
    n: z.number().nonnegative().optional(),
    lowData: z.boolean(),
  })
  .strict();
export type Reason = z.infer<typeof reasonSchema>;

export const reliabilitySchema = z
  .object({
    // Baseline effective sample size (real number, D-027), never a raw game count.
    nEff: z.number().nonnegative(),
    lowData: z.boolean(),
  })
  .strict();
export type Reliability = z.infer<typeof reliabilitySchema>;

export const recommendationSchema = z
  .object({
    championId: championIdSchema,
    score: z.number(),
    rank: z.number().int().positive(),
    poolRank: z.number().int().positive().optional(),
    reasons: z.array(reasonSchema),
    reliability: reliabilitySchema,
    warnings: z.array(warningCodeSchema),
  })
  .strict();
export type Recommendation = z.infer<typeof recommendationSchema>;
