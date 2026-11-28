/**
 * @draftorb/etl — Profile starter-bundle backfill (BL-060).
 *
 * Games synced before migration 023 keep `profile_games.starter_bundle_json`
 * NULL forever: the incremental profile-sync cursor treats stored match_ids
 * as duplicates and never re-fetches their timelines. This pass re-fetches
 * the match detail + timeline by stored `match_id` for every NULL row and
 * writes the same net starter-window bundle `profile-sync` computes
 * (`extractProfileStarterItems`, BL-059), so historical games join the
 * myData starter evidence after the next export.
 *
 * Resumable without a cursor: the pending set is derived from the NULL
 * column itself, so kill/restart simply resumes where it stopped. Each row
 * costs two Riot calls (match detail for the participant map, timeline for
 * the purchases); `--limit` and `--call-budget` bound each run. Progress
 * messages never contain match ids, puuids or profile ids beyond counts
 * (D-078).
 *
 * A row whose bundle is genuinely empty is written as `'[]'` (not NULL) so
 * it is not refetched on every run; the export maps both forms to
 * `starterItems: null`. Rows that fail permanently (match detail no longer
 * available, schema mismatch, participant absent) are also marked `'[]'` —
 * the same "checked, nothing to record" convention as the challenges
 * backfill. Transient failures leave the row NULL for the next run.
 */

import type Database from 'better-sqlite3';

import { openDb, migrate } from './db';
import { resolveDbPath } from './config/paths';
import { extractProfileStarterItems } from './profile-games';
import { isTransientMatchError } from './matches-process';
import { RiotAuthError, RiotClient } from './riot';

export interface ProfileStartersBackfillOptions {
  /** Backfill only this stored profile id; default = all profiles. */
  profileId?: string;
  /** Max games processed this run (resumable across runs). */
  limit?: number;
  /** Stop after this many Riot API calls (2 per game: detail + timeline). */
  callBudget?: number;
  db?: Database.Database;
  client?: RiotClient;
  onProgress?: (message: string) => void;
}

export interface ProfileStartersBackfillResult {
  candidates: number;
  /** Rows whose bundle was fetched and written (including empty '[]'). */
  processed: number;
  /** Rows marked '[]' without a bundle (permanent failure / no participant). */
  skipped: number;
  /** Transient failures left NULL for the next run. */
  failed: number;
  stoppedEarly: boolean;
  budgetExhausted: boolean;
}

interface PendingGameRow {
  profile_id: string;
  match_id: string;
  puuid: string;
  region: string;
}

/** Stored profile games still missing a starter bundle, newest first. */
function pendingGames(
  db: Database.Database,
  profileId: string | undefined,
  limit: number | undefined,
): PendingGameRow[] {
  const whereProfile = profileId === undefined ? '' : 'AND g.profile_id = ?';
  const limitSql = limit === undefined ? '' : 'LIMIT ?';
  const params: Array<string | number> = [];
  if (profileId !== undefined) params.push(profileId);
  if (limit !== undefined) params.push(limit);

  return db
    .prepare(
      `SELECT g.profile_id, g.match_id, p.puuid, p.region
       FROM profile_games g
       JOIN profiles p ON p.id = g.profile_id
       WHERE g.starter_bundle_json IS NULL
       ${whereProfile}
       ORDER BY g.created_at DESC, g.match_id
       ${limitSql}`,
    )
    .all(...params) as PendingGameRow[];
}

/** JSON written for a computed bundle; '[]' marks "checked, nothing recorded". */
function bundleJson(items: readonly { itemId: number; count: number }[]): string {
  return items.length === 0 ? '[]' : JSON.stringify(items);
}

/**
 * Backfills `profile_games.starter_bundle_json` for up to `limit` pending
 * games (or until `callBudget` Riot calls are consumed). Per-game transient
 * failures are logged and counted; the run stops early after 3 consecutive
 * failures.
 */
export async function runProfileStartersBackfill(
  options: ProfileStartersBackfillOptions = {},
): Promise<ProfileStartersBackfillResult> {
  const log = options.onProgress ?? (() => {});

  const ownsDb = options.db === undefined;
  const db = options.db ?? openDb(resolveDbPath());
  const client = options.client ?? new RiotClient({ autoLoadEnv: true });
  try {
    // The column exists only after migration 023; migrate is idempotent.
    migrate(db);
    return await runProfileStartersBackfillInner(db, options, log, client);
  } finally {
    if (ownsDb) db.close();
  }
}

async function runProfileStartersBackfillInner(
  db: Database.Database,
  options: ProfileStartersBackfillOptions,
  log: (message: string) => void,
  client: RiotClient,
): Promise<ProfileStartersBackfillResult> {
  const games = pendingGames(db, options.profileId, options.limit);

  const result: ProfileStartersBackfillResult = {
    candidates: games.length,
    processed: 0,
    skipped: 0,
    failed: 0,
    stoppedEarly: false,
    budgetExhausted: false,
  };

  const updateStmt = db.prepare(
    'UPDATE profile_games SET starter_bundle_json = ? WHERE profile_id = ? AND match_id = ?',
  );
  const write = db.transaction((profileId: string, matchId: string, json: string) => {
    updateStmt.run(json, profileId, matchId);
  });

  let calls = 0;
  let consecutiveFailed = 0;
  const budgetLeft = (): boolean => options.callBudget === undefined || calls < options.callBudget;

  for (const [index, game] of games.entries()) {
    if (!budgetLeft()) {
      result.budgetExhausted = true;
      break;
    }
    try {
      // Match detail carries the participant map (puuid -> participantId,
      // teamId, teamPosition) needed for the same pseudo-participant-0
      // support-quest attribution profile-sync applies (BL-059 parity).
      calls += 1;
      const match = await client.getMatch(
        game.region as Parameters<RiotClient['getMatch']>[0],
        game.match_id,
      );
      if (!budgetLeft()) {
        // Spent the budget on the detail call; the row stays NULL and the
        // next run refetches both calls.
        result.budgetExhausted = true;
        break;
      }
      calls += 1;
      const timeline = await client.getMatchTimeline(
        game.region as Parameters<RiotClient['getMatchTimeline']>[0],
        game.match_id,
      );

      const participant = match.info.participants.find((p) => p.puuid === game.puuid);
      const participantId = participant?.participantId;
      if (participantId === undefined) {
        // The stored puuid is absent from the match detail: nothing honest
        // to record, mark the row checked so it is not retried forever.
        write.immediate(game.profile_id, game.match_id, '[]');
        result.skipped += 1;
        consecutiveFailed = 0;
        log(`[${index + 1}/${games.length}] participant not found in match detail`);
        continue;
      }
      const items = extractProfileStarterItems(timeline, match.info.participants, participantId);
      write.immediate(game.profile_id, game.match_id, bundleJson(items));
      result.processed += 1;
      consecutiveFailed = 0;
      log(`[${index + 1}/${games.length}] ${result.processed} game(s) backfilled`);
    } catch (error) {
      if (error instanceof RiotAuthError) throw error;
      if (isTransientMatchError(error)) {
        result.failed += 1;
        consecutiveFailed += 1;
        log(`[${index + 1}/${games.length}] transient failure`);
        if (consecutiveFailed >= 3) {
          result.stoppedEarly = true;
          break;
        }
        continue;
      }
      // Permanent failure (e.g. match/timeline no longer available): mark the
      // row checked with '[]' so the pending set drains.
      write.immediate(game.profile_id, game.match_id, '[]');
      result.skipped += 1;
      consecutiveFailed = 0;
      log(`[${index + 1}/${games.length}] match data unavailable`);
    }
  }

  log(
    `Profile starter backfill ${result.stoppedEarly ? 'stopped early' : 'complete'}: ` +
      `${result.processed} games backfilled, ${result.skipped} skipped, ` +
      `${result.failed} failed` +
      `${result.budgetExhausted ? `, call budget ${options.callBudget} reached` : ''}.`,
  );

  return result;
}
