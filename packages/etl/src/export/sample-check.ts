/**
 * @draftorb/etl — Published export sanity check (B-052).
 *
 * `data/public/` is the sample dataset the web app ships with (gitignored,
 * D-079 — populated by `pnpm etl export` locally or `pnpm etl pull`). A
 * degenerate export (e.g. every baseline row below `minGames`) makes every
 * draft render empty lists, so the scheduled ETL run validates the freshly
 * written export through `pnpm etl validate-export` before the exports asset
 * is uploaded. This module holds the check itself; it is also unit-tested
 * against synthetic exports (tests must not read gitignored data).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { recommend } from '@draftorb/engine';
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
  type ChampionId,
  type RecommendData,
  type Role,
} from '@draftorb/shared';

export interface PublishedExportCheckOptions {
  /** Root of the exported data tree (contains `latest.json` and `<patch>/`). */
  publicDir: string;
  /** Path to the manual champion tags file (`data/manual/champion-tags.json`). */
  tagsFilePath: string;
}

export interface PublishedExportCheckResult {
  patch: string;
  roles: readonly Role[];
  /** role -> number of "Best overall" recommendations at Diamond. */
  recommendationCounts: Readonly<Record<string, number>>;
  /** Human-readable problems; empty means the export is healthy. */
  errors: string[];
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function requiredFile(files: Readonly<Record<string, unknown>>, path: string): unknown {
  const file = files[path];
  if (file === undefined) {
    throw new Error(`Required export file is missing: ${path}`);
  }
  return file;
}

/** Load the published export (`latest.json` -> manifest -> listed files). */
function loadPublishedExport(publicDir: string): {
  patch: string;
  roles: readonly Role[];
  files: Record<string, unknown>;
} {
  const latest = latestSchema.parse(readJson(join(publicDir, 'latest.json')));
  const manifest = manifestSchema.parse(readJson(join(publicDir, latest.manifest)));
  const files: Record<string, unknown> = {};
  for (const file of manifest.files) {
    files[file.path] = readJson(join(publicDir, manifest.patch, file.path));
  }
  return { patch: manifest.patch, roles: manifest.roles, files };
}

/** Build the engine input for one exported role, mirroring the web loader. */
function recommendDataForRole(
  role: Role,
  files: Readonly<Record<string, unknown>>,
  championIds: readonly ChampionId[],
  tags: ReturnType<typeof championTagsMapSchema.parse>,
): RecommendData {
  const req = (path: string): unknown => requiredFile(files, path);
  return {
    baselines: baselineTableSchema.parse(req(`roles/${role}/baseline.json`)),
    allyPairs: allyPairTableSchema.parse(req(`roles/${role}/ally-pairs.json`)),
    enemyPairs: enemyPairTableSchema.parse(req(`roles/${role}/enemy-pairs.json`)),
    laneVs: laneVsTableSchema.parse(req(`roles/${role}/lane-vs.json`)),
    laneFull: laneFullTableSchema.parse(req(`roles/${role}/lane-full.json`)),
    roleProb: championRoleProbabilitiesSchema.parse(req('role-prob.json')),
    ...(files['pick-rate.json'] !== undefined
      ? { pickRate: pickRateSchema.parse(files['pick-rate.json']) }
      : {}),
    tags,
    championIds: [...championIds],
  };
}

/**
 * Validates the published export: every exported role must yield at least one
 * "Best overall" recommendation at Diamond. Throws on unreadable or
 * schema-invalid files; returns per-role counts and `errors` otherwise.
 */
export function checkPublishedExport(
  options: PublishedExportCheckOptions,
): PublishedExportCheckResult {
  const { publicDir, tagsFilePath } = options;
  const { patch, roles, files } = loadPublishedExport(publicDir);
  const champions = championsMapSchema.parse(readJson(join(publicDir, patch, 'champions.json')));
  const championIds = Object.values(champions).map((champion) => champion.id);
  const tags = championTagsMapSchema.parse(readJson(tagsFilePath));

  const recommendationCounts: Record<string, number> = {};
  const errors: string[] = [];

  if (roles.length === 0) {
    errors.push('Manifest exports no roles.');
  }
  for (const role of roles) {
    const data = recommendDataForRole(role, files, championIds, tags);
    const result = recommend(
      { userRank: 'DIAMOND', userRole: role, allies: [], enemies: [], blindPick: true },
      data,
    );
    recommendationCounts[role] = result.recommendations.length;
    if (result.recommendations.length === 0) {
      errors.push(`No "Best overall" recommendations for role ${role}.`);
    }
  }

  return { patch, roles, recommendationCounts, errors };
}
