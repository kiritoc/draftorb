/**
 * @draftorb/shared — Configured-profile schemas (D-067..D-075, SPECS §18).
 *
 * `profileConfigSchema` validates the committed `data/profiles.config.json`
 * (D-068): the only profiles the pipeline ever syncs. `profileExportSchema`
 * and `profileIndexSchema` validate the anonymized static exports under
 * `data/public/profiles/` (D-069): per-game fields are restricted to the
 * anonymization whitelist (champion ids, role, lane matchup ids, rune page
 * ids, spell ids, item ids, win/loss, day-precision timestamp — never other
 * players' identifiers or match ids).
 */

import { z } from 'zod';

import {
  PROFILE_CONFIG_SCHEMA_VERSION,
  PROFILE_EXPORT_SCHEMA_VERSION,
  championIdSchema,
  itemIdSchema,
  roleSchema,
} from './core.js';

/** Stable slug used for the export file name (e.g. `kiritoctoc-euw1`). */
export const profileIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
export type ProfileId = z.infer<typeof profileIdSchema>;

const riotIdSchema = z
  .object({
    gameName: z.string().min(1),
    tagLine: z.string().min(1),
  })
  .strict();
export type ProfileRiotId = z.infer<typeof riotIdSchema>;

export const profileOptionsSchema = z
  .object({
    /** Max games kept in the export (D-069); defaults to 500 in the ETL. */
    profileMaxGames: z.number().int().positive().optional(),
  })
  .strict();
export type ProfileOptions = z.infer<typeof profileOptionsSchema>;

export const profileConfigEntrySchema = z
  .object({
    id: profileIdSchema,
    riotId: riotIdSchema,
    /** Platform routing label, e.g. `EUW1`. */
    platform: z.string().min(1),
    /** Label shown in the UI, e.g. `KiriToc's picks`. */
    label: z.string().min(1),
    options: profileOptionsSchema.optional(),
  })
  .strict();
export type ProfileConfigEntry = z.infer<typeof profileConfigEntrySchema>;

export const profileConfigSchema = z
  .object({
    schemaVersion: z.literal(PROFILE_CONFIG_SCHEMA_VERSION),
    profiles: z.array(profileConfigEntrySchema).min(1),
  })
  .strict()
  .refine((config) => new Set(config.profiles.map((p) => p.id)).size === config.profiles.length, {
    message: 'profile ids must be unique',
  });
export type ProfileConfig = z.infer<typeof profileConfigSchema>;

/** Rune page identifiers stored per profile game (SPECS §18.5). */
export const profileGameRunesSchema = z
  .object({
    keystoneId: z.number().int().positive(),
    primaryStyleId: z.number().int().positive(),
    subStyleId: z.number().int().positive(),
    perkIds: z.array(z.number().int().positive()),
    statShardIds: z.array(z.number().int().positive()),
  })
  .strict();
export type ProfileGameRunes = z.infer<typeof profileGameRunesSchema>;

/**
 * One exported profile game. Only whitelisted fields (D-069): no match id,
 * no foreign player identifiers, `createdAtDay` is unix days.
 */
export const profileGameSchema = z
  .object({
    createdAtDay: z.number().int().nonnegative(),
    championId: championIdSchema,
    role: roleSchema,
    win: z.boolean(),
    /** Ally ADC champion id (bot-lane roles only, null otherwise). */
    allyAdcId: championIdSchema.nullable(),
    /** Enemy support champion id (bot-lane roles only, null otherwise). */
    enemySupportId: championIdSchema.nullable(),
    /** Enemy ADC champion id (bot-lane roles only, null otherwise). */
    enemyAdcId: championIdSchema.nullable(),
    /** All five enemy team champion ids (composition context). */
    enemyChampionIds: z.array(championIdSchema),
    runes: profileGameRunesSchema,
    /** Final items (item0..item5, non-zero ids). */
    items: z.array(itemIdSchema),
    /** Build order from the match timeline; null when not fetched. */
    itemsOrdered: z.array(itemIdSchema).nullable(),
    /** [spell1Id, spell2Id]. */
    summonerSpells: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  })
  .strict();
export type ProfileGame = z.infer<typeof profileGameSchema>;

export const profileMasteryEntrySchema = z
  .object({
    championId: championIdSchema,
    points: z.number().int().nonnegative(),
    level: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type ProfileMasteryEntry = z.infer<typeof profileMasteryEntrySchema>;

/** Favorites computed at export time (D-074). */
export const profileFavoritesSchema = z
  .object({
    /** Deduplicated union of `recency` and `mastery`. */
    combined: z.array(championIdSchema),
    /** Top champions by recency-weighted Support games in the last 90 days. */
    recency: z.array(championIdSchema),
    /** Top champions by mastery points. */
    mastery: z.array(championIdSchema),
  })
  .strict();
export type ProfileFavorites = z.infer<typeof profileFavoritesSchema>;

/** `data/public/profiles/<id>.json` — one file per configured profile. */
export const profileExportSchema = z
  .object({
    schemaVersion: z.literal(PROFILE_EXPORT_SCHEMA_VERSION),
    id: profileIdSchema,
    /** The profile owner's Riot ID — the owner's explicit choice (D-069). */
    riotId: riotIdSchema.extend({ platform: z.string().min(1) }).strict(),
    label: z.string().min(1),
    syncedAt: z.number().int().nonnegative(),
    gameCount: z.number().int().nonnegative(),
    favorites: profileFavoritesSchema,
    games: z.array(profileGameSchema),
    mastery: z.array(profileMasteryEntrySchema),
  })
  .strict();
export type ProfileExport = z.infer<typeof profileExportSchema>;

/** `data/public/profiles/index.json` entry pointing at one profile file. */
export const profileIndexEntrySchema = z
  .object({
    id: profileIdSchema,
    riotId: riotIdSchema,
    platform: z.string().min(1),
    label: z.string().min(1),
    syncedAt: z.number().int().nonnegative(),
    gameCount: z.number().int().nonnegative(),
    file: z.string().min(1),
  })
  .strict();
export type ProfileIndexEntry = z.infer<typeof profileIndexEntrySchema>;

export const profileIndexSchema = z
  .object({
    schemaVersion: z.literal(PROFILE_EXPORT_SCHEMA_VERSION),
    profiles: z.array(profileIndexEntrySchema),
  })
  .strict();
export type ProfileIndex = z.infer<typeof profileIndexSchema>;
