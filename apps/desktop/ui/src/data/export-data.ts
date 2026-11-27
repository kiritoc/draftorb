/**
 * Public export loader for the pick screen (BL-009).
 *
 * Reads the cached aggregate tree written by `aggregates.ts`
 * (`latest.json`, `<patch>/manifest.json`, every manifest file plus the
 * manual `champion-tags.json` at the archive root) and builds the
 * `RecommendData` the engine consumes. Roles become selectable through the
 * D-126 coverage check in `role-coverage.ts`, not through this loader.
 */

import {
  allyPairTableSchema,
  baselineTableSchema,
  championRoleProbabilitiesSchema,
  championTagsMapSchema,
  championsMapSchema,
  enemyPairTableSchema,
  laneFullTableSchema,
  laneVsTableSchema,
  latestSchema,
  manifestSchema,
  manifestSchemaV5,
  manifestSchemaV6,
  manifestSchemaV7,
  pickRateSamplesSchema,
  pickRateSchema,
  type AllyPairTable,
  type Champion,
  type ChampionTagsMap,
  type EnemyPairTable,
  type Latest,
  type LaneFullTable,
  type LaneVsTable,
  type Manifest,
  type ManifestV5,
  type ManifestV6,
  type ManifestV7,
  type PickRateSamples,
  type RecommendData,
  type Role,
} from '@draftorb/shared';
import { cacheRead as readDataFile } from './aggregates';

export interface PickData {
  patch: string;
  generatedAt: string;
  champions: Champion[];
  data: RecommendData;
  /** True when the role is exported at champion-level statistics only (BL-024). */
  minimal: boolean;
  /**
   * Per-(champion, role) pick-share denominators (`pick-rate-samples.json`,
   * BL-052). Display-only: kept out of `RecommendData` so it can never feed
   * `score(c)`; absent on exports predating the file.
   */
  pickRateSamples?: PickRateSamples;
}

async function readJson(name: string): Promise<unknown> {
  const raw = await readDataFile(name);
  if (raw === null) throw new Error(`cached aggregate missing: ${name}`);
  return JSON.parse(raw);
}

function requiredFile(files: Readonly<Record<string, unknown>>, path: string): unknown {
  const file = files[path];
  if (file === undefined) {
    throw new Error(`Required recommendation data file is missing: ${path}`);
  }
  return file;
}

/**
 * Builds `RecommendData` for one role from the manifest file map
 * (`file.path` -> parsed JSON). Port of the web loader, role-parameterized.
 * Minimal roles (BL-024) export `baseline.json` only; their pair/lane tables
 * are empty and the engine skips the matchup layers for them.
 */
export function createRecommendData(
  files: Readonly<Record<string, unknown>>,
  champions: readonly Champion[],
  tags: ChampionTagsMap,
  role: Role,
  minimal = false,
): RecommendData {
  const prefix = `roles/${role}/`;
  const pairTables = minimal
    ? {
        allyPairs: [] as AllyPairTable,
        enemyPairs: [] as EnemyPairTable,
        laneVs: [] as LaneVsTable,
        laneFull: [] as LaneFullTable,
      }
    : {
        allyPairs: allyPairTableSchema.parse(requiredFile(files, `${prefix}ally-pairs.json`)),
        enemyPairs: enemyPairTableSchema.parse(requiredFile(files, `${prefix}enemy-pairs.json`)),
        laneVs: laneVsTableSchema.parse(requiredFile(files, `${prefix}lane-vs.json`)),
        laneFull: laneFullTableSchema.parse(requiredFile(files, `${prefix}lane-full.json`)),
      };
  return {
    baselines: baselineTableSchema.parse(requiredFile(files, `${prefix}baseline.json`)),
    ...pairTables,
    roleProb: championRoleProbabilitiesSchema.parse(requiredFile(files, 'role-prob.json')),
    ...(files['pick-rate.json'] !== undefined
      ? { pickRate: pickRateSchema.parse(files['pick-rate.json']) }
      : {}),
    tags: championTagsMapSchema.parse(tags),
    championIds: champions.map((champion) => champion.id),
  };
}

/** Manifest shapes the cache accepts: the current schema plus the frozen v7,
 *  v6 and v5 layouts published before `pick-rate-samples.json` and the
 *  summoner/starter files existed (BL-052, BL-031a). A v5/v6/v7 cache stays
 *  fully usable — the optional files are simply absent until the next
 *  republish. Older layouts (v4 and below) are still rejected: they predate
 *  `minimalRoles` and cannot drive the loader. */
const cachedManifestSchema = manifestSchema
  .or(manifestSchemaV7)
  .or(manifestSchemaV6)
  .or(manifestSchemaV5);
type CachedManifest = Manifest | ManifestV7 | ManifestV6 | ManifestV5;

interface CachedRelease {
  latest: Latest;
  manifest: CachedManifest;
}

/**
 * Reads `latest.json` and the manifest it points to from the data cache.
 * Returns null when nothing is cached; throws on a corrupt or mismatched cache.
 */
export async function loadCachedRelease(): Promise<CachedRelease | null> {
  const latestRaw = await readDataFile('latest.json');
  if (latestRaw === null) return null;
  const latest: Latest = latestSchema.parse(JSON.parse(latestRaw));

  const manifestPath = latest.manifest.startsWith(`${latest.patch}/`)
    ? latest.manifest
    : `${latest.patch}/${latest.manifest}`;
  const manifest: CachedManifest = cachedManifestSchema.parse(await readJson(manifestPath));
  if (manifest.patch !== latest.patch) {
    throw new Error(
      `Latest pointer patch ${latest.patch} does not match manifest patch ${manifest.patch}`,
    );
  }
  return { latest, manifest };
}

/**
 * True when the cached manifest lists `path` (patch-relative, e.g.
 * `roles/SUPPORT/starters/7.json`; a leading `/` marks archive-root
 * entries). The download overwrites only the files the new archive
 * contains and a same-patch refresh keeps the whole patch directory, so a
 * cache file absent from the manifest may be a stale leftover from an
 * older release — callers must treat it as missing instead of serving
 * retired recommendations (BL-031b review).
 */
export function manifestListsFile(
  manifest: { readonly files: readonly { readonly path: string }[] },
  path: string,
): boolean {
  return manifest.files.some((file) => file.path === path || file.path === `/${path}`);
}

export interface ChampionCatalog {
  patch: string;
  champions: Champion[];
}

/**
 * Loads only the champion catalog (`champions.json`) for the cached release.
 * The pool editor needs it even when pick data cannot load (no eligible
 * role, corrupt role files): the pool is champion x roles and does not
 * depend on recommendation tables. Returns null when nothing is cached.
 */
export async function loadChampionCatalog(): Promise<ChampionCatalog | null> {
  const release = await loadCachedRelease();
  if (release === null) return null;
  const raw = await readJson(`${release.latest.patch}/champions.json`);
  return {
    patch: release.latest.patch,
    champions: Object.values(championsMapSchema.parse(raw)),
  };
}

/**
 * Loads the full pick-screen dataset from the data cache.
 * Returns null when nothing is cached (first launch, download failed).
 */
export async function loadPickData(role: Role): Promise<PickData | null> {
  const release = await loadCachedRelease();
  if (release === null) return null;
  const { latest, manifest } = release;

  const files: Record<string, unknown> = {};
  // Archive-root entries ('/latest.json', '/champion-tags.json') are already
  // loaded through their dedicated paths above/below; only patch-relative
  // entries belong to the RecommendData file map.
  // Per-champion setup exports (`roles/<ROLE>/runes/<championId>.json`,
  // `.../summoners/...`, `.../starters/...`) are not part of RecommendData:
  // the setup screen reads them lazily per champion (setup-runes.ts,
  // setup-spells.ts, setup-starters.ts), so parsing every manifest-listed
  // per-champion file here would defeat that and slow startup. The role-level
  // `roles/<ROLE>/starters.json` fallback stays in the eager set (one small
  // file per role, needed by the starters query).
  const patchEntries = manifest.files.filter(
    (file) =>
      !file.path.startsWith('/') &&
      !file.path.includes('/runes/') &&
      !file.path.includes('/summoners/') &&
      !file.path.includes('/starters/'),
  );
  // A corrupt file under another role's folder must not break this role
  // (D-126 already treats it as zero coverage for that role); anything
  // shared or belonging to `role` still fails loudly.
  const ownRolePrefix = `roles/${role}/`;
  const loaded = await Promise.all(
    patchEntries.map(async (file) => {
      try {
        return [file.path, await readJson(`${latest.patch}/${file.path}`)] as const;
      } catch (err) {
        if (file.path.startsWith('roles/') && !file.path.startsWith(ownRolePrefix)) return null;
        throw err;
      }
    }),
  );
  for (const entry of loaded) {
    if (entry !== null) files[entry[0]] = entry[1];
  }

  const champions = Object.values(
    championsMapSchema.parse(requiredFile(files, 'champions.json')),
  );
  const tags = championTagsMapSchema.parse(await readJson('champion-tags.json'));

  const minimal = manifest.minimalRoles.includes(role);
  // Optional display-only file (BL-052): parsed fail-closed like every other
  // manifest file, but kept out of RecommendData (it must not reach the engine).
  const pickRateSamples =
    files['pick-rate-samples.json'] !== undefined
      ? pickRateSamplesSchema.parse(files['pick-rate-samples.json'])
      : undefined;
  return {
    patch: latest.patch,
    generatedAt: latest.generatedAt,
    champions,
    data: createRecommendData(files, champions, tags, role, minimal),
    minimal,
    ...(pickRateSamples !== undefined ? { pickRateSamples } : {}),
  };
}
