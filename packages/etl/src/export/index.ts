/**
 * @draftorb/etl — JSON export orchestration.
 *
 * Reads the aggregated SQLite tables and writes the versioned, role-keyed JSON
 * layout described in DATA_MODEL.md §Exported JSON, plus `manifest.json`.
 * Pure file-content building lives in the sibling modules; all filesystem /
 * `node:` IO, hashing, and size checks live in `./io.js`. The public entry
 * point remains `exportJson` (re-exported here), so `./export` keeps resolving
 * to this module.
 *
 * Read-only: never writes to SQLite. Run `pnpm etl aggregate` first, then
 * `pnpm etl export` to materialize the tables as JSON.
 */

import type Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DEFAULT_CONFIG, type RankWeightingConfig } from '@draftorb/engine';
import {
  LATEST_SCHEMA_VERSION,
  manifestSchema,
  type Latest,
  type Manifest,
  type Role,
  latestSchema,
} from '@draftorb/shared';
import { latestPatch, PATCH_PATTERN } from '../aggregate';
import { readAggregateSnapshot } from '../aggregate-meta';
import { comparePatches } from '../matches-store';
import { defaultPublicDataDir } from '../config/paths';
import { buildManifest } from './manifest.js';
import { buildRuneFiles } from './runes.js';
import { buildBuildFiles } from './builds.js';
import {
  buildTableFile,
  TABLE_SPECS,
  type AllyPairRow,
  type BaselineRow,
  type EnemyPairRow,
  type LaneFullRow,
  type LaneVsRow,
} from './role-tables.js';
import { roleProbFile, type RoleProbRow } from './role-prob.js';
import { pickRateFile } from './pick-rate.js';
import type { ItemBuildRow } from './builds.js';
import type { RuneCtxRow } from './runes.js';
import {
  MAX_FILE_BYTES,
  type ExportFile,
  cleanupStaleExportDirs,
  createTempDir,
  oversizeWarning,
  publishTempDir,
  readStaticCatalogs,
  removeTempDir,
  STATIC_CATALOG_FILES,
  writeFile,
  writeFileAtomic,
} from './io.js';

export const EXPORT_ROLES: readonly Role[] = ['SUPPORT'];

export interface ExportOptions {
  config?: RankWeightingConfig;
  patch?: string;
  publicDir?: string;
  roles?: readonly Role[];
  maxFileBytes?: number;
  now?: () => Date;
  region?: string;
  /** @internal Runs after each file has been written to the temporary export. */
  hooks?: { afterWrite?(relativePath: string): void };
}

export interface ExportResult {
  patch: string;
  manifest: Manifest;
  files: ExportFile[];
  warnings: string[];
  skippedRunePages: number;
  /** Path of the written `latest.json`, or null when the pointer was left untouched. */
  latestPath: string | null;
}

/** Typed wrapper around `db.prepare(sql).all()` so query results are never
 *  cast with `as` at the call site. This is the project's single typed
 *  `all<T>()` helper for query results. */
function all<T>(db: Database.Database, sql: string, params: readonly unknown[] = []): T[] {
  const statement = db.prepare(sql);
  return (params.length === 0 ? statement.all() : statement.all(...params)) as T[];
}

/** Latest-patch pointer already published in `publicDir`, or undefined when
 *  `latest.json` is absent or does not validate against latestSchema.
 *  `intact` is true only when the manifest the pointer references exists,
 *  validates against manifestSchema, and names the same patch: a dangling
 *  pointer (e.g. after a partial restore) must not block recovery exports. */
function readPublishedPointer(publicDir: string): { patch: string; intact: boolean } | undefined {
  const latestPath = join(publicDir, 'latest.json');
  if (!existsSync(latestPath)) {
    return undefined;
  }
  let latest: Latest;
  try {
    const parsed = latestSchema.safeParse(JSON.parse(readFileSync(latestPath, 'utf8')));
    if (!parsed.success) {
      return undefined;
    }
    latest = parsed.data;
  } catch {
    return undefined;
  }
  const manifestPath = join(publicDir, latest.manifest);
  let intact = false;
  try {
    if (existsSync(manifestPath)) {
      const manifest = manifestSchema.safeParse(JSON.parse(readFileSync(manifestPath, 'utf8')));
      intact = manifest.success && manifest.data.patch === latest.patch;
    }
  } catch {
    intact = false;
  }
  return { patch: latest.patch, intact };
}

export function exportJson(db: Database.Database, options: ExportOptions = {}): ExportResult {
  const config = options.config ?? DEFAULT_CONFIG;
  // C6: the invariant is enforced by the engine's rankWeightingConfigSchema;
  // assert it explicitly here so programmatic misuse throws a clear error
  // (exportJson keeps its plain Error, distinct from the CLI's UsageError).
  if (config.exportMinGames > config.minGames) {
    throw new Error(
      `exportMinGames (${config.exportMinGames}) must be <= minGames (${config.minGames})`,
    );
  }
  const exportMinGames = config.exportMinGames;
  const roles = options.roles ?? EXPORT_ROLES;
  const maxFileBytes = options.maxFileBytes ?? MAX_FILE_BYTES;
  const now = options.now ?? (() => new Date());

  if (options.patch !== undefined && !PATCH_PATTERN.test(options.patch)) {
    throw new Error(`Invalid patch "${options.patch}". Expected a format like "16.21".`);
  }

  const dbLatestPatch = latestPatch(db);
  const targetPatch = options.patch ?? dbLatestPatch;
  if (targetPatch === undefined) {
    throw new Error(
      'No patch found in the database; nothing to export. Run `pnpm etl matches` first.',
    );
  }
  const warnings: string[] = [];
  // Aggregate tables carry no patch column: they reflect the latest aggregation.
  if (dbLatestPatch !== undefined && targetPatch !== dbLatestPatch) {
    warnings.push(
      `export: requested patch ${targetPatch} differs from the latest patch in the database (${dbLatestPatch}); ` +
        'aggregate tables are not patch-scoped, so exported data reflects the last `pnpm etl aggregate` run',
    );
  }

  const publicDir = options.publicDir ?? process.env.DRAFTORB_PUBLIC_DIR ?? defaultPublicDataDir();
  cleanupStaleExportDirs(publicDir, targetPatch);
  const sourcePatchDir = join(publicDir, targetPatch);
  const roleSnapshots = ['champions.bootstrap.json', 'champions.derived.json']
    .filter((name) => existsSync(join(sourcePatchDir, name)))
    .map((name) => ({
      relativePath: name,
      content: readFileSync(join(sourcePatchDir, name), 'utf8'),
    }));

  // --- Query all aggregated tables (typed, ordered) ---
  const roleProbRows = all<RoleProbRow>(
    db,
    `SELECT champion_id AS championId, role AS role, games_w AS gamesW, games_w2 AS gamesW2, prob AS prob
     FROM role_prob ORDER BY champion_id, role`,
  );

  const baselineRows = all<BaselineRow>(db, TABLE_SPECS[0].sql);
  const allyPairRows = all<AllyPairRow>(db, TABLE_SPECS[1].sql);
  const enemyPairRows = all<EnemyPairRow>(db, TABLE_SPECS[2].sql);
  const laneVsRows = all<LaneVsRow>(db, TABLE_SPECS[3].sql);
  const laneFullRows = all<LaneFullRow>(db, TABLE_SPECS[4].sql);

  const runeRows = all<RuneCtxRow>(
    db,
    `SELECT champion_id AS championId, my_role AS myRole, rank_bucket AS rankBucket,
           context_key AS contextKey, context_level AS contextLevel,
           perks_hash AS perksHash, perks_json AS perksJson,
           wins_w AS winsW, games_w AS gamesW, games_w2 AS gamesW2, players AS players
     FROM rune_ctx ORDER BY champion_id, my_role, rank_bucket, context_key, context_level`,
  );

  const buildRows = all<ItemBuildRow>(
    db,
    `SELECT champion_id AS championId, my_role AS myRole, slot_idx AS slotIdx,
           time_bucket AS timeBucket, state_bucket AS stateBucket,
           profile_key AS profileKey, lane_key AS laneKey,
           item_id AS itemId, wins_w AS winsW, games_w AS gamesW, games_w2 AS gamesW2
     FROM item_build ORDER BY champion_id, my_role, slot_idx, time_bucket, state_bucket, profile_key, lane_key`,
  );

  // --- Region (C5) ---
  const platformRows = all<{ platform: string }>(
    db,
    `SELECT DISTINCT platform AS platform FROM matches ORDER BY platform`,
  );
  const first = platformRows[0];
  const region = options.region ?? first?.platform ?? 'euw1';
  // Aggregates are never filtered by platform, so warn whenever data is mixed,
  // including when --region is given explicitly.
  if (platformRows.length > 1 && first !== undefined) {
    const label =
      options.region !== undefined
        ? `labelled as ${region}`
        : `using alphabetically first ${first.platform}`;
    warnings.push(
      `export: database contains ${platformRows.length} platforms (` +
        `${platformRows.map((r) => r.platform).join(', ')}); ${label}; aggregates combine all platforms`,
    );
  }

  // --- Build file contents (compact JSON for data files; manifest uses null, 2) ---
  const filesToWrite: Array<{ relativePath: string; content: string }> = [];

  filesToWrite.push(roleProbFile(roleProbRows, exportMinGames));
  filesToWrite.push(pickRateFile(roleProbRows, exportMinGames));

  for (const role of roles) {
    filesToWrite.push(
      buildTableFile(TABLE_SPECS[0], baselineRows, role, exportMinGames),
      buildTableFile(TABLE_SPECS[1], allyPairRows, role, exportMinGames),
      buildTableFile(TABLE_SPECS[2], enemyPairRows, role, exportMinGames),
      buildTableFile(TABLE_SPECS[3], laneVsRows, role, exportMinGames),
      buildTableFile(TABLE_SPECS[4], laneFullRows, role, exportMinGames),
    );
  }

  const runeResult = buildRuneFiles(runeRows, roles, exportMinGames);
  filesToWrite.push(...runeResult.files);
  const skippedRunePages = runeResult.skippedRunePages;
  if (skippedRunePages > 0) {
    warnings.push(
      `export: skipped ${skippedRunePages} rune page(s) with unparseable or invalid perks_json`,
    );
  }

  filesToWrite.push(...buildBuildFiles(buildRows, roles, exportMinGames).files);

  // D-055: publish the patch-catalog state the aggregates were computed
  // against (patch_index, currentPatchIndex, catalog max) so the snapshot
  // stays explainable when `patches` later grows. Written only when an
  // aggregate run recorded it; older databases simply omit the file.
  const snapshotMeta = readAggregateSnapshot(db);
  if (snapshotMeta !== undefined) {
    filesToWrite.push({
      relativePath: 'patch-meta.json',
      content: JSON.stringify(snapshotMeta, null, 2),
    });
  }

  // --- Atomic write to a sibling temp dir, then publish (C4) ---
  const targetDir = join(publicDir, targetPatch);
  // Carry over static catalogs from `pnpm etl static` so publishing does not
  // delete them, and list them in the manifest.
  const staticCatalogs = readStaticCatalogs(targetDir);
  if (staticCatalogs.length < STATIC_CATALOG_FILES.length) {
    warnings.push(
      `export: missing static catalog(s) in ${targetDir}; run \`pnpm etl static ${targetPatch}\``,
    );
  }
  filesToWrite.push(...staticCatalogs);
  const tempDir = createTempDir(publicDir, targetPatch);
  let published = false;
  try {
    for (const { relativePath, content } of roleSnapshots) {
      writeFile(tempDir, relativePath, content);
    }

    const written: ExportFile[] = [];
    for (const { relativePath, content } of filesToWrite) {
      const entry = writeFile(tempDir, relativePath, content);
      options.hooks?.afterWrite?.(relativePath);
      const warn = oversizeWarning(relativePath, content, maxFileBytes);
      if (warn !== null) {
        warnings.push(warn);
      }
      written.push(entry);
    }
    // Manifest last, inside the temp dir.
    const generatedAt = now().toISOString();
    const manifest = buildManifest({
      patch: targetPatch,
      generatedAt,
      region,
      roles,
      files: written,
    });
    const manifestEntry = writeFile(tempDir, 'manifest.json', JSON.stringify(manifest, null, 2));
    options.hooks?.afterWrite?.('manifest.json');
    written.push({ ...manifestEntry, relativePath: 'manifest.json' });

    const cleanupWarning = publishTempDir(tempDir, targetDir);
    published = true;
    if (cleanupWarning !== null) warnings.push(cleanupWarning);

    // D-051: write the latest-patch pointer last, after the patch dir is live.
    // Only when the exported patch IS the latest one: re-exporting an older
    // patch must not move the pointer backwards (the patch dir may not even
    // exist yet for a newer dbLatestPatch). A newer pointer already published
    // in publicDir also wins, e.g. after a database reset or restore — but
    // only while it is intact: a dangling pointer (missing or mismatched
    // manifest) does not block an eligible export from replacing it.
    let latestPath: string | null = null;
    const publishedPointer = readPublishedPointer(publicDir);
    const keepNewerPointer =
      publishedPointer !== undefined &&
      publishedPointer.intact &&
      comparePatches(publishedPointer.patch, targetPatch) > 0;
    if (keepNewerPointer) {
      warnings.push(
        `export: latest.json already points to newer patch ${publishedPointer.patch}; keeping it`,
      );
    } else {
      if (publishedPointer !== undefined && !publishedPointer.intact) {
        warnings.push(
          `export: latest.json points to ${publishedPointer.patch} but its manifest is missing or invalid`,
        );
      }
      if (dbLatestPatch === undefined || targetPatch === dbLatestPatch) {
        const latest = latestSchema.parse({
          schemaVersion: LATEST_SCHEMA_VERSION,
          patch: targetPatch,
          manifest: `${targetPatch}/manifest.json`,
          generatedAt,
        });
        latestPath = writeFileAtomic(publicDir, 'latest.json', JSON.stringify(latest, null, 2));
      }
    }

    return {
      patch: targetPatch,
      manifest,
      files: written.map((file) => ({ ...file, path: join(targetDir, file.relativePath) })),
      warnings,
      skippedRunePages,
      latestPath,
    };
  } finally {
    if (!published) {
      removeTempDir(tempDir);
    }
  }
}

export type { ExportFile };
