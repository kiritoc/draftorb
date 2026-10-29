/**
 * @draftorb/shared — Rune and rune-page schemas.
 *
 * `runeTreeSchema` / `runeTreesSchema` validate the Data Dragon `runesReforged`
 * static catalog (champion select icons + descriptions).
 * `runePageSchema` validates aggregated rune pages from the `rune_ctx` table.
 *
 * Rune export schemas model `roles/<ROLE>/runes/<championId>.json`
 * (DATA_MODEL.md): contexts (D-021 back-off chain) -> top pages by shrunk win
 * rate, each row carrying `gamesW2` for `n_eff` (SPECS §8.1).
 */

import { z } from 'zod';

import { championIdSchema, roleSchema } from './core.js';

export const runePerkSchema = z
  .object({
    id: z.number().int().positive(),
    key: z.string().min(1).optional(),
    name: z.string().min(1),
    icon: z.string().min(1),
    shortDesc: z.string().optional(),
  })
  .strict();
export type RunePerk = z.infer<typeof runePerkSchema>;

export const runeTreeSchema = z
  .object({
    id: z.number().int().positive(),
    key: z.string().min(1),
    icon: z.string().min(1),
    name: z.string().min(1),
    slots: z.array(
      z
        .object({
          runes: z.array(runePerkSchema),
        })
        .strict(),
    ),
  })
  .strict();
export type RuneTree = z.infer<typeof runeTreeSchema>;

export const runeTreesSchema = z.array(runeTreeSchema);
export type RuneTrees = z.infer<typeof runeTreesSchema>;

export const runePageSchema = z
  .object({
    primaryStyleId: z.number().int().positive(),
    subStyleId: z.number().int().positive(),
    keystoneId: z.number().int().positive(),
    selectedPerkIds: z.array(z.number().int().positive()),
    statShardIds: z.array(z.number().int().positive()).optional(),
    winsWeighted: z.number().nonnegative().optional(),
    gamesWeighted: z.number().nonnegative().optional(),
    gamesW2: z.number().nonnegative().optional(),
    winrate: z.number().min(0).max(1).optional(),
    pickShare: z.number().min(0).max(1).optional(),
  })
  .strict();
export type RunePage = z.infer<typeof runePageSchema>;

// --- Rune export schemas (DATA_MODEL.md rune_ctx table) ---

export const runeContextPageSchema = z
  .object({
    primaryStyleId: z.number().int().positive(),
    subStyleId: z.number().int().positive(),
    keystoneId: z.number().int().positive(),
    selectedPerkIds: z.array(z.number().int().positive()),
    statShardIds: z.array(z.number().int().positive()).optional(),
    winsW: z.number().nonnegative(),
    gamesW: z.number().nonnegative(),
    gamesW2: z.number().nonnegative(),
    winrate: z.number().min(0).max(1),
    pickShare: z.number().min(0).max(1),
    players: z.number().int().nonnegative().optional(),
  })
  .strict();
export type RuneContextPage = z.infer<typeof runeContextPageSchema>;

export const runeContextEntrySchema = z
  .object({
    contextKey: z.string().min(1),
    contextLevel: z.number().int().nonnegative(),
    pages: z.array(runeContextPageSchema),
  })
  .strict();
export type RuneContextEntry = z.infer<typeof runeContextEntrySchema>;

export const runeExportSchema = z
  .object({
    championId: championIdSchema,
    myRole: roleSchema,
    contexts: z.array(runeContextEntrySchema),
  })
  .strict();
export type RuneExport = z.infer<typeof runeExportSchema>;
