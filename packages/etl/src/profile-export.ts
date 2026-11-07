/**
 * @draftorb/etl — Profile export (T-091, D-069/D-074, DATA_MODEL.md).
 *
 * Builds the anonymized `ProfileExport` JSON from `profile_games` /
 * `profile_mastery` and writes `profiles/<id>.json` + `index.json`.
 * The anonymization whitelist is enforced structurally: only the fields of
 * `profileGameSchema` are ever written — no match ids, no foreign player
 * identifiers (covered by tests).
 */

import type Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  profileExportSchema,
  profileIndexSchema,
  type ProfileConfig,
  type ProfileConfigEntry,
  type ProfileExport,
  type ProfileGame,
  type ProfileIndex,
  type ProfileIndexEntry,
} from '@draftorb/shared';

import { ETL_CONFIG } from './config/etl-config';
import type { ProfileGameRow } from './profile-games';

const DAY_MS = 86_400_000;

/** Local (gitignored) export target used when `--publish` is not passed. */
export const LOCAL_PROFILE_EXPORT_DIR = join('data', 'users', 'profiles');

interface StoredGameRow extends ProfileGameRow {
  profile_id: string;
}

function parseJsonArray(text: string): number[] {
  const parsed: unknown = JSON.parse(text);
  return Array.isArray(parsed) ? parsed.filter((v): v is number => typeof v === 'number') : [];
}

interface StoredPerks {
  styles?: { selections?: { perk?: number }[] }[];
  statPerks?: { defense?: number; flex?: number; offense?: number };
}

/** Rebuild the whitelisted rune fields from the stored perks payload. */
function exportRunes(row: StoredGameRow): ProfileGame['runes'] {
  if (row.keystone === null || row.primary_style === null || row.sub_style === null) {
    return null;
  }
  if (row.perks_json === null) {
    return null;
  }
  let perks: StoredPerks;
  try {
    perks = JSON.parse(row.perks_json) as StoredPerks;
  } catch {
    return null;
  }
  const perkIds = (perks.styles ?? []).flatMap((style) =>
    (style.selections ?? [])
      .map((selection) => selection.perk)
      .filter((perk): perk is number => typeof perk === 'number'),
  );
  const statShardIds = [
    perks.statPerks?.defense,
    perks.statPerks?.flex,
    perks.statPerks?.offense,
  ].filter((id): id is number => typeof id === 'number');
  return {
    keystoneId: row.keystone,
    primaryStyleId: row.primary_style,
    subStyleId: row.sub_style,
    perkIds,
    statShardIds,
  };
}

function toProfileGame(row: StoredGameRow): ProfileGame {
  return {
    createdAtDay: Math.floor(row.created_at / DAY_MS),
    championId: row.champion_id,
    role: row.role,
    win: row.win === 1,
    allyAdcId: row.ally_adc_id,
    enemySupportId: row.enemy_support_id,
    enemyAdcId: row.enemy_adc_id,
    enemyChampionIds: parseJsonArray(row.enemy_champions_json),
    runes: exportRunes(row),
    items: parseJsonArray(row.items_json),
    itemsOrdered: row.items_ordered_json === null ? null : parseJsonArray(row.items_ordered_json),
    summonerSpells: [row.summoner1_id, row.summoner2_id],
  };
}

/** Recency weight shared with SPECS §18.2 (`0.5^(age_days / halfLife)`). */
export function profileRecencyWeight(ageDays: number): number {
  return 0.5 ** (ageDays / ETL_CONFIG.profileHalfLifeDays);
}

interface MasteryRow {
  champion_id: number;
  mastery_points: number;
  mastery_level: number | null;
}

function loadMastery(db: Database.Database, profileId: string): MasteryRow[] {
  return db
    .prepare(
      `SELECT champion_id, mastery_points, mastery_level
       FROM profile_mastery WHERE profile_id = ?
       ORDER BY mastery_points DESC, champion_id`,
    )
    .all(profileId) as MasteryRow[];
}

/**
 * Compute favorites over the exported game set (D-074): top
 * `profileFavRecencyCount` champions by recency-weighted SUPPORT games in
 * the last `profileFavRecencyDays`, union top `profileFavMasteryCount` by
 * mastery points.
 */
export function computeFavorites(
  games: readonly ProfileGame[],
  mastery: readonly { championId: number; points: number }[],
  nowMs: number,
): ProfileExport['favorites'] {
  const weights = new Map<number, number>();
  for (const game of games) {
    if (game.role !== 'SUPPORT') continue;
    const ageDays = (nowMs - game.createdAtDay * DAY_MS) / DAY_MS;
    if (ageDays > ETL_CONFIG.profileFavRecencyDays) continue;
    weights.set(
      game.championId,
      (weights.get(game.championId) ?? 0) + profileRecencyWeight(ageDays),
    );
  }
  const recency = [...weights.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, ETL_CONFIG.profileFavRecencyCount)
    .map(([championId]) => championId);

  const masteryTop = [...mastery]
    .sort((a, b) => b.points - a.points || a.championId - b.championId)
    .slice(0, ETL_CONFIG.profileFavMasteryCount)
    .map((entry) => entry.championId);

  const combined = [...recency];
  for (const id of masteryTop) {
    if (!combined.includes(id)) combined.push(id);
  }
  return { combined, recency, mastery: masteryTop };
}

/**
 * Build the validated `ProfileExport` for one config entry from the stored
 * rows, applying the D-069 caps (last `profileMaxAgeDays`, at most
 * `profileMaxGames`). `nowMs` is injectable for deterministic tests.
 */
export function buildProfileExport(
  db: Database.Database,
  entry: ProfileConfigEntry,
  nowMs: number,
): ProfileExport {
  const profile = db.prepare('SELECT synced_at FROM profiles WHERE id = ?').get(entry.id) as
    { synced_at: number } | undefined;
  const syncedAtMs = profile?.synced_at ?? nowMs;

  const maxGames = entry.options?.profileMaxGames ?? ETL_CONFIG.profileDefaultMaxGames;
  const ageCutoffMs = nowMs - ETL_CONFIG.profileMaxAgeDays * DAY_MS;
  const rows = db
    .prepare(
      `SELECT * FROM profile_games WHERE profile_id = ?
       ORDER BY created_at DESC, match_id`,
    )
    .all(entry.id) as StoredGameRow[];

  const games = rows
    .filter((row) => row.created_at >= ageCutoffMs)
    .slice(0, maxGames)
    .map(toProfileGame);

  const mastery = loadMastery(db, entry.id).map((row) => ({
    championId: row.champion_id,
    points: row.mastery_points,
    level: row.mastery_level,
  }));

  return profileExportSchema.parse({
    schemaVersion: 1,
    id: entry.id,
    riotId: { ...entry.riotId, platform: entry.platform },
    label: entry.label,
    syncedAt: Math.floor(syncedAtMs / 1000),
    gameCount: games.length,
    favorites: computeFavorites(games, mastery, nowMs),
    games,
    mastery,
  });
}

function exportFileName(entry: ProfileConfigEntry): string {
  return `${entry.id}.json`;
}

/** Read an already-exported profile file's header fields for the index. */
function readExportSummary(
  dir: string,
  entry: ProfileConfigEntry,
): { syncedAt: number; gameCount: number } | null {
  const path = join(dir, exportFileName(entry));
  if (!existsSync(path)) return null;
  try {
    const parsed = profileExportSchema.parse(JSON.parse(readFileSync(path, 'utf-8')));
    return { syncedAt: parsed.syncedAt, gameCount: parsed.gameCount };
  } catch {
    return null;
  }
}

/**
 * Write `<id>.json` for every configured profile that has stored data (or an
 * existing export), then regenerate `index.json` from the files present.
 * Returns the written file paths.
 */
export function writeProfileExports(
  db: Database.Database,
  config: ProfileConfig,
  options: { dir: string; nowMs: number },
): { written: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const written: string[] = [];
  mkdirSync(options.dir, { recursive: true });

  for (const entry of config.profiles) {
    const hasProfile = db.prepare('SELECT 1 FROM profiles WHERE id = ?').get(entry.id);
    const hasGames = db
      .prepare('SELECT 1 FROM profile_games WHERE profile_id = ? LIMIT 1')
      .get(entry.id);
    const hasExisting = existsSync(join(options.dir, exportFileName(entry)));
    if (!hasProfile && !hasGames && !hasExisting) {
      continue;
    }
    if (!hasProfile) {
      warnings.push(`profile "${entry.id}" has exported data but no profiles row; skipped`);
      continue;
    }
    const exported = buildProfileExport(db, entry, options.nowMs);
    const path = join(options.dir, exportFileName(entry));
    writeFileSync(path, `${JSON.stringify(exported)}\n`, 'utf-8');
    written.push(path);
  }

  // Index covers every configured profile with a readable export file —
  // including profiles synced by earlier runs into the same directory.
  const indexProfiles: ProfileIndexEntry[] = [];
  for (const entry of config.profiles) {
    const summary = readExportSummary(options.dir, entry);
    if (summary === null) continue;
    indexProfiles.push({
      id: entry.id,
      riotId: entry.riotId,
      platform: entry.platform,
      label: entry.label,
      syncedAt: summary.syncedAt,
      gameCount: summary.gameCount,
      file: exportFileName(entry),
    });
  }
  const index: ProfileIndex = profileIndexSchema.parse({
    schemaVersion: 1,
    profiles: indexProfiles,
  });
  const indexPath = join(options.dir, 'index.json');
  writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf-8');
  written.push(indexPath);
  return { written, warnings };
}
