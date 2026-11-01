/**
 * @draftorb/etl — JSON export.
 *
 * Reads the aggregated SQLite tables (role_prob, baseline, pair tables, lane
 * tables, rune_ctx, item_build) and writes the versioned, role-keyed JSON
 * layout described in DATA_MODEL.md §Exported JSON, plus `manifest.json`.
 *
 * Read-only: never writes to SQLite. Run `pnpm etl aggregate` first to
 * populate the tables, then `pnpm etl export` to materialize them as JSON.
 */

import type Database from 'better-sqlite3';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { RankBucket, Role } from '@draftorb/shared';
import {
  z,
  allyPairEntrySchema,
  baselineEntrySchema,
  enemyPairEntrySchema,
  laneFullEntrySchema,
  laneVsEntrySchema,
  manifestSchema,
  MANIFEST_SCHEMA_VERSION,
  type Manifest,
} from '@draftorb/shared';
import { DEFAULT_CONFIG, nEff, type RankWeightingConfig } from '@draftorb/engine';
import { latestPatch, PATCH_PATTERN } from './aggregate';
import { defaultPublicDataDir } from './config/paths';

export const EXPORT_ROLES: readonly Role[] = ['SUPPORT'];

/** Size budget per exported file (gzip), DATA_MODEL.md §Exported JSON. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export interface ExportOptions {
  config?: RankWeightingConfig;
  patch?: string;
  publicDir?: string;
}

export interface ExportFile {
  path: string;
  relativePath: string;
  bytes: number;
}

export interface ExportResult {
  patch: string;
  manifest: Manifest;
  files: ExportFile[];
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** A row survives export only when its equivalent sample size clears the gate. */
function passesGate(gamesW: number, gamesW2: number, exportMinGames: number): boolean {
  return nEff(gamesW, gamesW2) >= exportMinGames;
}

/** Parses a stored rune `perks_json` into the exported page fields. */
function parseRunePage(perksJson: string): {
  primaryStyleId: number;
  subStyleId: number;
  keystoneId: number;
  selectedPerkIds: number[];
  statShardIds: number[];
} | null {
  let perks: unknown;
  try {
    perks = JSON.parse(perksJson);
  } catch {
    return null;
  }
  const obj = perks as Record<string, unknown> | null;
  if (!obj || typeof obj !== 'object') return null;
  const styles = (obj as { styles?: unknown }).styles;
  if (!Array.isArray(styles) || styles.length < 2) return null;
  const primary = styles[0] as { style?: unknown; selections?: unknown };
  const secondary = styles[1] as { style?: unknown; selections?: unknown };
  const primaryStyleId = typeof primary?.style === 'number' ? primary.style : 0;
  const subStyleId = typeof secondary?.style === 'number' ? secondary.style : 0;
  const primarySelections = Array.isArray(primary?.selections)
    ? (primary.selections as Array<{ perk?: unknown }>)
    : [];
  const keystoneId = typeof primarySelections[0]?.perk === 'number' ? primarySelections[0].perk : 0;
  const selectedPerkIds: number[] = [];
  for (const style of [primary, secondary]) {
    for (const sel of (style?.selections ?? []) as Array<{ perk?: unknown }>) {
      if (typeof sel.perk === 'number') selectedPerkIds.push(sel.perk);
    }
  }
  const statPerks = obj.statPerks as
    { offense?: unknown; defense?: unknown; flex?: unknown } | undefined;
  const statShardIds: number[] = [];
  if (typeof statPerks?.offense === 'number') statShardIds.push(statPerks.offense);
  if (typeof statPerks?.defense === 'number') statShardIds.push(statPerks.defense);
  if (typeof statPerks?.flex === 'number') statShardIds.push(statPerks.flex);
  if (primaryStyleId <= 0 || subStyleId <= 0 || keystoneId <= 0) return null;
  return {
    primaryStyleId,
    subStyleId,
    keystoneId,
    selectedPerkIds,
    statShardIds,
  };
}

interface AnyWeightedRow {
  championId: number;
  myRole: string;
  rankBucket: RankBucket;
  gamesW: number;
  gamesW2: number;
  winsW: number;
  allyId: number;
  enemyId: number;
  role: string;
  opp1Id: number;
  opp2Id: number | null;
  partnerId: number | null;
  games: number;
}

function writeJsonFile(
  writeDir: string,
  fileName: string,
  content: string,
): { path: string; bytes: number } {
  mkdirSync(writeDir, { recursive: true });
  const fullPath = join(writeDir, fileName);
  writeFileSync(fullPath, content, 'utf8');
  return { path: fullPath, bytes: Buffer.byteLength(content, 'utf8') };
}

interface RoleProbAccum {
  [championId: string]: { [role: string]: { gamesW: number; gamesW2: number } };
}

export function exportJson(db: Database.Database, options: ExportOptions = {}): ExportResult {
  const config = options.config ?? DEFAULT_CONFIG;
  const exportMinGames = config.exportMinGames;

  if (options.patch !== undefined && !PATCH_PATTERN.test(options.patch)) {
    throw new Error(`Invalid patch "${options.patch}". Expected a format like "16.21".`);
  }

  const targetPatch = options.patch ?? latestPatch(db);
  if (targetPatch === undefined) {
    throw new Error(
      'No patch found in the database; nothing to export. Run `pnpm etl matches` first.',
    );
  }

  const publicDir = options.publicDir ?? process.env.DRAFTORB_PUBLIC_DIR ?? defaultPublicDataDir();
  const outDir = join(publicDir, targetPatch);
  mkdirSync(outDir, { recursive: true });

  const written: ExportFile[] = [];

  // --- role-prob.json (sparse map, DATA_MODEL.md) ---
  const roleProbRows = db
    .prepare(
      `SELECT champion_id AS championId, role AS role, games_w AS gamesW, games_w2 AS gamesW2
       FROM role_prob`,
    )
    .all() as Array<{ championId: number; role: string; gamesW: number; gamesW2: number }>;

  const roleProb: RoleProbAccum = {};
  for (const row of roleProbRows) {
    if (!passesGate(row.gamesW, row.gamesW2, exportMinGames)) continue;
    const entry = (roleProb[String(row.championId)] ??= {});
    entry[row.role] = { gamesW: row.gamesW, gamesW2: row.gamesW2 };
  }

  // Normalize probabilities so each champion's roles sum to 1, then emit only
  // the probabilities (DATA_MODEL.md: sparse map of championId -> role -> prob).
  const roleProbOut: Record<string, Record<string, number>> = {};
  for (const [championId, roles] of Object.entries(roleProb)) {
    const total = Object.values(roles).reduce((sum, e) => sum + e.gamesW, 0);
    if (total <= 0) continue;
    const probs: Record<string, number> = {};
    for (const role of Object.keys(roles)) {
      const entry = roles[role];
      if (entry) probs[role] = round6(entry.gamesW / total);
    }
    roleProbOut[championId] = probs;
  }

  written.push({
    ...writeJsonFile(outDir, 'role-prob.json', JSON.stringify(roleProbOut, null, 2)),
    relativePath: 'role-prob.json',
  });

  // --- role-keyed table exports ---
  const readRows = (sql: string): AnyWeightedRow[] => db.prepare(sql).all() as AnyWeightedRow[];

  const baselineRows = readRows(
    `SELECT champion_id AS championId, my_role AS myRole, rank_bucket AS rankBucket,
           wins_w AS winsW, games_w AS gamesW, games_w2 AS gamesW2, games AS games
     FROM baseline`,
  ).filter((row) => passesGate(row.gamesW, row.gamesW2, exportMinGames));

  const allyPairRows = readRows(
    `SELECT my_champion_id AS championId, other_champion_id AS allyId, my_role AS myRole,
           rank_bucket AS rankBucket, wins_w AS winsW, games_w AS gamesW, games_w2 AS gamesW2
     FROM pair_ally`,
  ).filter((row) => passesGate(row.gamesW, row.gamesW2, exportMinGames));

  const enemyPairRows = readRows(
    `SELECT my_champion_id AS championId, other_champion_id AS enemyId, my_role AS myRole,
           rank_bucket AS rankBucket, wins_w AS winsW, games_w AS gamesW, games_w2 AS gamesW2
     FROM pair_enemy`,
  ).filter((row) => passesGate(row.gamesW, row.gamesW2, exportMinGames));

  const laneVsRows = readRows(
    `SELECT my_champion_id AS championId, my_role AS myRole, opp1_id AS opp1Id, opp2_id AS opp2Id,
           rank_bucket AS rankBucket, wins_w AS winsW, games_w AS gamesW, games_w2 AS gamesW2
     FROM lane_vs`,
  ).filter((row) => passesGate(row.gamesW, row.gamesW2, exportMinGames));

  const laneFullRows = readRows(
    `SELECT my_champion_id AS championId, my_role AS myRole, partner_id AS partnerId, opp1_id AS opp1Id, opp2_id AS opp2Id,
           rank_bucket AS rankBucket, wins_w AS winsW, games_w AS gamesW, games_w2 AS gamesW2
     FROM lane_full`,
  ).filter((row) => passesGate(row.gamesW, row.gamesW2, exportMinGames));

  const roleFileSpecs: Array<{
    name: string;
    rows: AnyWeightedRow[];
    schema: z.ZodTypeAny;
  }> = [
    { name: 'baseline.json', rows: baselineRows, schema: baselineEntrySchema },
    { name: 'ally-pairs.json', rows: allyPairRows, schema: allyPairEntrySchema },
    { name: 'enemy-pairs.json', rows: enemyPairRows, schema: enemyPairEntrySchema },
    { name: 'lane-vs.json', rows: laneVsRows, schema: laneVsEntrySchema },
    { name: 'lane-full.json', rows: laneFullRows, schema: laneFullEntrySchema },
  ];

  for (const role of EXPORT_ROLES) {
    const writeDir = join(outDir, 'roles', role);
    for (const { name, rows, schema } of roleFileSpecs) {
      const tupleRows: unknown[][] = [];
      for (const r of rows) {
        if (r.myRole !== role) continue;
        let tuple: unknown[];
        if (name === 'baseline.json') {
          tuple = [
            r.championId,
            r.rankBucket,
            round6(r.winsW),
            round6(r.gamesW),
            round6(r.gamesW2),
            r.games,
          ];
        } else if (name === 'ally-pairs.json') {
          tuple = [
            r.championId,
            r.allyId,
            r.myRole,
            r.rankBucket,
            round6(r.winsW),
            round6(r.gamesW),
            round6(r.gamesW2),
          ];
        } else if (name === 'enemy-pairs.json') {
          tuple = [
            r.championId,
            r.enemyId,
            r.myRole,
            r.rankBucket,
            round6(r.winsW),
            round6(r.gamesW),
            round6(r.gamesW2),
          ];
        } else if (name === 'lane-vs.json') {
          tuple = [
            r.championId,
            r.opp1Id,
            r.opp2Id,
            r.rankBucket,
            round6(r.winsW),
            round6(r.gamesW),
            round6(r.gamesW2),
          ];
        } else {
          tuple = [
            r.championId,
            r.partnerId,
            r.opp1Id,
            r.opp2Id,
            r.rankBucket,
            round6(r.winsW),
            round6(r.gamesW),
            round6(r.gamesW2),
          ];
        }
        tupleRows.push(tuple);
      }
      schema.array().parse(tupleRows);
      const relativePath = `roles/${role}/${name}`;
      const file = writeJsonFile(writeDir, name, JSON.stringify(tupleRows, null, 2));
      written.push({ ...file, relativePath });
    }
  }

  // --- runes: roles/<ROLE>/runes/<championId>.json ---
  const runeRows = db
    .prepare(
      `SELECT champion_id AS championId, my_role AS myRole, rank_bucket AS rankBucket,
             context_key AS contextKey, context_level AS contextLevel,
             perks_hash AS perksHash, perks_json AS perksJson,
             wins_w AS winsW, games_w AS gamesW, games_w2 AS gamesW2, players AS players
       FROM rune_ctx`,
    )
    .all() as Array<{
    championId: number;
    myRole: string;
    rankBucket: RankBucket;
    contextKey: string;
    contextLevel: number;
    perksHash: string;
    perksJson: string;
    winsW: number;
    gamesW: number;
    gamesW2: number;
    players: number;
  }>;

  const runeByChampion = new Map<number, typeof runeRows>();
  for (const row of runeRows) {
    if (!passesGate(row.gamesW, row.gamesW2, exportMinGames)) continue;
    if (!EXPORT_ROLES.includes(row.myRole as Role)) continue;
    const existing = runeByChampion.get(row.championId);
    if (existing === undefined) {
      runeByChampion.set(row.championId, [row]);
    } else {
      existing.push(row);
    }
  }

  for (const [championId, rows] of runeByChampion) {
    const contextsByKey = new Map<string, typeof runeRows>();
    for (const row of rows) {
      const existing = contextsByKey.get(row.contextKey);
      if (existing === undefined) {
        contextsByKey.set(row.contextKey, [row]);
      } else {
        existing.push(row);
      }
    }
    const contexts = [];
    for (const [contextKey, ctxRows] of contextsByKey) {
      const pages = [];
      for (const row of ctxRows) {
        const page = parseRunePage(row.perksJson);
        if (page === null) continue;
        pages.push({
          primaryStyleId: page.primaryStyleId,
          subStyleId: page.subStyleId,
          keystoneId: page.keystoneId,
          selectedPerkIds: page.selectedPerkIds,
          statShardIds: page.statShardIds,
          winsW: round6(row.winsW),
          gamesW: round6(row.gamesW),
          gamesW2: round6(row.gamesW2),
          winrate: row.gamesW > 0 ? round6(row.winsW / row.gamesW) : 0,
          pickShare: 0,
          players: row.players,
        });
      }
      const level = ctxRows[0]!.contextLevel;
      contexts.push({ contextKey, contextLevel: level, pages });
    }
    contexts.sort(
      (a, b) => a.contextLevel - b.contextLevel || a.contextKey.localeCompare(b.contextKey),
    );
    const validContexts = contexts.filter((c) => c.pages.length > 0);
    if (validContexts.length === 0) continue;
    const myRole = rows[0]!.myRole;
    const content = JSON.stringify({ championId, myRole, contexts: validContexts }, null, 2);
    const runeDir = join(outDir, 'roles', myRole, 'runes');
    const file = writeJsonFile(runeDir, `${championId}.json`, content);
    written.push({ ...file, relativePath: `roles/${myRole}/runes/${championId}.json` });
  }

  // --- builds: roles/<ROLE>/builds/<championId>.json ---
  const buildRows = db
    .prepare(
      `SELECT champion_id AS championId, my_role AS myRole, slot_idx AS slotIdx,
             time_bucket AS timeBucket, state_bucket AS stateBucket,
             profile_key AS profileKey, lane_key AS laneKey,
             item_id AS itemId, wins_w AS winsW, games_w AS gamesW, games_w2 AS gamesW2
       FROM item_build`,
    )
    .all() as Array<{
    championId: number;
    myRole: string;
    slotIdx: number;
    timeBucket: string;
    stateBucket: string;
    profileKey: string;
    laneKey: string;
    itemId: number;
    winsW: number;
    gamesW: number;
    gamesW2: number;
  }>;

  const buildByChampion = new Map<number, typeof buildRows>();
  for (const row of buildRows) {
    if (!passesGate(row.gamesW, row.gamesW2, exportMinGames)) continue;
    if (!EXPORT_ROLES.includes(row.myRole as Role)) continue;
    const existing = buildByChampion.get(row.championId);
    if (existing === undefined) {
      buildByChampion.set(row.championId, [row]);
    } else {
      existing.push(row);
    }
  }

  for (const [championId, rows] of buildByChampion) {
    const contextsByKey = new Map<string, typeof buildRows>();
    for (const row of rows) {
      const key = `${row.slotIdx}|${row.timeBucket}|${row.stateBucket}|${row.profileKey}|${row.laneKey ?? ''}`;
      const existing = contextsByKey.get(key);
      if (existing === undefined) {
        contextsByKey.set(key, [row]);
      } else {
        existing.push(row);
      }
    }
    const contexts = [];
    for (const [key, ctxRows] of contextsByKey) {
      const [slotIdx, timeBucket, stateBucket, profileKey, laneKey] = key.split('|');
      const items = [];
      for (const row of ctxRows) {
        items.push({
          itemId: row.itemId,
          winsW: round6(row.winsW),
          gamesW: round6(row.gamesW),
          gamesW2: round6(row.gamesW2),
          winrate: row.gamesW > 0 ? round6(row.winsW / row.gamesW) : 0,
          pickShare: 0,
        });
      }
      contexts.push({
        slotIdx: Number(slotIdx),
        timeBucket,
        stateBucket,
        profileKey,
        laneKey: laneKey === '' ? undefined : laneKey,
        items,
      });
    }
    const myRole = rows[0]!.myRole;
    const content = JSON.stringify({ championId, myRole, contexts }, null, 2);
    const buildDir = join(outDir, 'roles', myRole, 'builds');
    const file = writeJsonFile(buildDir, `${championId}.json`, content);
    written.push({ ...file, relativePath: `roles/${myRole}/builds/${championId}.json` });
  }

  // --- manifest.json ---
  const regionRow = db
    .prepare(`SELECT DISTINCT platform AS platform FROM matches ORDER BY platform LIMIT 1`)
    .get() as { platform: string } | undefined;
  const region = regionRow?.platform ?? 'euw1';

  const manifestFiles = written
    .filter((f) => f.relativePath !== 'manifest.json')
    .map((f): { path: string; sha256?: string } => {
      const entry: { path: string; sha256?: string } = { path: f.relativePath };
      if (f.bytes > MAX_FILE_BYTES) {
        console.warn(
          `[ETL] export: ${f.relativePath} is ${f.bytes} bytes, above the ${MAX_FILE_BYTES} byte budget; consider raising exportMinGames for this file.`,
        );
      }
      return entry;
    });

  const manifest: Manifest = manifestSchema.parse({
    patch: targetPatch,
    generatedAt: new Date().toISOString(),
    region,
    rankBuckets: [
      'IRON',
      'BRONZE',
      'SILVER',
      'GOLD',
      'PLATINUM',
      'EMERALD',
      'DIAMOND',
      'MASTER_PLUS',
    ],
    roles: [...EXPORT_ROLES],
    files: manifestFiles,
    schemaVersion: MANIFEST_SCHEMA_VERSION,
  });

  const manifestFile = writeJsonFile(outDir, 'manifest.json', JSON.stringify(manifest, null, 2));
  written.push({ ...manifestFile, relativePath: 'manifest.json' });

  return { patch: targetPatch, manifest, files: written };
}
