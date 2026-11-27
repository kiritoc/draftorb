/**
 * @draftorb/shared — Setup-screen rune result schemas (SPECS §18.5, BL-030a).
 *
 * `SetupRuneResult` is the mode-switched data contract behind the runes
 * screen: `topPlayers` reads the expert aggregate export
 * (`roles/<ROLE>/runes/<championId>.json`, SPECS §8.1) and `myData` reads the
 * configured profile export (D-073/D-075). Both modes share one normalized
 * page shape so the UI renders either source without a restart (D-134).
 *
 * Evidence display rules (D-102/D-103): every figure carries its sample size
 * (`nEff`; `games` for profile figures — the expert export stores weights,
 * not raw game counts) and, for expert evidence, the distinct-player count
 * (`players`); win rate and pick share are separate fields; the Master+ tier
 * restriction is an optional toggle, off by default; thin contexts fall back
 * to a broader statistic that is always labeled via `source` /
 * `broaderStatistic`.
 */

import { z } from 'zod';

import { SETUP_RESULT_SCHEMA_VERSION, championIdSchema, roleSchema } from './core.js';

/** Setup screen data modes (D-134): expert aggregate vs the player's own games. */
export const setupModeSchema = z.enum(['topPlayers', 'myData']);
export type SetupMode = z.infer<typeof setupModeSchema>;

/** Which dataset produced the result — shown next to the mode switch. */
export const setupDataSourceSchema = z.enum(['expertAggregate', 'profile']);
export type SetupDataSource = z.infer<typeof setupDataSourceSchema>;

/**
 * The statistic a page figure was computed from, so thin contexts are always
 * labeled (D-103). Expert pages use the §8.1 back-off chain (`laneContext` =
 * the `lane:` slot contexts, `damageMix`, `global`); profile pages use the
 * D-073 fallback levels (`profileMatchup` = L1..L3, `profileChampion` =
 * L4..L5). `none` marks a page with no sufficient evidence at any level.
 */
export const setupPageSourceSchema = z.enum([
  'laneContext',
  'damageMix',
  'global',
  'profileMatchup',
  'profileChampion',
  'none',
]);
export type SetupPageSource = z.infer<typeof setupPageSourceSchema>;

/** D-102 evidence rule as applied to expert (top players) figures. */
export const setupExpertEvidenceSchema = z
  .object({
    kind: z.literal('expert'),
    /** Per-player weight cap inside one aggregated context row. */
    playerWeightCap: z.number().positive(),
    /** Minimum distinct expert players behind any exported number. */
    minDistinctPlayers: z.number().int().min(1),
    /** True when the optional Master+ toggle restricts evidence to MASTER_PLUS. */
    masterPlusOnly: z.boolean(),
    /** D-102: the Master+ restriction is always an optional UI toggle. */
    masterPlusOptional: z.literal(true),
  })
  .strict();
export type SetupExpertEvidence = z.infer<typeof setupExpertEvidenceSchema>;

/** Evidence rule for profile (my data) figures: the D-075 minimum sample. */
export const setupProfileEvidenceSchema = z
  .object({
    kind: z.literal('profile'),
    /** Minimum effective games on a champion+setup before a rate is shown. */
    minSetupGames: z.number().int().min(1),
  })
  .strict();
export type SetupProfileEvidence = z.infer<typeof setupProfileEvidenceSchema>;

export const setupEvidenceSchema = z.discriminatedUnion('kind', [
  setupExpertEvidenceSchema,
  setupProfileEvidenceSchema,
]);
export type SetupEvidence = z.infer<typeof setupEvidenceSchema>;

/**
 * One recommended rune page, normalized across both modes. `winRate` is the
 * shrunk estimate and is null when the page has insufficient data (D-075);
 * `nEff` is always present so no rate is ever shown without a sample size.
 * `players` (distinct expert players) and `pickShare` exist only for expert
 * figures; `games` (raw profile game count) exists only for profile figures.
 */
export const setupRunePageSchema = z
  .object({
    keystoneId: z.number().int().positive(),
    primaryStyleId: z.number().int().positive(),
    subStyleId: z.number().int().positive(),
    /** Minor rune picks (`selectedPerkIds` in the expert export). */
    perkIds: z.array(z.number().int().positive()),
    statShardIds: z.array(z.number().int().positive()),
    winRate: z.number().min(0).max(1).nullable(),
    nEff: z.number().nonnegative(),
    games: z.number().int().nonnegative().optional(),
    players: z.number().int().nonnegative().optional(),
    pickShare: z.number().min(0).max(1).optional(),
    insufficientData: z.boolean(),
    source: setupPageSourceSchema,
    /** Back-off level inside the source (contextLevel or fallbackLevel). */
    sourceLevel: z.number().int().nullable(),
  })
  .strict();
export type SetupRunePage = z.infer<typeof setupRunePageSchema>;

/**
 * D-103 broader-statistic fallback, populated when the mode's primary data
 * is too thin to produce pages: the champion's win rate in the picked role
 * (expert baseline or the profile's own champion record), always labeled by
 * `kind`. `winRate` is null when there is no weighted evidence at all.
 */
export const setupBroaderStatisticSchema = z
  .object({
    kind: z.enum(['championRoleWinRate', 'profileChampionWinRate']),
    winRate: z.number().min(0).max(1).nullable(),
    nEff: z.number().nonnegative(),
    games: z.number().int().nonnegative().optional(),
    insufficientData: z.boolean(),
  })
  .strict();
export type SetupBroaderStatistic = z.infer<typeof setupBroaderStatisticSchema>;

export const setupRuneResultSchema = z
  .object({
    schemaVersion: z.literal(SETUP_RESULT_SCHEMA_VERSION),
    championId: championIdSchema,
    myRole: roleSchema,
    mode: setupModeSchema,
    dataSource: setupDataSourceSchema,
    evidence: setupEvidenceSchema,
    pages: z.array(setupRunePageSchema),
    broaderStatistic: setupBroaderStatisticSchema.nullable(),
    /** False when the mode's data source has nothing usable for this champion. */
    dataAvailable: z.boolean(),
  })
  .strict();
export type SetupRuneResult = z.infer<typeof setupRuneResultSchema>;
