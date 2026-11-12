/**
 * @draftorb/shared — Item and item-tag schemas.
 *
 * `itemSchema` / `itemsMapSchema` validate the Data Dragon item catalog.
 * `itemTagsSchema` / `itemTagsMapSchema` validate the hand-written
 * `data/manual/item-tags.json` (SPECS §6 / §8.2).
 *
 * Item build export schemas model `roles/<ROLE>/builds/<championId>.json`
 * (DATA_MODEL.md `item_build` table), with contexts driving the D-021 back-off
 * chain and `gamesW2` on every row for `n_eff`.
 */

import { z } from 'zod';

import { championIdSchema, itemIdSchema, roleSchema } from './core.js';

export const itemSchema = z
  .object({
    id: itemIdSchema,
    name: z.string().min(1),
    icon: z.string().min(1),
    goldTotal: z.number().int().nonnegative(),
    purchasable: z.boolean(),
    tags: z.array(z.string()).default([]),
    from: z.array(itemIdSchema).default([]),
    into: z.array(itemIdSchema).default([]),
    stats: z.record(z.string(), z.number()).default({}),
  })
  .strict();
export type Item = z.infer<typeof itemSchema>;

export const itemsMapSchema = z.record(z.string(), itemSchema);
export type ItemsMap = z.infer<typeof itemsMapSchema>;

export const itemTagsSchema = z
  .object({
    itemId: itemIdSchema,
    damageType: z.enum(['AD', 'AP', 'MIXED', 'NONE']).default('NONE'),
    armor: z.boolean().default(false),
    magicResist: z.boolean().default(false),
    health: z.boolean().default(false),
    antiHeal: z.boolean().default(false),
    antiShield: z.boolean().default(false),
    mana: z.boolean().default(false),
    support: z.boolean().default(false),
  })
  .strict();
export type ItemTags = z.infer<typeof itemTagsSchema>;

export const itemTagsMapSchema = z.record(z.string(), itemTagsSchema);
export type ItemTagsMap = z.infer<typeof itemTagsMapSchema>;

// --- Item build export schemas (DATA_MODEL.md item_build table) ---

export const itemBuildStateBucketSchema = z.enum(['ahead', 'even', 'behind']);
export type ItemBuildStateBucket = z.infer<typeof itemBuildStateBucketSchema>;

export const itemBuildProfileKeySchema = z.enum(['AD', 'AP', 'mixed', 'unknown']);
export type ItemBuildProfileKey = z.infer<typeof itemBuildProfileKeySchema>;

export const itemBuildEntrySchema = z
  .object({
    itemId: itemIdSchema,
    winsW: z.number().nonnegative(),
    gamesW: z.number().nonnegative(),
    gamesW2: z.number().nonnegative(),
    winrate: z.number().min(0).max(1),
    pickShare: z.number().min(0).max(1),
  })
  .strict();
export type ItemBuildEntry = z.infer<typeof itemBuildEntrySchema>;

export const itemBuildContextSchema = z
  .object({
    slotIdx: z.number().int().nonnegative(),
    timeBucket: z.string().min(1),
    stateBucket: itemBuildStateBucketSchema,
    profileKey: itemBuildProfileKeySchema,
    laneKey: z.string().optional(),
    /** Lane archetype backoff level (D-082/D-086): archetype of the most influential lane slot. */
    laneArch: z.string().optional(),
    items: z.array(itemBuildEntrySchema),
  })
  .strict();
export type ItemBuildContext = z.infer<typeof itemBuildContextSchema>;

export const itemBuildExportSchema = z
  .object({
    championId: championIdSchema,
    myRole: roleSchema,
    contexts: z.array(itemBuildContextSchema),
  })
  .strict();
export type ItemBuildExport = z.infer<typeof itemBuildExportSchema>;

// --- Item classes export (data/item-classes.generated.json + overrides) ---

export const itemClassNameSchema = z.enum([
  'starter',
  'quest_line',
  'quest_reward',
  'jungle_path',
  'component',
  'boots',
  'completed',
  'consumable',
  'excluded',
]);
export type ItemClassName = z.infer<typeof itemClassNameSchema>;

export const itemClassesExportSchema = z
  .object({
    patch: z.string().min(1),
    items: z.record(
      z.string(),
      z
        .object({
          cls: itemClassNameSchema,
          laneFamily: z.string().optional(),
        })
        .strict(),
    ),
  })
  .strict();
export type ItemClassesExport = z.infer<typeof itemClassesExportSchema>;

// --- State scale export (item_state_scale table) ---

export const stateScaleExportSchema = z
  .object({
    patch: z.string().min(1),
    buckets: z.array(
      z
        .object({
          timeBucket: z.string().min(1),
          sampleCount: z.number().int().nonnegative(),
          goldSd: z.number().positive(),
        })
        .strict(),
    ),
  })
  .strict();
export type StateScaleExport = z.infer<typeof stateScaleExportSchema>;
