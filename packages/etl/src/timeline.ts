/**
 * @draftorb/etl — Timeline ingestion pipeline (T-051 Phase B).
 *
 * Fetches match-v5 timelines for stored matches and runs every pending
 * `TimelineExtractor` over the shared extraction. Resumable per extractor:
 * `extractor_runs` records (match_id, extractor) only after that match's
 * writes commit in one transaction, so kill/restart or transient failures
 * never leave a match half-done. Matches whose participant map is unusable
 * are marked done for all extractors to avoid infinite retries.
 *
 * `etl timeline` and `etl backfill-timelines` share this pipeline; the
 * backfill adds `--call-budget` accounting (one timeline call per match).
 */

import type Database from 'better-sqlite3';

import { openDb } from './db';
import { resolveDbPath } from './config/paths';
import { isTransientMatchError } from './matches-process';
import { RiotAuthError, RiotClient, type Platform } from './riot';
import { extractTimelineEvents, type TimelineParticipantRef } from './timeline-events';
import {
  createTimelineExtractors,
  markExtractorDone,
  pendingExtractors,
  TIMELINE_EXTRACTOR_NAMES,
  type TimelineExtractor,
  type TimelineMatchContext,
} from './timeline-extractors';

export interface TimelineRunOptions {
  platform?: Platform;
  /** Max matches processed this run (resumable across runs). */
  limit?: number;
  /** Stop after this many timeline API calls (backfill budget). */
  callBudget?: number;
  db?: Database.Database;
  client?: RiotClient;
  onProgress?: (message: string) => void;
}

export interface TimelineRunResult {
  platform?: Platform;
  candidates: number;
  fetched: number;
  events: number;
  extractorsDone: number;
  skipped: number;
  failed: number;
  stoppedEarly: boolean;
  budgetExhausted: boolean;
}

interface MatchRow {
  match_id: string;
  platform: string;
  patch: string;
}

interface ParticipantRow {
  puuid: string;
  team_id: number;
  role: string;
}

function loadParticipants(db: Database.Database, matchId: string): Map<string, ParticipantRow> {
  const rows = db
    .prepare('SELECT puuid, team_id, role FROM participants WHERE match_id = ?')
    .all(matchId) as ParticipantRow[];
  return new Map(rows.map((row) => [row.puuid, row]));
}

function buildRefs(
  timelineParticipants: ReadonlyArray<{ participantId: number; puuid: string }>,
  byPuuid: ReadonlyMap<string, ParticipantRow>,
): TimelineParticipantRef[] {
  const refs: TimelineParticipantRef[] = [];
  for (const p of timelineParticipants) {
    const stored = byPuuid.get(p.puuid);
    if (stored === undefined) continue;
    refs.push({
      participantId: p.participantId,
      puuid: p.puuid,
      teamId: stored.team_id,
      role: stored.role,
    });
  }
  return refs;
}

/** Matches missing at least one extractor run, newest first. */
function pendingMatches(
  db: Database.Database,
  platform: Platform | undefined,
  limit: number | undefined,
  extractors: readonly TimelineExtractor[],
): MatchRow[] {
  const names = extractors.map((e) => e.name);
  const placeholders = names.map(() => '?').join(',');
  const wherePlatform = platform === undefined ? '' : 'AND m.platform = ?';
  // Bind order follows SQL text: extractor names, count, platform, limit.
  const params: Array<string | number> = [...names, names.length];
  if (platform !== undefined) params.push(platform);
  const limitSql = limit === undefined ? '' : 'LIMIT ?';
  if (limit !== undefined) params.push(limit);

  return db
    .prepare(
      `SELECT m.match_id, m.platform, m.patch FROM matches m
       WHERE (
         SELECT COUNT(DISTINCT extractor) FROM extractor_runs r
         WHERE r.match_id = m.match_id AND r.extractor IN (${placeholders})
       ) < ?
       ${wherePlatform}
       ORDER BY m.created_at DESC, m.match_id
       ${limitSql}`,
    )
    .all(...params) as MatchRow[];
}

/**
 * Runs pending extractors for up to `limit` matches (or until `callBudget`
 * timeline calls are consumed). Per-match failures are logged and counted;
 * the run stops early after 3 consecutive transient failures.
 */
export async function runTimelinePipeline(
  options: TimelineRunOptions = {},
): Promise<TimelineRunResult> {
  const log = options.onProgress ?? (() => {});

  const ownsDb = options.db === undefined;
  const db = options.db ?? openDb(resolveDbPath());
  const client = options.client ?? new RiotClient({ autoLoadEnv: true });
  try {
    return await runTimelinePipelineInner(db, options, log, client);
  } finally {
    if (ownsDb) db.close();
  }
}

async function runTimelinePipelineInner(
  db: Database.Database,
  options: TimelineRunOptions,
  log: (message: string) => void,
  client: RiotClient,
): Promise<TimelineRunResult> {
  const extractors = createTimelineExtractors(db);
  const matches = pendingMatches(db, options.platform, options.limit, extractors);

  const result: TimelineRunResult = {
    platform: options.platform,
    candidates: matches.length,
    fetched: 0,
    events: 0,
    extractorsDone: 0,
    skipped: 0,
    failed: 0,
    stoppedEarly: false,
    budgetExhausted: false,
  };

  let calls = 0;
  let consecutiveFailed = 0;
  for (const [index, match] of matches.entries()) {
    if (options.callBudget !== undefined && calls >= options.callBudget) {
      result.budgetExhausted = true;
      break;
    }
    const context: TimelineMatchContext = {
      matchId: match.match_id,
      platform: match.platform,
      patch: match.patch,
    };
    const pending = pendingExtractors(db, match.match_id, extractors);
    if (pending.length === 0) continue;

    try {
      calls += 1;
      const timeline = await client.getMatchTimeline(
        match.platform as Parameters<RiotClient['getMatchTimeline']>[0],
        match.match_id,
      );

      const byPuuid = loadParticipants(db, match.match_id);
      const refs = buildRefs(timeline.info.participants ?? [], byPuuid);

      if (refs.length === 0) {
        // No usable participant map: mark every extractor done so the match
        // is not retried forever, but write no events.
        const mark = db.transaction(() => {
          for (const extractor of pending) {
            markExtractorDone(db, match.match_id, extractor.name);
          }
        });
        mark.immediate();
        result.skipped += 1;
        log(`[${index + 1}/${matches.length}] match skipped: no participant map`);
        continue;
      }

      const extracted = extractTimelineEvents(timeline, refs);
      result.events += extracted.itemEvents.length + extracted.killEvents.length;

      const write = db.transaction(() => {
        for (const extractor of pending) {
          extractor.extract(extracted, context, refs, timeline);
          markExtractorDone(db, match.match_id, extractor.name);
          result.extractorsDone += 1;
        }
      });
      write.immediate();

      result.fetched += 1;
      consecutiveFailed = 0;
      log(
        `[${index + 1}/${matches.length}] ${result.fetched} match(es) processed, ` +
          `${result.events} raw event(s) so far`,
      );
    } catch (error) {
      if (error instanceof RiotAuthError) throw error;
      if (isTransientMatchError(error)) {
        result.failed += 1;
        consecutiveFailed += 1;
        log(`[${index + 1}/${matches.length}] transient failure`);
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
    `Timeline pipeline ${result.stoppedEarly ? 'stopped early' : 'complete'}: ` +
      `${result.fetched} matches, ${result.events} events, ` +
      `${result.extractorsDone} extractor runs, ${result.skipped} skipped, ` +
      `${result.failed} failed${result.budgetExhausted ? `, call budget ${options.callBudget} reached` : ''}.`,
  );
  return result;
}

// Re-exported for callers that only need the extractor name list.
export { TIMELINE_EXTRACTOR_NAMES };
