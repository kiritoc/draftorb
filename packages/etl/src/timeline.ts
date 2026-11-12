/**
 * @draftorb/etl — Timeline ingestion (T-051).
 *
 * Fetches match-v5 timelines for stored matches (`fetched_timeline = 0`) and
 * writes `item_events` rows (purchases with `item_slot`, sales, per-event team
 * gold/kills difference). Resumable: a match is marked `fetched_timeline = 1`
 * only after its events are written in the same transaction, so kill/restart
 * resumes where it stopped. Re-running on a fetched match is a no-op unless
 * the row is reset first; the write itself is delete-then-insert idempotent.
 *
 * Item classification uses the Data Dragon `item.json` of the match's own
 * patch (catalog cached per patch per run).
 */

import type Database from 'better-sqlite3';

import { openDb } from './db';
import { resolveDbPath } from './config/paths';
import { createItemCatalogLoader } from './item-catalog';
import { extractItemEvents, type ItemEventRow } from './item-events';
import { isTransientMatchError } from './matches-process';
import { RiotAuthError, RiotClient, type Platform } from './riot';

export interface TimelineIngestionOptions {
  platform?: Platform;
  /** Max matches processed this run (resumable across runs). */
  limit?: number;
  db?: Database.Database;
  client?: RiotClient;
  /** Data Dragon `fetch` override (tests). */
  fetchFn?: typeof fetch;
  onProgress?: (message: string) => void;
}

export interface TimelineIngestionResult {
  platform?: Platform;
  candidates: number;
  fetched: number;
  events: number;
  skipped: number;
  failed: number;
  stoppedEarly: boolean;
}

interface MatchRow {
  match_id: string;
  platform: string;
  patch: string;
}

interface ParticipantTeamRow {
  puuid: string;
  team_id: number;
}

function loadParticipantTeams(db: Database.Database, matchId: string): Map<string, number> {
  const rows = db
    .prepare('SELECT puuid, team_id FROM participants WHERE match_id = ?')
    .all(matchId) as ParticipantTeamRow[];
  return new Map(rows.map((row) => [row.puuid, row.team_id]));
}

function writeItemEvents(
  db: Database.Database,
  matchId: string,
  rows: readonly ItemEventRow[],
): void {
  const remove = db.prepare('DELETE FROM item_events WHERE match_id = ?');
  const insert = db.prepare(
    `INSERT OR REPLACE INTO item_events
     (match_id, puuid, ts, item_id, type, team_gold_diff, kills_diff, item_slot)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const markFetched = db.prepare('UPDATE matches SET fetched_timeline = 1 WHERE match_id = ?');
  const write = db.transaction(() => {
    remove.run(matchId);
    for (const row of rows) {
      insert.run(
        matchId,
        row.puuid,
        row.ts,
        row.item_id,
        row.type,
        row.team_gold_diff,
        row.kills_diff,
        row.item_slot,
      );
    }
    markFetched.run(matchId);
  });
  write.immediate();
}

/**
 * Processes up to `limit` matches with `fetched_timeline = 0`, newest first.
 * Per-match failures are logged and counted; the run stops early after 3
 * consecutive transient failures (same policy as match ingestion).
 */
export async function ingestTimelines(
  options: TimelineIngestionOptions = {},
): Promise<TimelineIngestionResult> {
  const log = options.onProgress ?? (() => {});
  const fetchFn = options.fetchFn ?? fetch;

  const ownsDb = options.db === undefined;
  const db = options.db ?? openDb(resolveDbPath());
  const client = options.client ?? new RiotClient({ autoLoadEnv: true });
  try {
    return await ingestTimelinesInner(db, options, fetchFn, log, client);
  } finally {
    if (ownsDb) db.close();
  }
}

async function ingestTimelinesInner(
  db: Database.Database,
  options: TimelineIngestionOptions,
  fetchFn: typeof fetch,
  log: (message: string) => void,
  client: RiotClient,
): Promise<TimelineIngestionResult> {
  const where = options.platform === undefined ? '' : 'AND platform = ?';
  const params: Array<string | number> = options.platform === undefined ? [] : [options.platform];
  const limitSql = options.limit === undefined ? '' : 'LIMIT ?';
  if (options.limit !== undefined) params.push(options.limit);

  const matches = db
    .prepare(
      `SELECT match_id, platform, patch FROM matches
       WHERE fetched_timeline = 0 ${where}
       ORDER BY created_at DESC, match_id
       ${limitSql}`,
    )
    .all(...params) as MatchRow[];

  const loadCatalog = createItemCatalogLoader(fetchFn, log);
  const result: TimelineIngestionResult = {
    platform: options.platform,
    candidates: matches.length,
    fetched: 0,
    events: 0,
    skipped: 0,
    failed: 0,
    stoppedEarly: false,
  };

  let consecutiveFailed = 0;
  for (const [index, match] of matches.entries()) {
    try {
      const items = await loadCatalog(match.patch);
      if (items === null) {
        result.skipped += 1;
        continue;
      }

      const timeline = await client.getMatchTimeline(
        match.platform as Parameters<RiotClient['getMatchTimeline']>[0],
        match.match_id,
      );

      const teamByPuuid = loadParticipantTeams(db, match.match_id);
      const refs = (timeline.info.participants ?? [])
        .map((p) => {
          const teamId = teamByPuuid.get(p.puuid);
          return teamId === undefined
            ? null
            : { participantId: p.participantId, puuid: p.puuid, teamId };
        })
        .filter((ref): ref is { participantId: number; puuid: string; teamId: number } =>
          Boolean(ref),
        );

      if (refs.length === 0) {
        // Payload carries no usable participant map: mark consumed so the
        // match is not retried forever, but write no events.
        writeItemEvents(db, match.match_id, []);
        result.skipped += 1;
        log(`[${index + 1}/${matches.length}] ${match.match_id}: no participant map, skipped`);
        continue;
      }

      const rows = extractItemEvents(timeline, refs, items);
      writeItemEvents(db, match.match_id, rows);
      result.fetched += 1;
      result.events += rows.length;
      consecutiveFailed = 0;
      log(`[${index + 1}/${matches.length}] ${match.match_id}: ${rows.length} item event(s)`);
    } catch (error) {
      if (error instanceof RiotAuthError) throw error;
      if (isTransientMatchError(error)) {
        result.failed += 1;
        consecutiveFailed += 1;
        log(`[${index + 1}/${matches.length}] transient failure on ${match.match_id}`);
        if (consecutiveFailed >= 3) {
          result.stoppedEarly = true;
          break;
        }
        continue;
      }
      throw error;
    }
  }

  log(
    `Timeline ingestion ${result.stoppedEarly ? 'stopped early' : 'complete'}: ` +
      `${result.fetched} fetched, ${result.events} events, ${result.skipped} skipped, ` +
      `${result.failed} failed.`,
  );
  return result;
}
