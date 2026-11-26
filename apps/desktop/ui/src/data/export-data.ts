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
  pickRateSchema,
  type Champion,
  type ChampionTagsMap,
  type Latest,
  type Manifest,
  type RecommendData,
  type Role,
} from '@draftorb/shared';
import { cacheRead as readDataFile } from './aggregates';

export interface PickData {
  patch: string;
  generatedAt: string;
  champions: Champion[];
  data: RecommendData;
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
 */
export function createRecommendData(
  files: Readonly<Record<string, unknown>>,
  champions: readonly Champion[],
  tags: ChampionTagsMap,
  role: Role,
): RecommendData {
  const prefix = `roles/${role}/`;
  return {
    baselines: baselineTableSchema.parse(requiredFile(files, `${prefix}baseline.json`)),
    allyPairs: allyPairTableSchema.parse(requiredFile(files, `${prefix}ally-pairs.json`)),
    enemyPairs: enemyPairTableSchema.parse(requiredFile(files, `${prefix}enemy-pairs.json`)),
    laneVs: laneVsTableSchema.parse(requiredFile(files, `${prefix}lane-vs.json`)),
    laneFull: laneFullTableSchema.parse(requiredFile(files, `${prefix}lane-full.json`)),
    roleProb: championRoleProbabilitiesSchema.parse(requiredFile(files, 'role-prob.json')),
    ...(files['pick-rate.json'] !== undefined
      ? { pickRate: pickRateSchema.parse(files['pick-rate.json']) }
      : {}),
    tags: championTagsMapSchema.parse(tags),
    championIds: champions.map((champion) => champion.id),
  };
}

interface CachedRelease {
  latest: Latest;
  manifest: Manifest;
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
  const manifest: Manifest = manifestSchema.parse(await readJson(manifestPath));
  if (manifest.patch !== latest.patch) {
    throw new Error(
      `Latest pointer patch ${latest.patch} does not match manifest patch ${manifest.patch}`,
    );
  }
  return { latest, manifest };
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
  const patchEntries = manifest.files.filter((file) => !file.path.startsWith('/'));
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

  return {
    patch: latest.patch,
    generatedAt: latest.generatedAt,
    champions,
    data: createRecommendData(files, champions, tags, role),
  };
}
