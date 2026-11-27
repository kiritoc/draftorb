/**
 * @draftorb/shared — Summoner-spell export and recommendation schemas
 * (BL-031a, SPECS §8.1/§18.5).
 *
 * `roles/<ROLE>/summoners/<championId>.json` mirrors the rune export shape:
 * contexts (same D-021 back-off keys as `rune_ctx`) -> spell pairs. The pair
 * is the unordered normalized `[minId, maxId]` form (SPECS §18.5); every row
 * carries `gamesW2` for `n_eff`, separate `winrate`/`pickShare` and the
 * D-102 distinct-player count `players`.
 */

import { z } from 'zod';

import {
  SUMMONER_RESULT_SCHEMA_VERSION,
  championIdSchema,
  rankBucketSchema,
  roleSchema,
} from './core.js';
import { championRoleProbabilitiesSchema } from './champions.js';
import { championTagsMapSchema } from './tags.js';
import { enemyDamageMixSchema } from './runes.js';

// --- Summoner export schemas (summoner_ctx table) ---

/** One normalized spell pair with its weighted evidence (D-102 fields). */
export const summonerPairExportSchema = z
  .object({
    /** Unordered pair normalized to [min, max] (SPECS §18.5). */
    summoner1Id: z.number().int().positive(),
    summoner2Id: z.number().int().positive(),
    winsW: z.number().nonnegative(),
    gamesW: z.number().nonnegative(),
    gamesW2: z.number().nonnegative(),
    winrate: z.number().min(0).max(1),
    pickShare: z.number().min(0).max(1),
    players: z.number().int().nonnegative().optional(),
  })
  .strict();
export type SummonerPairExport = z.infer<typeof summonerPairExportSchema>;

export const summonerContextEntrySchema = z
  .object({
    rankBucket: rankBucketSchema,
    contextKey: z.string().min(1),
    contextLevel: z.number().int().nonnegative(),
    pairs: z.array(summonerPairExportSchema),
  })
  .strict();
export type SummonerContextEntry = z.infer<typeof summonerContextEntrySchema>;

export const summonerExportSchema = z
  .object({
    championId: championIdSchema,
    myRole: roleSchema,
    contexts: z.array(summonerContextEntrySchema),
  })
  .strict();
export type SummonerExport = z.infer<typeof summonerExportSchema>;

// --- Summoner recommendation schemas (engine output, BL-031a) ---

/** Data the summoner recommender needs: identical shape to rune data. */
export const summonerRecommendDataSchema = z
  .object({
    /** championId -> { role: prob } (same table as `RecommendData.roleProb`). */
    roleProb: championRoleProbabilitiesSchema,
    /** Champion tags, used for the enemy damage mix. */
    tags: championTagsMapSchema,
  })
  .strict();
export type SummonerRecommendData = z.infer<typeof summonerRecommendDataSchema>;

/**
 * One recommended spell pair. `winRate` is the shrunk estimate and
 * `nEff`/`players` are the effective sample size and distinct expert count
 * of the most specific context the pair was scored in — a win rate is never
 * reported without its sample size (SPECS §8.1 evidence rules).
 */
export const summonerPairPickSchema = z
  .object({
    summoner1Id: z.number().int().positive(),
    summoner2Id: z.number().int().positive(),
    winRate: z.number().min(0).max(1),
    nEff: z.number().nonnegative(),
    players: z.number().int().nonnegative().optional(),
    pickShare: z.number().min(0).max(1),
    lowData: z.boolean(),
    /** Most specific back-off context the pair was scored in. */
    contextKey: z.string().min(1),
    contextLevel: z.number().int().nonnegative(),
  })
  .strict();
export type SummonerPairPick = z.infer<typeof summonerPairPickSchema>;

export const summonerRecommendationResultSchema = z
  .object({
    schemaVersion: z.literal(SUMMONER_RESULT_SCHEMA_VERSION),
    championId: championIdSchema,
    myRole: roleSchema,
    /** Enemy-team damage mix used for the `damagemix:` context. */
    damageMix: enemyDamageMixSchema,
    /** Top pairs by shrunk win rate (at most the configured pair count). */
    pairs: z.array(summonerPairPickSchema),
    /** False when no summoner export (or no context for the rank bucket) exists. */
    dataAvailable: z.boolean(),
  })
  .strict();
export type SummonerRecommendationResult = z.infer<typeof summonerRecommendationResultSchema>;
