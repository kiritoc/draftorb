/**
 * @draftorb/etl — Riot API client, SQLite storage, aggregation, and JSON export.
 *
 * ETL commands are invoked via `pnpm etl <command>`.
 */

export const ETL_VERSION = '0.0.1' as const;

export {
  fetchChampions,
  fetchItems,
  fetchLatestVersion,
  fetchRunes,
  getPatchFromVersion,
  importStaticData,
  mapChampionTagsToRoles,
  transformChampions,
  transformItems,
  transformRunes,
  type ImportOptions,
  type ImportResult,
  type RawDDragonChampion,
  type RawDDragonItem,
  type RawDDragonRunePerk,
  type RawDDragonRuneTree,
} from './ddragon';

export {
  evaluateChampionTagsCoverage,
  findLatestChampionsPath,
  formatCoverageReport,
  validateChampionTagsFile,
  type ChampionCoverageItem,
  type ChampionTagsCoverageReport,
  type ValidateTagsOptions,
  type ValidateTagsResult,
} from './tags';

export {
  DEFAULT_APP_LIMITS,
  PLATFORMS,
  REGIONAL_ROUTINGS,
  RiotApiError,
  RiotAuthError,
  RiotClient,
  RiotRateLimitError,
  RiotRateLimiter,
  loadEnv,
  parseAndApplyEnv,
  parseRateLimitHeader,
  platformToRegion,
  riotChampionMasterySchema,
  riotLeagueEntriesSchema,
  riotLeagueEntrySchema,
  riotLeagueItemSchema,
  riotLeagueListSchema,
  riotMatchDtoSchema,
  riotMatchIdsSchema,
  riotMatchInfoDtoSchema,
  riotMatchMetadataDtoSchema,
  riotParticipantDtoSchema,
  type MatchIdsOptions,
  type Platform,
  type RateLimitHeaderInfo,
  type RateLimitWindow,
  type RateLimiterOptions,
  type RegionalRouting,
  type RiotChampionMastery,
  type RiotClientOptions,
  type RiotLeagueEntries,
  type RiotLeagueEntry,
  type RiotLeagueItem,
  type RiotLeagueList,
  type RiotMatchDto,
  type RiotMatchIds,
  type RiotMatchInfoDto,
  type RiotMatchMetadataDto,
  type RiotParticipantDto,
} from './riot';

export {
  DEFAULT_MATCHES_PER_PLAYER,
  DEFAULT_MIN_DURATION_SECONDS,
  RANKED_SOLO_QUEUE_ID,
  ingestMatches,
  type MatchIngestionOptions,
  type MatchIngestionResult,
  type PlayerIngestionResult,
} from './matches';
export {
  extractParticipants,
  InvalidMatchParticipantsError,
  MATCH_PARTICIPANT_COUNT,
  MATCH_ROLES_PER_TEAM,
  MATCH_TEAM_COUNT,
  type ParticipantRow,
} from './participants';
export {
  clearPrunedTombstones,
  comparePatches,
  createRankLoader,
  evaluateMatch,
  listUnenrichedMatches,
  patchFromGameVersion,
  rankSummary,
  updateMatchRankStats,
  windowWidened,
  type MatchOutcome,
  type PlayerCursor,
  type RejectReason,
} from './matches-store';

export { enrichParticipants, type EnrichmentOptions, type EnrichmentSummary } from './enrichment';

export { exportJson, type ExportResult } from './export';

export { aggregateRoleProb, type RoleProbRow } from './aggregate';

export {
  AGGREGATE_SNAPSHOT_KEY,
  comparePatchLabels,
  createPatchIndexLookup,
  createPatchResolver,
  ensurePatchCoverage,
  fetchPatchVersions,
  latestPatchIndex,
  lookupPatchIndex,
  parsePatchLabel,
  parsePatchLabels,
  refreshPatches,
  type EnsurePatchCoverageResult,
  type PatchRefreshResult,
  type PatchResolver,
} from './patches';

export {
  readAggregateSnapshot,
  recordAggregateSnapshot,
  type AggregateSnapshotMeta,
} from './aggregate-meta';

export { applyDerivedRoles, deriveChampionRoles } from './derive-roles';

export { aggregateBaseline, type BaselineRow } from './aggregate-baseline';

export {
  aggregatePairTables,
  type LaneFullRow,
  type LaneVsRow,
  type PairRow,
  type PairTableResult,
} from './aggregate-pairs';

export { aggregateRunesByContext, type RuneCtxRow } from './aggregate-runes';

export {
  DEFAULT_PLAYER_QUOTAS,
  DEFAULT_PLAYER_TIER_SEQUENCE,
  discoverPlayersByTier,
  playerRankScore,
  runPlayerDiscovery,
  type PlayerDiscoveryOptions,
  type PlayerDiscoveryResult,
  type TierDiscoveryResult,
} from './players';

export { getMigrationStatus, migrate, openDb } from './db';

export { ETL_CONFIG } from './config/etl-config';

export { pruneMatches, type PruneOptions, type PruneResult } from './prune';

export {
  formatEtlStatus,
  getEtlStatus,
  type EtlStatus,
  type MatchPatchCount,
  type MigrationStatusSummary,
  type PlatformCursorCount,
  type PlayerTierCount,
  type RejectReasonCount,
} from './status';
