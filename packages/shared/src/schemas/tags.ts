/**
 * @draftorb/shared — Champion tag schemas.
 *
 * Manual hand-written tags used for comp needs, cold-start priors, and explanations
 * (SPECS §6). Validated by `championTagsMapSchema` which enforces that each record
 * key matches the entry's `championId`.
 */

import { z } from 'zod';

import { championIdSchema, damageTypeSchema, championRangeSchema } from './core.js';

export const championTagsScalingSchema = z
  .object({
    early: z.boolean(),
    mid: z.boolean(),
    late: z.boolean(),
  })
  .strict();
export type ChampionTagsScaling = z.infer<typeof championTagsScalingSchema>;

export const championTagsSchema = z
  .object({
    championId: championIdSchema,
    damageType: damageTypeSchema,
    archetype: z.string().min(1),
    hardEngage: z.boolean(),
    peel: z.boolean(),
    poke: z.boolean(),
    waveclear: z.boolean(),
    scaling: championTagsScalingSchema,
    range: championRangeSchema,
    ccCount: z.number().int().nonnegative(),
    // Optional axes used by the lane-archetype pooling rules (D-095):
    // `mobility` = reliable dash/blink/self-peel; `burst` = meaningful burst window.
    // Absent means unknown — never guessed (SPECS §6, D-095).
    mobility: z.boolean().optional(),
    burst: z.boolean().optional(),
  })
  .strict();
export type ChampionTags = z.infer<typeof championTagsSchema>;

export const championTagsMapSchema = z
  .record(z.string(), championTagsSchema)
  .refine(
    (entries) => Object.entries(entries).every(([key, val]) => key === String(val.championId)),
    {
      message: 'Every record key in championTagsMap must match its championId',
    },
  );
export type ChampionTagsMap = z.infer<typeof championTagsMapSchema>;
