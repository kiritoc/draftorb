/**
 * @draftorb/etl — `profile-sync` orchestration (T-091, D-068..D-071).
 *
 * For each configured profile: resolve the Riot ID to a puuid (account-v1,
 * re-resolved every run so a key change only needs the stored rows re-keyed,
 * D-071), fetch ranked solo/duo match ids (match-v5 queue 420) incrementally
 * via a resumable snapshot cursor, store `profile_games`, refresh
 * `profile_mastery` (champion-mastery-v4 top), then export the anonymized
 * JSON. A failed Riot call aborts that profile before export, so the
 * previously published JSON and the stored rows are kept (D-070).
 */

import type Database from 'better-sqlite3';
import { join } from 'node:path';

import type { ProfileConfigEntry } from '@draftorb/shared';

import { ETL_CONFIG } from './config/etl-config';
import { defaultPublicDataDir, resolveDbPath } from './config/paths';
import { openDb, migrate } from './db';
import { extractItemsOrdered, extractProfileGame } from './profile-games';
import { LOCAL_PROFILE_EXPORT_DIR, writeProfileExports } from './profile-export';
import { loadProfilesConfig, profileRouting } from './profiles-config';
import { MATCH_IDS_PAGE_SIZE } from './matches-store';
import { DEFAULT_MIN_DURATION_SECONDS, RANKED_SOLO_QUEUE_ID } from './matches';
import { RiotAuthError, RiotClient, type RegionalRouting } from './riot';
import { CliError, UsageError } from './cli-args';

/** Games older than this are never stored: the export caps at 180 days (D-069). */
const PROFILE_RETENTION_MS = ETL_CONFIG.profileMaxAgeDays * 86_400_000;
/** Extra slack so same-second boundary games are not skipped by `startTime`. */
const CURSOR_OVERLAP_SECONDS = 1;
export interface ProfileCursor {
  snapshot: string[];
  processed: number;
  lastGameCreation: number;
  updatedAt: number;
}

export interface ProfileSyncOptions {
  /** Sync only this config entry id; default = all configured profiles. */
  profileId?: string;
  /** Write exports to `data/public/profiles/`; otherwise `data/users/profiles/`. */
  publish?: boolean;
  /** Max new games fetched per profile per run (default ETL_CONFIG.profileSyncMaxGames). */
  maxGames?: number;
  configPath?: string;
  /** Export target overrides (tests). */
  exportDir?: string;
  db?: Database.Database;
  client?: RiotClient;
  /** Injected clock (ms) for deterministic tests. */
  now?: () => number;
  onProgress?: (message: string) => void;
}

export interface ProfileSyncProfileResult {
  id: string;
  status: 'synced' | 'skipped' | 'failed';
  listed: number;
  stored: number;
  duplicates: number;
  filtered: number;
  invalid: number;
  mastery: number;
  exported: boolean;
  error?: string;
}

export interface ProfileSyncResult {
  profiles: ProfileSyncProfileResult[];
  written: string[];
  warnings: string[];
}

function cursorKey(profileId: string): string {
  return `profile-sync:${profileId}`;
}

function readCursor(db: Database.Database, key: string): ProfileCursor | null {
  const row = db.prepare('SELECT value FROM ingest_state WHERE key = ?').get(key) as
    { value: string } | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as Partial<ProfileCursor>;
    if (!Array.isArray(parsed.snapshot) || typeof parsed.processed !== 'number') {
      return null;
    }
    return {
      snapshot: parsed.snapshot.filter((id): id is string => typeof id === 'string'),
      processed: Math.max(0, Math.min(parsed.processed, parsed.snapshot.length)),
      lastGameCreation: typeof parsed.lastGameCreation === 'number' ? parsed.lastGameCreation : 0,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

function writeCursor(db: Database.Database, key: string, cursor: ProfileCursor): void {
  db.prepare(
    `INSERT INTO ingest_state (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, JSON.stringify(cursor));
}

async function listProfileMatchIds(
  client: RiotClient,
  region: RegionalRouting,
  puuid: string,
  startTimeSeconds: number | undefined,
): Promise<string[]> {
  const ids: string[] = [];
  let start = 0;
  for (;;) {
    const page = await client.getMatchIdsByPuuid(region, puuid, {
      queue: RANKED_SOLO_QUEUE_ID,
      type: 'ranked',
      start,
      count: MATCH_IDS_PAGE_SIZE,
      startTime: startTimeSeconds,
    });
    ids.push(...page);
    if (page.length < MATCH_IDS_PAGE_SIZE) break;
    start += page.length;
  }
  return [...new Set(ids)];
}

interface ProfileRow {
  puuid: string;
  last_game_creation: number | null;
}

function readProfileRow(db: Database.Database, id: string): ProfileRow | null {
  return (
    (db.prepare('SELECT puuid, last_game_creation FROM profiles WHERE id = ?').get(id) as
      ProfileRow | undefined) ?? null
  );
}

const INSERT_GAME = `INSERT INTO profile_games (
  profile_id, match_id, created_at, champion_id, role, win,
  ally_adc_id, enemy_support_id, enemy_adc_id, enemy_champions_json,
  keystone, primary_style, sub_style, perks_json,
  items_json, items_ordered_json, summoner1_id, summoner2_id
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * Sync one configured profile. Exported for tests; throws on RiotAuthError
 * and on unexpected errors (the caller marks the profile failed).
 */
export async function syncProfile(
  db: Database.Database,
  entry: ProfileConfigEntry,
  options: {
    client: RiotClient;
    maxGames: number;
    now: () => number;
    onProgress?: (message: string) => void;
  },
): Promise<ProfileSyncProfileResult> {
  const { client, maxGames, now, onProgress } = options;
  const log = onProgress ?? (() => {});
  const { platform, region } = profileRouting(entry);
  const result: ProfileSyncProfileResult = {
    id: entry.id,
    status: 'synced',
    listed: 0,
    stored: 0,
    duplicates: 0,
    filtered: 0,
    invalid: 0,
    mastery: 0,
    exported: false,
  };

  // Resolve the Riot ID on every run (D-071): a key change re-keys the stored
  // puuid here, and profile_games are matched by match_id + champion data.
  const account = await client.getAccountByRiotId(
    region,
    entry.riotId.gameName,
    entry.riotId.tagLine,
  );
  const puuid = account.puuid;

  const previousCursor = readProfileRow(db, entry.id)?.last_game_creation ?? null;
  db.prepare(
    `INSERT INTO profiles (id, puuid, game_name, tag_line, platform, region, synced_at, last_game_creation)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       puuid = excluded.puuid,
       game_name = excluded.game_name,
       tag_line = excluded.tag_line,
       platform = excluded.platform,
       region = excluded.region`,
  ).run(
    entry.id,
    puuid,
    entry.riotId.gameName,
    entry.riotId.tagLine,
    entry.platform,
    region,
    now(),
    previousCursor,
  );

  const key = cursorKey(entry.id);
  let cursor = readCursor(db, key);
  if (cursor === null) {
    cursor = {
      snapshot: [],
      processed: 0,
      lastGameCreation: previousCursor ?? 0,
      updatedAt: 0,
    };
    // First run (or missing cursor): snapshot the full id list once — ids are
    // listed newest-first and processing stops at the retention cutoff, so
    // only in-window games cost a detail fetch.
    const startTimeSeconds =
      cursor.lastGameCreation > 0
        ? Math.floor(cursor.lastGameCreation / 1000) - CURSOR_OVERLAP_SECONDS
        : undefined;
    cursor.snapshot = await listProfileMatchIds(client, region, puuid, startTimeSeconds);
    result.listed = cursor.snapshot.length;
    writeCursor(db, key, cursor);
  } else if (cursor.processed >= cursor.snapshot.length) {
    // Caught up: list only matches newer than the cursor (D-018 pattern).
    const startTimeSeconds =
      cursor.lastGameCreation > 0
        ? Math.floor(cursor.lastGameCreation / 1000) - CURSOR_OVERLAP_SECONDS
        : undefined;
    const fresh = await listProfileMatchIds(client, region, puuid, startTimeSeconds);
    result.listed = fresh.length;
    if (fresh.length > 0) {
      cursor = {
        snapshot: fresh,
        processed: 0,
        lastGameCreation: cursor.lastGameCreation,
        updatedAt: now(),
      };
      writeCursor(db, key, cursor);
    }
  } else {
    result.listed = cursor.snapshot.length - cursor.processed;
  }

  const storedGame = db.prepare(
    'SELECT created_at FROM profile_games WHERE profile_id = ? AND match_id = ?',
  );
  const insertGame = db.prepare(INSERT_GAME);
  const cutoffMs = now() - PROFILE_RETENTION_MS;
  let fetched = 0;
  let maxCreatedSeen = cursor.lastGameCreation;
  let truncated = false;

  for (let i = cursor.processed; i < cursor.snapshot.length; i += 1) {
    if (fetched >= maxGames) break;
    const matchId = cursor.snapshot[i] as string;

    const existing = storedGame.get(entry.id, matchId) as { created_at: number } | undefined;
    if (existing) {
      // Already stored: advance the cursor past it using the stored timestamp
      // so incremental listing never revisits it.
      result.duplicates += 1;
      maxCreatedSeen = Math.max(maxCreatedSeen, existing.created_at);
      cursor.processed = i + 1;
      continue;
    }

    const match = await client.getMatch(region, matchId);
    fetched += 1;
    maxCreatedSeen = Math.max(maxCreatedSeen, match.info.gameCreation);

    if (match.info.gameCreation < cutoffMs) {
      // Ids are listed newest-first: everything after this is older than the
      // export window and is never needed (D-069 caps at 180 days).
      truncated = true;
      cursor.snapshot = cursor.snapshot.slice(0, i + 1);
      cursor.processed = i + 1;
      break;
    }
    if (
      match.info.queueId !== RANKED_SOLO_QUEUE_ID ||
      match.info.gameDuration <= DEFAULT_MIN_DURATION_SECONDS
    ) {
      result.filtered += 1;
      cursor.processed = i + 1;
      continue;
    }

    const extraction = extractProfileGame(match, puuid);
    if (extraction === null) {
      result.invalid += 1;
      cursor.processed = i + 1;
      continue;
    }

    let itemsOrderedJson: string | null = null;
    try {
      const timeline = await client.getMatchTimeline(region, matchId);
      const itemsOrdered = extractItemsOrdered(timeline, extraction.participantId);
      itemsOrderedJson = itemsOrdered === null ? null : JSON.stringify(itemsOrdered);
    } catch (error) {
      if (error instanceof RiotAuthError) throw error;
      // Timeline is best-effort: the game is still stored with NULL order.
      log(
        `timeline fetch failed for ${matchId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const persist = db.transaction(() => {
      insertGame.run(
        entry.id,
        extraction.row.match_id,
        extraction.row.created_at,
        extraction.row.champion_id,
        extraction.row.role,
        extraction.row.win,
        extraction.row.ally_adc_id,
        extraction.row.enemy_support_id,
        extraction.row.enemy_adc_id,
        extraction.row.enemy_champions_json,
        extraction.row.keystone,
        extraction.row.primary_style,
        extraction.row.sub_style,
        extraction.row.perks_json,
        extraction.row.items_json,
        itemsOrderedJson,
        extraction.row.summoner1_id,
        extraction.row.summoner2_id,
      );
      cursor.processed = i + 1;
      cursor.updatedAt = now();
      writeCursor(db, key, cursor);
    });
    persist();
    result.stored += 1;
  }

  const caughtUp = truncated || cursor.processed >= cursor.snapshot.length;
  if (caughtUp) {
    cursor.lastGameCreation = maxCreatedSeen;
    cursor.updatedAt = now();
    writeCursor(db, key, cursor);
    db.prepare('UPDATE profiles SET last_game_creation = ? WHERE id = ?').run(
      maxCreatedSeen,
      entry.id,
    );
  } else {
    writeCursor(db, key, cursor);
  }

  // Mastery refresh: one call per profile per run, replaces stored rows.
  const mastery = await client.getChampionMasteryTop(platform, puuid);
  const replaceMastery = db.transaction(() => {
    db.prepare('DELETE FROM profile_mastery WHERE profile_id = ?').run(entry.id);
    const insert = db.prepare(
      `INSERT INTO profile_mastery (profile_id, champion_id, mastery_points, mastery_level, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const masteryEntry of mastery) {
      insert.run(
        entry.id,
        masteryEntry.championId,
        masteryEntry.championPoints,
        masteryEntry.championLevel ?? null,
        now(),
      );
    }
  });
  replaceMastery();
  result.mastery = mastery.length;

  // synced_at marks the last SUCCESSFUL sync: it is stamped here, after every
  // Riot call and write above, so a failed run keeps the previous export's
  // timestamp instead of presenting stale rows as fresh (D-070).
  db.prepare('UPDATE profiles SET synced_at = ? WHERE id = ?').run(now(), entry.id);

  // Export is the last step of writeProfileExports: any Riot failure above
  // keeps the previously published files and the stored rows (D-070).
  result.exported = true;
  log(
    `${entry.id}: listed=${result.listed} stored=${result.stored} dup=${result.duplicates} ` +
      `filtered=${result.filtered} invalid=${result.invalid} mastery=${result.mastery}` +
      (caughtUp ? ' (caught up)' : ' (partial — rerun to resume)'),
  );
  return result;
}

/**
 * Run `profile-sync` for the configured profiles. Exports are written once
 * per run into `exportDir` (public when `publish`, local otherwise).
 */
export async function syncProfiles(options: ProfileSyncOptions = {}): Promise<ProfileSyncResult> {
  const log = options.onProgress ?? (() => {});
  const now = options.now ?? (() => Date.now());
  const config = loadProfilesConfig(options.configPath);
  const entries = options.profileId
    ? config.profiles.filter((entry) => entry.id === options.profileId)
    : config.profiles;
  if (entries.length === 0) {
    throw new UsageError(
      `Unknown profile id "${options.profileId}". Configured: ${config.profiles.map((p) => p.id).join(', ')}`,
    );
  }

  // Validate every selected platform before any network call.
  for (const entry of entries) profileRouting(entry);

  const ownsDb = options.db === undefined;
  const db = options.db ?? openDb(resolveDbPath());
  const client = options.client ?? new RiotClient({ autoLoadEnv: true });
  try {
    migrate(db);
    const maxGames = options.maxGames ?? ETL_CONFIG.profileSyncMaxGames;
    const results: ProfileSyncProfileResult[] = [];

    for (const entry of entries) {
      try {
        results.push(await syncProfile(db, entry, { client, maxGames, now, onProgress: log }));
      } catch (error) {
        if (error instanceof RiotAuthError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        log(`profile "${entry.id}" failed: ${message}`);
        results.push({
          id: entry.id,
          status: 'failed',
          listed: 0,
          stored: 0,
          duplicates: 0,
          filtered: 0,
          invalid: 0,
          mastery: 0,
          exported: false,
          error: message,
        });
      }
    }

    const exportDir =
      options.exportDir ??
      (options.publish === true
        ? join(defaultPublicDataDir(), 'profiles')
        : LOCAL_PROFILE_EXPORT_DIR);
    const { written, warnings } = writeProfileExports(db, config, { dir: exportDir, nowMs: now() });
    for (const warning of warnings) log(`Warning: ${warning}`);
    for (const path of written) log(`wrote ${path}`);

    const failed = results.filter((r) => r.status === 'failed');
    if (failed.length > 0) {
      throw new CliError(
        `profile-sync failed for ${failed.length} profile(s): ${failed.map((f) => f.id).join(', ')}`,
      );
    }
    return { profiles: results, written, warnings };
  } finally {
    if (ownsDb) db.close();
  }
}
