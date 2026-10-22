/**
 * @draftorb/shared — Types and zod schemas (single source of truth).
 *
 * This package exports all shared types, constants, and validation schemas
 * used across the DraftOrb monorepo.
 */

import { z } from 'zod';

export const SHARED_VERSION = '0.0.1' as const;

export const roleSchema = z.enum(['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT']);
export type Role = z.infer<typeof roleSchema>;

export const rankSchema = z.enum([
  'IRON',
  'BRONZE',
  'SILVER',
  'GOLD',
  'PLATINUM',
  'EMERALD',
  'DIAMOND',
  'MASTER',
  'GRANDMASTER',
  'CHALLENGER',
]);
export type Rank = z.infer<typeof rankSchema>;

export const championIdSchema = z.number().int().positive();
export type ChampionId = z.infer<typeof championIdSchema>;

export const itemIdSchema = z.number().int().positive();
export type ItemId = z.infer<typeof itemIdSchema>;

export const slotSchema = z
  .object({
    championId: championIdSchema,
    role: roleSchema.optional(),
  })
  .strict();
export type Slot = z.infer<typeof slotSchema>;

export const draftInputSchema = z
  .object({
    userRank: rankSchema,
    userRole: roleSchema,
    allies: z.array(slotSchema).max(4),
    enemies: z.array(slotSchema).max(5),
    blindPick: z.boolean(),
    pool: z.array(championIdSchema).optional(),
  })
  .strict();
export type DraftInput = z.infer<typeof draftInputSchema>;

export const reasonTypeSchema = z.enum(['synergy', 'counter', 'comp', 'blind']);
export type ReasonType = z.infer<typeof reasonTypeSchema>;

export const reasonLevelSchema = z.union([
  z.literal(-3),
  z.literal(-2),
  z.literal(-1),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);
export type ReasonLevel = z.infer<typeof reasonLevelSchema>;

export const reasonSchema = z
  .object({
    type: reasonTypeSchema,
    with: championIdSchema.optional(),
    level: reasonLevelSchema.optional(),
    deltaPp: z.number().optional(),
    n: z.number().int().nonnegative().optional(),
  })
  .strict();
export type Reason = z.infer<typeof reasonSchema>;

export const reliabilitySchema = z
  .object({
    games: z.number().int().nonnegative(),
    lowData: z.boolean(),
  })
  .strict();
export type Reliability = z.infer<typeof reliabilitySchema>;

export const recommendationSchema = z
  .object({
    championId: championIdSchema,
    score: z.number(),
    rank: z.number().int().positive(),
    reasons: z.array(reasonSchema),
    reliability: reliabilitySchema,
    warnings: z.array(z.string().min(1)),
  })
  .strict();
export type Recommendation = z.infer<typeof recommendationSchema>;

export const playerStateSchema = z
  .object({
    championId: championIdSchema,
    kills: z.number().int().nonnegative(),
    deaths: z.number().int().nonnegative(),
    assists: z.number().int().nonnegative(),
    cs: z.number().nonnegative().optional(),
    items: z.array(itemIdSchema).default([]),
    level: z.number().int().nonnegative().optional(),
  })
  .strict();
export type PlayerState = z.infer<typeof playerStateSchema>;

export const gameStateSchema = z
  .object({
    time: z.number().nonnegative(),
    me: playerStateSchema,
    allies: z.array(playerStateSchema).max(4),
    enemies: z.array(playerStateSchema).max(5),
    goldDiff: z.number().optional(),
    kills: z.number().int().nonnegative().optional(),
    towers: z.number().int().nonnegative().optional(),
    dragons: z.number().int().nonnegative().optional(),
  })
  .strict();
export type GameState = z.infer<typeof gameStateSchema>;

export const championSchema = z
  .object({
    id: championIdSchema,
    name: z.string().min(1),
    icon: z.string().min(1),
    roles: z.array(roleSchema).min(1).max(5),
  })
  .strict();
export type Champion = z.infer<typeof championSchema>;

export const championsMapSchema = z.record(z.string(), championSchema);
export type ChampionsMap = z.infer<typeof championsMapSchema>;

export const damageTypeSchema = z.enum(['AD', 'AP', 'MIXED', 'NONE']);
export type DamageType = z.infer<typeof damageTypeSchema>;

export const championRangeSchema = z.enum(['MELEE', 'RANGED']);
export type ChampionRange = z.infer<typeof championRangeSchema>;

export const championTagsScalingSchema = z
  .object({
    early: z.boolean(),
    mid: z.boolean(),
    late: z.boolean(),
  })
  .strict();

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
  })
  .strict();
export type ChampionTags = z.infer<typeof championTagsSchema>;

export const championRoleProbabilitiesSchema = z.record(
  z.string(),
  z.record(roleSchema, z.number().finite().min(0).max(1)),
);
export type ChampionRoleProbabilities = z.infer<typeof championRoleProbabilitiesSchema>;

export const manifestFileSchema = z
  .object({
    path: z.string().min(1),
    sha256: z.string().optional(),
  })
  .strict();

export const manifestSchema = z
  .object({
    patch: z.string().min(1),
    generatedAt: z.string().min(1),
    region: z.string().min(1),
    rankBuckets: z.array(rankSchema),
    files: z.array(manifestFileSchema),
    schemaVersion: z.number().int().positive(),
  })
  .strict();
export type Manifest = z.infer<typeof manifestSchema>;

export const championTagsMapSchema = z
  .record(z.string(), championTagsSchema)
  .refine(
    (entries) => Object.entries(entries).every(([key, val]) => key === String(val.championId)),
    {
      message: 'Every record key in championTagsMap must match its championId',
    },
  );
export type ChampionTagsMap = z.infer<typeof championTagsMapSchema>;

export const supportPairEntrySchema = z.tuple([
  championIdSchema,
  championIdSchema,
  roleSchema,
  rankSchema,
  z.number().nonnegative(),
  z.number().nonnegative(),
]);
export type SupportPairEntry = z.infer<typeof supportPairEntrySchema>;

export const supportPairTableSchema = z.array(supportPairEntrySchema);
export type SupportPairTable = z.infer<typeof supportPairTableSchema>;

export const supportBaselineEntrySchema = z
  .object({
    championId: championIdSchema,
    rankBucket: rankSchema,
    winsWeighted: z.number().nonnegative(),
    gamesWeighted: z.number().nonnegative(),
  })
  .strict();
export type SupportBaselineEntry = z.infer<typeof supportBaselineEntrySchema>;

export const supportBaselineTableSchema = z.array(supportBaselineEntrySchema);
export type SupportBaselineTable = z.infer<typeof supportBaselineTableSchema>;

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
    winrate: z.number().min(0).max(1).optional(),
    pickShare: z.number().min(0).max(1).optional(),
  })
  .strict();
export type RunePage = z.infer<typeof runePageSchema>;
