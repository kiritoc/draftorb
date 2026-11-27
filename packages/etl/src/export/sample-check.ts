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

import { DEFAULT_CONFIG, nEff, recommend } from '@draftorb/engine';
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
  type BaselineTable,
  type ChampionId,
  type RecommendData,
  type Role,
} from '@draftorb/shared';

/** Roles the desktop app currently enables (mirrors `DEFAULT_ENABLED_ROLES`,
 *  apps/desktop/ui/src/config.ts). Only these block a release on an empty
 *  recommendation list; other exported roles are reported as warnings so a
 *  thin TOP/JUNGLE sample never holds back SUPPORT data (BL-011, D-126). */
export const RELEASE_BLOCKING_ROLES: readonly Role[] = ['SUPPORT'];

/** D-126 enablement rule, mirrored from the desktop UI
 *  (apps/desktop/ui/src/config.ts `ROLE_COVERAGE_*`): a role is selectable
 *  only when this many distinct champions have a baseline row with
 *  `n_eff >= minGames` in the DIAMOND bucket. The export check warns when a
 *  role would stay disabled so thin ADC/MID coverage is visible before
 *  publish (PR #161 review). */
const ROLE_COVERAGE_MIN_CHAMPIONS = 50;
const ROLE_COVERAGE_BUCKET = 'DIAMOND';

/** Distinct champions clearing the D-126 baseline coverage gate. */
function coveredChampionCount(baseline: BaselineTable): number {
  const covered = new Set<number>();
  for (const [championId, bucket, , gamesW, gamesW2] of baseline) {
    if (bucket !== ROLE_COVERAGE_BUCKET) continue;
    if (nEff(gamesW, gamesW2) >= DEFAULT_CONFIG.minGames) covered.add(championId);
  }
  return covered.size;
}

export interface PublishedExportCheckOptions {
  /** Root of the exported data tree (contains `latest.json` and `<patch>/`). */
  publicDir: string;
  /** Path to the manual champion tags file (`data/manual/champion-tags.json`). */
  tagsFilePath: string;
  /** Roles whose empty recommendation list fails the check
   *  (default `RELEASE_BLOCKING_ROLES`). */
  blockingRoles?: readonly Role[];
}

export interface PublishedExportCheckResult {
  patch: string;
  roles: readonly Role[];
  /** role -> number of "Best overall" recommendations at Diamond. */
  recommendationCounts: Readonly<Record<string, number>>;
  /** Human-readable problems; empty means the export is healthy. */
  errors: string[];
  /** Non-blocking problems (exported roles the app does not enable yet). */
  warnings: string[];
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
  minimalRoles: readonly Role[];
  files: Record<string, unknown>;
} {
  const latest = latestSchema.parse(readJson(join(publicDir, 'latest.json')));
  const manifest = manifestSchema.parse(readJson(join(publicDir, latest.manifest)));
  const files: Record<string, unknown> = {};
  for (const file of manifest.files) {
    files[file.path] = readJson(join(publicDir, manifest.patch, file.path));
  }
  return {
    patch: manifest.patch,
    roles: manifest.roles,
    minimalRoles: manifest.minimalRoles,
    files,
  };
}

/** Build the engine input for one exported role, mirroring the web loader.
 *  Minimal roles (BL-024) export `baseline.json` only: their pair/lane
 *  tables are empty, which is exactly what the engine's minimal mode
 *  consumes (it skips those layers anyway). */
function recommendDataForRole(
  role: Role,
  minimal: boolean,
  files: Readonly<Record<string, unknown>>,
  championIds: readonly ChampionId[],
  tags: ReturnType<typeof championTagsMapSchema.parse>,
): RecommendData {
  const req = (path: string): unknown => requiredFile(files, path);
  const table = (path: string): unknown => (minimal ? [] : req(path));
  return {
    baselines: baselineTableSchema.parse(req(`roles/${role}/baseline.json`)),
    allyPairs: allyPairTableSchema.parse(table(`roles/${role}/ally-pairs.json`)),
    enemyPairs: enemyPairTableSchema.parse(table(`roles/${role}/enemy-pairs.json`)),
    laneVs: laneVsTableSchema.parse(table(`roles/${role}/lane-vs.json`)),
    laneFull: laneFullTableSchema.parse(table(`roles/${role}/lane-full.json`)),
    roleProb: championRoleProbabilitiesSchema.parse(req('role-prob.json')),
    ...(files['pick-rate.json'] !== undefined
      ? { pickRate: pickRateSchema.parse(files['pick-rate.json']) }
      : {}),
    tags,
    championIds: [...championIds],
  };
}

/**
 * Validates the published export: every exported role is schema-validated;
 * each blocking role must yield at least one "Best overall" recommendation at
 * Diamond, other roles only produce `warnings`. Throws on unreadable or
 * schema-invalid files; returns per-role counts, `errors` and `warnings`.
 */
export function checkPublishedExport(
  options: PublishedExportCheckOptions,
): PublishedExportCheckResult {
  const { publicDir, tagsFilePath, blockingRoles = RELEASE_BLOCKING_ROLES } = options;
  const { patch, roles, minimalRoles, files } = loadPublishedExport(publicDir);
  const champions = championsMapSchema.parse(readJson(join(publicDir, patch, 'champions.json')));
  const championIds = Object.values(champions).map((champion) => champion.id);
  const tags = championTagsMapSchema.parse(readJson(tagsFilePath));

  const recommendationCounts: Record<string, number> = {};
  const errors: string[] = [];
  const warnings: string[] = [];

  if (roles.length === 0) {
    errors.push('Manifest exports no roles.');
  }
  for (const role of roles) {
    const data = recommendDataForRole(role, minimalRoles.includes(role), files, championIds, tags);
    const result = recommend(
      { userRank: 'DIAMOND', userRole: role, allies: [], enemies: [], blindPick: true },
      data,
    );
    recommendationCounts[role] = result.recommendations.length;
    if (result.recommendations.length === 0) {
      const message = `No "Best overall" recommendations for role ${role}.`;
      if (blockingRoles.includes(role)) {
        errors.push(message);
      } else {
        warnings.push(`${message} (not enabled in the app; not release-blocking)`);
      }
    }
    const covered = coveredChampionCount(data.baselines);
    if (covered < ROLE_COVERAGE_MIN_CHAMPIONS) {
      warnings.push(
        `Role ${role}: ${covered} champions pass the D-126 coverage gate ` +
          `(< ${ROLE_COVERAGE_MIN_CHAMPIONS} at n_eff >= ${DEFAULT_CONFIG.minGames} ` +
          `in ${ROLE_COVERAGE_BUCKET}); the role stays disabled in the app.`,
      );
    }
  }

  return { patch, roles, recommendationCounts, errors, warnings };
}
