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

import {
  RUNE_RESULT_SCHEMA_VERSION,
  championIdSchema,
  rankBucketSchema,
  roleSchema,
} from './core.js';
import { championRoleProbabilitiesSchema } from './champions.js';
import { championTagsMapSchema } from './tags.js';

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
    rankBucket: rankBucketSchema,
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

// --- Rune recommendation schemas (SPECS §8.1, engine output T-040) ---

/** Data the rune recommender needs beyond the per-champion rune export. */
export const runeRecommendDataSchema = z
  .object({
    /** championId -> { role: prob } (same table as `RecommendData.roleProb`). */
    roleProb: championRoleProbabilitiesSchema,
    /** Champion tags, used for the enemy damage mix. */
    tags: championTagsMapSchema,
  })
  .strict();
export type RuneRecommendData = z.infer<typeof runeRecommendDataSchema>;

/** Enemy-team damage mix buckets (`damagemix:<mix>` context keys, D-021). */
export const enemyDamageMixSchema = z.enum(['AD', 'AP', 'mixed']);
export type EnemyDamageMix = z.infer<typeof enemyDamageMixSchema>;

/**
 * One recommended rune page. `winRate` is the shrunk estimate (SPECS §8.1) and
 * `nEff`/`players` are the effective sample size and distinct expert count of
 * the most specific context the page was scored in — a win rate is never
 * reported without its sample size.
 */
export const runePagePickSchema = z
  .object({
    primaryStyleId: z.number().int().positive(),
    subStyleId: z.number().int().positive(),
    keystoneId: z.number().int().positive(),
    selectedPerkIds: z.array(z.number().int().positive()),
    statShardIds: z.array(z.number().int().positive()).optional(),
    winRate: z.number().min(0).max(1),
    nEff: z.number().nonnegative(),
    players: z.number().int().nonnegative().optional(),
    pickShare: z.number().min(0).max(1),
    lowData: z.boolean(),
    /** Most specific back-off context the page was scored in. */
    contextKey: z.string().min(1),
    contextLevel: z.number().int().nonnegative(),
  })
  .strict();
export type RunePagePick = z.infer<typeof runePagePickSchema>;

/** Adaptation hint: stat shards favored against the enemy damage mix. */
export const runeAdaptationHintSchema = z
  .object({
    code: z.literal('statShardsVsDamageMix'),
    damageMix: enemyDamageMixSchema,
    statShardIds: z.array(z.number().int().positive()),
  })
  .strict();
export type RuneAdaptationHint = z.infer<typeof runeAdaptationHintSchema>;

export const runeRecommendationResultSchema = z
  .object({
    schemaVersion: z.literal(RUNE_RESULT_SCHEMA_VERSION),
    championId: championIdSchema,
    myRole: roleSchema,
    /** Enemy-team damage mix used for the `damagemix:` context and hints. */
    damageMix: enemyDamageMixSchema,
    /** Top pages by shrunk win rate (at most the configured page count). */
    pages: z.array(runePagePickSchema),
    adaptationHints: z.array(runeAdaptationHintSchema),
    /** False when no rune export (or no context for the rank bucket) exists. */
    dataAvailable: z.boolean(),
  })
  .strict();
export type RuneRecommendationResult = z.infer<typeof runeRecommendationResultSchema>;
