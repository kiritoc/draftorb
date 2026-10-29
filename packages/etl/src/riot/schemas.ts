/**
 * Zod schemas for Riot Games API responses.
 *
 * Designed to validate required data shapes for DraftOrb ingestion while
 * allowing additional fields (via .passthrough()) to ensure resilience
 * against minor Riot API payload changes.
 */

import { z } from '@draftorb/shared';

export const riotLeagueEntrySchema = z
  .object({
    leagueId: z.string().optional(),
    summonerId: z.string().optional(),
    puuid: z.string().optional(),
    queueType: z.string(),
    tier: z.string(),
    rank: z.string(),
    leaguePoints: z.number().int(),
    wins: z.number().int().nonnegative(),
    losses: z.number().int().nonnegative(),
    veteran: z.boolean().optional(),
    inactive: z.boolean().optional(),
    freshBlood: z.boolean().optional(),
    hotStreak: z.boolean().optional(),
  })
  .passthrough();
export type RiotLeagueEntry = z.infer<typeof riotLeagueEntrySchema>;

export const riotLeagueEntriesSchema = z.array(riotLeagueEntrySchema);
export type RiotLeagueEntries = z.infer<typeof riotLeagueEntriesSchema>;

export const riotLeagueItemSchema = z
  .object({
    summonerId: z.string().optional(),
    puuid: z.string().optional(),
    leaguePoints: z.number().int(),
    rank: z.string(),
    wins: z.number().int().nonnegative(),
    losses: z.number().int().nonnegative(),
    veteran: z.boolean().optional(),
    inactive: z.boolean().optional(),
    freshBlood: z.boolean().optional(),
    hotStreak: z.boolean().optional(),
  })
  .passthrough();
export type RiotLeagueItem = z.infer<typeof riotLeagueItemSchema>;

export const riotLeagueListSchema = z
  .object({
    tier: z.string(),
    leagueId: z.string().optional(),
    queue: z.string().optional(),
    name: z.string().optional(),
    entries: z.array(riotLeagueItemSchema),
  })
  .passthrough();
export type RiotLeagueList = z.infer<typeof riotLeagueListSchema>;

export const riotMatchIdsSchema = z.array(z.string());
export type RiotMatchIds = z.infer<typeof riotMatchIdsSchema>;

export const riotPerkSelectionSchema = z
  .object({
    perk: z.number().int(),
    var1: z.number().int().optional(),
    var2: z.number().int().optional(),
    var3: z.number().int().optional(),
  })
  .passthrough();

export const riotPerkStyleSchema = z
  .object({
    description: z.string().optional(),
    selections: z.array(riotPerkSelectionSchema),
    style: z.number().int(),
  })
  .passthrough();

export const riotPerksDtoSchema = z
  .object({
    statPerks: z
      .object({
        defense: z.number().int().optional(),
        flex: z.number().int().optional(),
        offense: z.number().int().optional(),
      })
      .passthrough()
      .optional(),
    styles: z.array(riotPerkStyleSchema),
  })
  .passthrough();

export const riotParticipantDtoSchema = z
  .object({
    puuid: z.string().min(1),
    participantId: z.number().int().optional(),
    teamId: z.number().int(),
    championId: z.number().int(),
    championName: z.string().optional(),
    teamPosition: z.string(), // 'TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY', or ''
    individualPosition: z.string().optional(),
    win: z.boolean(),
    kills: z.number().int(),
    deaths: z.number().int(),
    assists: z.number().int(),
    champLevel: z.number().int().optional(),
    item0: z.number().int().default(0),
    item1: z.number().int().default(0),
    item2: z.number().int().default(0),
    item3: z.number().int().default(0),
    item4: z.number().int().default(0),
    item5: z.number().int().default(0),
    item6: z.number().int().default(0),
    perks: riotPerksDtoSchema.optional(),
  })
  .passthrough();
export type RiotParticipantDto = z.infer<typeof riotParticipantDtoSchema>;

export const riotMatchInfoDtoSchema = z
  .object({
    gameCreation: z.number(),
    gameDuration: z.number(),
    gameEndTimestamp: z.number().optional(),
    gameId: z.number(),
    gameMode: z.string(),
    gameVersion: z.string(),
    queueId: z.number().int(),
    participants: z.array(riotParticipantDtoSchema),
  })
  .passthrough();
export type RiotMatchInfoDto = z.infer<typeof riotMatchInfoDtoSchema>;

export const riotMatchMetadataDtoSchema = z
  .object({
    dataVersion: z.string().optional(),
    matchId: z.string(),
    participants: z.array(z.string()),
  })
  .passthrough();
export type RiotMatchMetadataDto = z.infer<typeof riotMatchMetadataDtoSchema>;

export const riotMatchDtoSchema = z
  .object({
    metadata: riotMatchMetadataDtoSchema,
    info: riotMatchInfoDtoSchema,
  })
  .passthrough();
export type RiotMatchDto = z.infer<typeof riotMatchDtoSchema>;

export const riotChampionMasterySchema = z
  .object({
    championId: z.number().int(),
    championLevel: z.number().int().optional(),
    championPoints: z.number().int(),
    lastPlayTime: z.number().int().optional(),
    chestGranted: z.boolean().optional(),
    tokensEarned: z.number().int().optional(),
  })
  .passthrough();
export type RiotChampionMastery = z.infer<typeof riotChampionMasterySchema>;
