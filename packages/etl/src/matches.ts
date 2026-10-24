/**
 * T-013 — Match ingestion.
 *
 * For every discovered player, page through their ranked solo match ids,
 * fetch each match detail, filter (queue / duration / patch), and store the
 * surviving rows in `matches`. Rejected ids go to `match_rejects` so a match
 * shared by several players is fetched only once.
 *
 * Resumability: a per-player cursor in `ingest_state` holds the id snapshot
 * plus the number of ids already processed, so a kill/restart continues where
 * it stopped. Once a player is `done`, later runs only list ids newer than
 * the last seen `gameCreation` (incremental refresh).
 */

import type Database from 'better-sqlite3';

import {
  clearIngestState,
  cursorKey,
  evaluateMatch,
  findRejection,
  listMatchIds,
  patchFromGameVersion,
  rankSummary,
  readCursor,
  windowWidened,
  writeCursor,
  type PlayerCursor,
} from './matches-store';
import { RiotClient, riotMatchDtoSchema, type Platform } from './riot';

export const RANKED_SOLO_QUEUE_ID = 420;
export const DEFAULT_MATCHES_PER_PLAYER = 20;
export const DEFAULT_MIN_DURATION_SECONDS = 15 * 60;

export interface MatchIngestionOptions {
  platform?: Platform;
  /** Lower-bound patch (e.g. "16.19"). Older matches are rejected. */
  sincePatch?: string;
  /** Max match ids listed per player. */
  matchesPerPlayer?: number;
  /** Max players processed this run. */
  playerLimit?: number;
  queueId?: number;
  minDurationSeconds?: number;
  db?: Database.Database;
  client?: RiotClient;
  /** Ignore stored cursors and re-ingest from scratch. */
  reset?: boolean;
  /** Progress log sink. */
  onProgress?: (message: string) => void;
}

export interface PlayerIngestionResult {
  puuid: string;
  status: 'skipped' | 'done';
  listed: number;
  stored: number;
  duplicates: number;
  filtered: number;
  invalid: number;
}

export interface MatchIngestionResult {
  platform: Platform;
  sincePatch?: string;
  playersProcessed: number;
  playersSkipped: number;
  listed: number;
  stored: number;
  duplicates: number;
  filtered: number;
  invalid: number;
  playerResults: PlayerIngestionResult[];
}

interface PlayerRow {
  puuid: string;
  rank_score: number;
}

const newCursor = (
  snapshot: string[],
  lastGameCreation = 0,
  sincePatch?: string,
): PlayerCursor => ({
  status: 'partial',
  snapshot,
  processed: 0,
  lastGameCreation,
  sincePatch,
  stored: 0,
  duplicates: 0,
  filtered: 0,
  invalid: 0,
  updatedAt: 0,
});

export async function ingestMatches(
  options: MatchIngestionOptions = {},
): Promise<MatchIngestionResult> {
  const platform = options.platform ?? 'euw1';
  const queueId = options.queueId ?? RANKED_SOLO_QUEUE_ID;
  const minDuration = options.minDurationSeconds ?? DEFAULT_MIN_DURATION_SECONDS;
  const perPlayer = options.matchesPerPlayer ?? DEFAULT_MATCHES_PER_PLAYER;
  const sincePatch = options.sincePatch;
  const log = options.onProgress ?? (() => {});

  const client = options.client ?? new RiotClient({ autoLoadEnv: true });
  const db =
    options.db ??
    (await import('./db')).openDb(process.env.DRAFTORB_DB_PATH ?? 'data/DraftOrb.sqlite');
  const { migrate } = await import('./db');
  migrate(db); // idempotent
  if (options.reset) clearIngestState(db, platform);

  const allPlayers = db
    .prepare(
      'SELECT puuid, rank_score FROM players WHERE platform = ? ORDER BY rank_score DESC, puuid',
    )
    .all(platform) as PlayerRow[];

  // Pending players (no cursor or partial) before done ones, so `--limit` walks
  // the population in repeated batches instead of re-checking the same cohort.
  const done = new Set<string>();
  if (!options.reset) {
    for (const player of allPlayers) {
      if (readCursor(db, cursorKey(platform, player.puuid))?.status === 'done') {
        done.add(player.puuid);
      }
    }
  }
  const ordered = [...allPlayers].sort(
    (a, b) =>
      Number(done.has(a.puuid)) - Number(done.has(b.puuid)) ||
      b.rank_score - a.rank_score ||
      (a.puuid < b.puuid ? -1 : a.puuid > b.puuid ? 1 : 0),
  );
  const players =
    options.playerLimit !== undefined ? ordered.slice(0, options.playerLimit) : ordered;

  const playerResults: PlayerIngestionResult[] = [];
  let playersSkipped = 0;

  const hasMatch = db.prepare('SELECT 1 AS one FROM matches WHERE match_id = ?');
  const insertMatch = db.prepare(
    `INSERT OR IGNORE INTO matches
       (match_id, platform, patch, queue_id, duration, created_at, avg_rank_score,
        rank_known_count, fetched_timeline)
     VALUES (@match_id, @platform, @patch, @queue_id, @duration, @created_at, @avg_rank_score,
        @rank_known_count, 0)`,
  );
  const insertReject = db.prepare(
    `INSERT OR REPLACE INTO match_rejects (match_id, reason, patch, checked_at)
     VALUES (@match_id, @reason, @patch, @checked_at)`,
  );

  for (const [index, player] of players.entries()) {
    const key = cursorKey(platform, player.puuid);
    let cursor = options.reset ? null : readCursor(db, key);

    if (cursor && windowWidened(cursor.sincePatch, sincePatch)) {
      // A wider window may include older patch-rejected matches outside the
      // incremental listing, so relist the player's full history.
      const ids = await listMatchIds(client, platform, player.puuid, queueId, perPlayer);
      cursor = newCursor(ids, cursor.lastGameCreation, sincePatch);
    } else if (cursor?.status === 'done') {
      // Incremental refresh: only ids newer than the last seen game creation.
      const newIds = await listMatchIds(
        client,
        platform,
        player.puuid,
        queueId,
        perPlayer,
        cursor.lastGameCreation,
      );
      if (newIds.length === 0) {
        playersSkipped += 1;
        playerResults.push({
          puuid: player.puuid,
          status: 'skipped',
          listed: 0,
          stored: 0,
          duplicates: 0,
          filtered: 0,
          invalid: 0,
        });
        continue;
      }
      cursor = newCursor(newIds, cursor.lastGameCreation, sincePatch);
    } else if (!cursor) {
      const ids = await listMatchIds(client, platform, player.puuid, queueId, perPlayer);
      cursor = newCursor(ids, 0, sincePatch);
    }

    // `base` carries counts persisted by earlier runs; `run` counts this run only.
    const base = {
      stored: cursor.stored,
      duplicates: cursor.duplicates,
      filtered: cursor.filtered,
      invalid: cursor.invalid,
    };
    const run = { stored: 0, duplicates: 0, filtered: 0, invalid: 0 };
    let lastGameCreation = cursor.lastGameCreation;

    for (let i = cursor.processed; i < cursor.snapshot.length; i += 1) {
      const matchId = cursor.snapshot[i] as string;
      let outcome: 'stored' | 'duplicate' | 'filtered' | 'invalid';

      if (findRejection(db, matchId, sincePatch)) {
        outcome = 'filtered';
      } else if ((hasMatch.get(matchId) as { one: number } | undefined) !== undefined) {
        outcome = 'duplicate';
      } else {
        const raw = await client.getMatch(platform, matchId);
        const parsed = riotMatchDtoSchema.safeParse(raw);
        if (!parsed.success) {
          // The client returns the raw payload on schema mismatch; revalidation
          // here keeps malformed matches out of the database.
          outcome = 'invalid';
          insertReject.run({
            match_id: matchId,
            reason: 'invalid',
            patch: null,
            checked_at: Date.now(),
          });
        } else {
          const evaluated = evaluateMatch(parsed.data, queueId, minDuration, sincePatch);
          outcome = evaluated.outcome;
          if (evaluated.reason === null) {
            lastGameCreation = Math.max(lastGameCreation, parsed.data.info.gameCreation);
            const rank = rankSummary(db, parsed.data.metadata.participants, player.rank_score);
            const change = insertMatch.run({
              match_id: matchId,
              platform,
              patch: patchFromGameVersion(parsed.data.info.gameVersion),
              queue_id: parsed.data.info.queueId,
              duration: parsed.data.info.gameDuration,
              created_at: parsed.data.info.gameCreation,
              avg_rank_score: rank.avg,
              rank_known_count: rank.known,
            });
            if (change.changes === 0) outcome = 'duplicate';
          } else {
            insertReject.run({
              match_id: matchId,
              reason: evaluated.reason,
              patch:
                evaluated.reason === 'patch'
                  ? patchFromGameVersion(parsed.data.info.gameVersion)
                  : null,
              checked_at: Date.now(),
            });
          }
        }
      }

      run[outcome === 'duplicate' ? 'duplicates' : outcome] += 1;
      cursor.processed = i + 1;
      cursor.stored = base.stored + run.stored;
      cursor.duplicates = base.duplicates + run.duplicates;
      cursor.filtered = base.filtered + run.filtered;
      cursor.invalid = base.invalid + run.invalid;
      cursor.lastGameCreation = lastGameCreation;
      cursor.updatedAt = Date.now();
      writeCursor(db, key, cursor);
    }

    cursor.status = 'done';
    cursor.updatedAt = Date.now();
    writeCursor(db, key, cursor);

    playerResults.push({
      puuid: player.puuid,
      status: 'done',
      listed: cursor.snapshot.length,
      stored: run.stored,
      duplicates: run.duplicates,
      filtered: run.filtered,
      invalid: run.invalid,
    });
    log(
      `[${index + 1}/${players.length}] ${player.puuid.slice(0, 12)}… ` +
        `ids=${cursor.snapshot.length} stored=${run.stored} dup=${run.duplicates} ` +
        `filtered=${run.filtered} invalid=${run.invalid}`,
    );
  }

  const totals = playerResults.reduce(
    (acc, r) => ({
      listed: acc.listed + r.listed,
      stored: acc.stored + r.stored,
      duplicates: acc.duplicates + r.duplicates,
      filtered: acc.filtered + r.filtered,
      invalid: acc.invalid + r.invalid,
    }),
    { listed: 0, stored: 0, duplicates: 0, filtered: 0, invalid: 0 },
  );

  log(
    `Ingestion complete: ${players.length - playersSkipped}/${players.length} players, ` +
      `${totals.stored} stored, ${totals.duplicates} duplicates, ${totals.filtered} filtered, ` +
      `${totals.invalid} invalid.`,
  );

  return {
    platform,
    sincePatch,
    playersProcessed: players.length - playersSkipped,
    playersSkipped,
    ...totals,
    playerResults,
  };
}
