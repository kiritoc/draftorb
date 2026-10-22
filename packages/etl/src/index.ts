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
