/**
 * Public export loader for the pick screen (BL-009).
 *
 * Reads the cached aggregate tree written by `aggregates.ts`
 * (`latest.json`, `<patch>/manifest.json`, every manifest file plus the
 * manual `champion-tags.json` at the archive root) and builds the
 * `RecommendData` the engine consumes. SUPPORT only for v1a; the role
 * parameter is already threaded so v1b can enable more roles from data.
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
import { readDataFile } from './aggregates';

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

/**
 * Loads the full pick-screen dataset from the data cache.
 * Returns null when nothing is cached (first launch, download failed).
 */
export async function loadPickData(role: Role): Promise<PickData | null> {
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

  const files: Record<string, unknown> = {};
  for (const file of manifest.files) {
    files[file.path] = await readJson(`${latest.patch}/${file.path}`);
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
