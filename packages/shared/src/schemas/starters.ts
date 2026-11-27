/**
 * @draftorb/shared — Starter-bundle export schemas (BL-031a, D-086 bundle
 * half accepted via D-134).
 *
 * Two file shapes share the same context entry:
 *  - `roles/<ROLE>/starters/<championId>.json` — champion-scoped contexts
 *    (`lane:<slots>` exact lane, then `champion`).
 *  - `roles/<ROLE>/starters.json` — role-scoped fallbacks (`role`, then
 *    `global`, the cross-role level with `myRole: null`).
 *
 * A bundle is the net set of items purchased within `starterWindowSeconds`
 * of game start (engine `starterBundleKey`, undo/sold/rebuy netted). Every
 * row carries `gamesW2` for `n_eff`, separate `winrate`/`pickShare` and the
 * D-102 distinct-player count `players`.
 */

import { z } from 'zod';

import { championIdSchema, itemIdSchema, rankBucketSchema, roleSchema } from './core.js';

// --- Starter export schemas (starter_ctx table) ---

/** One item inside a starter bundle with its net purchased count. */
export const starterBundleItemSchema = z
  .object({
    itemId: itemIdSchema,
    count: z.number().int().positive(),
  })
  .strict();
export type StarterBundleItem = z.infer<typeof starterBundleItemSchema>;

/** One bundle with its weighted evidence (D-102 fields). */
export const starterBundlePickSchema = z
  .object({
    /** Sorted by itemId; the `starterBundleKey` "itemId:count" grouping. */
    items: z.array(starterBundleItemSchema).min(1),
    winsW: z.number().nonnegative(),
    gamesW: z.number().nonnegative(),
    gamesW2: z.number().nonnegative(),
    winrate: z.number().min(0).max(1),
    pickShare: z.number().min(0).max(1),
    players: z.number().int().nonnegative().optional(),
  })
  .strict();
export type StarterBundlePick = z.infer<typeof starterBundlePickSchema>;

export const starterContextEntrySchema = z
  .object({
    rankBucket: rankBucketSchema,
    /** `lane:<slots>` | `champion` | `role` | `global`. */
    contextKey: z.string().min(1),
    /** 1 lane, 2 champion, 3 role, 4 global (STARTER_CONTEXT_LEVELS). */
    contextLevel: z.number().int().nonnegative(),
    bundles: z.array(starterBundlePickSchema),
  })
  .strict();
export type StarterContextEntry = z.infer<typeof starterContextEntrySchema>;

/** `roles/<ROLE>/starters/<championId>.json`. */
export const starterChampionExportSchema = z
  .object({
    championId: championIdSchema,
    myRole: roleSchema,
    contexts: z.array(starterContextEntrySchema),
  })
  .strict();
export type StarterChampionExport = z.infer<typeof starterChampionExportSchema>;

/** `roles/<ROLE>/starters.json` — role + global fallbacks. */
export const starterRoleExportSchema = z
  .object({
    myRole: roleSchema,
    contexts: z.array(starterContextEntrySchema),
  })
  .strict();
export type StarterRoleExport = z.infer<typeof starterRoleExportSchema>;
