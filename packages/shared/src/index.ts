/**
 * @draftorb/shared — Types and zod schemas (single source of truth).
 *
 * This package exports all shared types, constants, and validation schemas
 * used across the DraftOrb monorepo. Schemas are organized by domain under
 * `schemas/` and re-exported here.
 */

export { z } from './schemas/core.js';
export { SHARED_VERSION, MANIFEST_SCHEMA_VERSION } from './schemas/core.js';

export {
  roleSchema,
  rankSchema,
  rankBucketSchema,
  championIdSchema,
  itemIdSchema,
  damageTypeSchema,
  championRangeSchema,
} from './schemas/core.js';
export type {
  Role,
  Rank,
  RankBucket,
  ChampionId,
  ItemId,
  DamageType,
  ChampionRange,
} from './schemas/core.js';

export {
  reasonTypeSchema,
  reasonLevelSchema,
  reasonSchema,
  reliabilitySchema,
  recommendationSchema,
} from './schemas/reasons.js';
export type {
  ReasonType,
  ReasonLevel,
  Reason,
  Reliability,
  Recommendation,
} from './schemas/reasons.js';

export {
  slotSchema,
  draftInputSchema,
  championPoolSchema,
  insufficientDataEntrySchema,
  poolUnavailableEntrySchema,
  draftResultSchema,
} from './schemas/draft.js';
export type {
  Slot,
  DraftInput,
  ChampionPool,
  InsufficientDataEntry,
  PoolUnavailableEntry,
  DraftResult,
} from './schemas/draft.js';

export { playerStateSchema, gameStateSchema } from './schemas/game.js';
export type { PlayerState, GameState } from './schemas/game.js';

export {
  championSchema,
  championsMapSchema,
  championRoleProbabilitiesSchema,
} from './schemas/champions.js';
export type { Champion, ChampionsMap, ChampionRoleProbabilities } from './schemas/champions.js';

export {
  championTagsScalingSchema,
  championTagsSchema,
  championTagsMapSchema,
} from './schemas/tags.js';
export type { ChampionTagsScaling, ChampionTags, ChampionTagsMap } from './schemas/tags.js';

export { manifestFileSchema, manifestSchema } from './schemas/manifest.js';
export type { Manifest } from './schemas/manifest.js';

export {
  supportBaselineEntrySchema,
  supportBaselineTableSchema,
  supportPairEntrySchema,
  supportPairTableSchema,
  baselineEntrySchema,
  baselineTableSchema,
  allyPairEntrySchema,
  allyPairTableSchema,
  enemyPairEntrySchema,
  enemyPairTableSchema,
  laneVsEntrySchema,
  laneVsTableSchema,
  laneFullEntrySchema,
  laneFullTableSchema,
} from './schemas/tables.js';
export type {
  SupportBaselineEntry,
  SupportBaselineTable,
  SupportPairEntry,
  SupportPairTable,
  BaselineEntry,
  BaselineTable,
  AllyPairEntry,
  AllyPairTable,
  EnemyPairEntry,
  EnemyPairTable,
  LaneVsEntry,
  LaneVsTable,
  LaneFullEntry,
  LaneFullTable,
} from './schemas/tables.js';

export {
  itemSchema,
  itemsMapSchema,
  itemTagsSchema,
  itemTagsMapSchema,
  itemBuildStateBucketSchema,
  itemBuildProfileKeySchema,
  itemBuildEntrySchema,
  itemBuildContextSchema,
  itemBuildExportSchema,
} from './schemas/items.js';
export type {
  Item,
  ItemsMap,
  ItemTags,
  ItemTagsMap,
  ItemBuildStateBucket,
  ItemBuildProfileKey,
  ItemBuildEntry,
  ItemBuildContext,
  ItemBuildExport,
} from './schemas/items.js';

export {
  runePerkSchema,
  runeTreeSchema,
  runeTreesSchema,
  runePageSchema,
  runeContextPageSchema,
  runeContextEntrySchema,
  runeExportSchema,
} from './schemas/runes.js';
export type {
  RunePerk,
  RuneTree,
  RuneTrees,
  RunePage,
  RuneContextPage,
  RuneContextEntry,
  RuneExport,
} from './schemas/runes.js';
