/**
 * @draftorb/etl — Challenges backfill pipeline (T-122 follow-up).
 *
 * Fetches match-v5 detail for stored matches that are missing
 * `participant_challenges` rows and writes the raw `challenges` objects.
 * One API call per match; resumable because completion is measured by row
 * count against the stored participant count, so reruns only revisit
 * incomplete matches. Logs carry counts only — never match or player ids.
 */

import type Database from 'better-sqlite3';

import { openDb } from './db';
import { resolveDbPath } from './config/paths';
import { isTransientMatchError } from './matches-process';
import { RiotAuthError, RiotClient, type Platform } from './riot';
import { extractChallenges, type ChallengeRow } from './challenges';

export interface ChallengesBackfillOptions {
  platform?: Platform;
  /** Max matches processed this run (resumable across runs). */
  limit?: number;
  /** Stop after this many match-detail API calls. */
  callBudget?: number;
  db?: Database.Database;
  client?: RiotClient;
  onProgress?: (message: string) => void;
}

export interface ChallengesBackfillResult {
  platform?: Platform;
  candidates: number;
  fetched: number;
  rows: number;
  skipped: number;
  failed: number;
  stoppedEarly: boolean;
  budgetExhausted: boolean;
}

interface MatchRow {
  match_id: string;
  platform: string;
}

/** Matches whose challenges row count is below their stored participant count. */
function pendingMatches(
  db: Database.Database,
  platform: Platform | undefined,
  limit: number | undefined,
): MatchRow[] {
  const wherePlatform = platform === undefined ? '' : 'AND m.platform = ?';
  const limitSql = limit === undefined ? '' : 'LIMIT ?';
  const params: Array<string | number> = [];
  if (platform !== undefined) params.push(platform);
  if (limit !== undefined) params.push(limit);

  return db
    .prepare(
      `SELECT m.match_id, m.platform FROM matches m
       WHERE (
         SELECT COUNT(*) FROM participant_challenges c WHERE c.match_id = m.match_id
       ) < (
         SELECT COUNT(*) FROM participants p WHERE p.match_id = m.match_id
       )
       ${wherePlatform}
       ORDER BY m.created_at DESC, m.match_id
       ${limitSql}`,
    )
    .all(...params) as MatchRow[];
}

function writeChallenges(db: Database.Database, matchId: string, rows: ChallengeRow[]): void {
  const insert = db.prepare(
    `INSERT OR REPLACE INTO participant_challenges (match_id, puuid, participant_id, challenges_json)
     VALUES (@match_id, @puuid, @participant_id, @challenges_json)`,
  );
  const write = db.transaction(() => {
    for (const row of rows) {
      insert.run(row);
    }
  });
  write.immediate();
}

/**
 * Backfills `participant_challenges` for up to `limit` matches (or until
 * `callBudget` detail calls are consumed). Per-match transient failures are
 * logged and counted; the run stops early after 3 consecutive failures.
 */
export async function runChallengesBackfill(
  options: ChallengesBackfillOptions = {},
): Promise<ChallengesBackfillResult> {
  const log = options.onProgress ?? (() => {});

  const ownsDb = options.db === undefined;
  const db = options.db ?? openDb(resolveDbPath());
  const client = options.client ?? new RiotClient({ autoLoadEnv: true });
  try {
    return await runChallengesBackfillInner(db, options, log, client);
  } finally {
    if (ownsDb) db.close();
  }
}

async function runChallengesBackfillInner(
  db: Database.Database,
  options: ChallengesBackfillOptions,
  log: (message: string) => void,
  client: RiotClient,
): Promise<ChallengesBackfillResult> {
  const matches = pendingMatches(db, options.platform, options.limit);

  const result: ChallengesBackfillResult = {
    platform: options.platform,
    candidates: matches.length,
    fetched: 0,
    rows: 0,
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

    try {
      calls += 1;
      const detail = await client.getMatch(
        match.platform as Parameters<RiotClient['getMatch']>[0],
        match.match_id,
      );
      const rows = extractChallenges(detail, match.match_id);
      writeChallenges(db, match.match_id, rows);
      result.rows += rows.length;
      result.fetched += 1;
      consecutiveFailed = 0;
      log(`[${index + 1}/${matches.length}] ${result.fetched} match(es) backfilled`);
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
      // Permanent failure (e.g. match detail no longer available): write NULL
      // rows for the stored participants so the match is not retried forever.
      // NULL honestly records "checked, no challenges payload".
      const stored = db
        .prepare('SELECT puuid FROM participants WHERE match_id = ?')
        .all(match.match_id) as Array<{ puuid: string }>;
      writeChallenges(
        db,
        match.match_id,
        stored.map((row) => ({
          match_id: match.match_id,
          puuid: row.puuid,
          participant_id: null,
          challenges_json: null,
        })),
      );
      result.skipped += 1;
      log(`[${index + 1}/${matches.length}] match detail unavailable`);
    }
  }

  log(
    `Challenges backfill ${result.stoppedEarly ? 'stopped early' : 'complete'}: ` +
      `${result.fetched} matches, ${result.rows} rows, ` +
      `${result.skipped} skipped, ${result.failed} failed` +
      `${result.budgetExhausted ? `, call budget ${options.callBudget} reached` : ''}.`,
  );
  return result;
}
