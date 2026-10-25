import type Database from 'better-sqlite3';

import {
  RiotClient,
  RiotApiError,
  RiotAuthError,
  RiotSchemaError,
  riotMatchDtoSchema,
  type Platform,
} from './riot';
import { extractParticipants, InvalidMatchParticipantsError } from './participants';
import { resolveDbPath } from './config/paths';
import { openDb, migrate } from './db';
import {
  isCompleteStoredMatch,
  persistAcceptedMatch,
  prepareMatchPersist,
  storedParticipantCount,
} from './matches-persist';
import {
  clearIngestState,
  createRankLoader,
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

export const RANKED_SOLO_QUEUE_ID = 420;
export const DEFAULT_MATCHES_PER_PLAYER = 20;
export const DEFAULT_MIN_DURATION_SECONDS = 15 * 60;

export interface MatchIngestionOptions {
  platform?: Platform;
  sincePatch?: string;
  matchesPerPlayer?: number;
  playerLimit?: number;
  queueId?: number;
  minDurationSeconds?: number;
  db?: Database.Database;
  client?: RiotClient;
  reset?: boolean;
  onProgress?: (message: string) => void;
}

export interface PlayerIngestionResult {
  puuid: string;
  status: 'skipped' | 'done' | 'failed';
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
  playersFailed: number;
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

function isTransientMatchError(error: unknown): boolean {
  if (error instanceof RiotAuthError) return false;
  if (error instanceof RiotSchemaError) return false;
  if (error instanceof RiotApiError) {
    if (error.status === 429) return true;
    if (error.status >= 500) return true;
    if (error.status === 0) return true;
  }
  return error instanceof Error && /network|timeout|fetch/i.test(error.message);
}

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
  const ownsDb = options.db === undefined;
  const db = options.db ?? openDb(resolveDbPath());
  try {
    migrate(db);
    if (options.reset) clearIngestState(db, platform);

    const allPlayers = db
      .prepare(
        'SELECT puuid, rank_score FROM players WHERE platform = ? ORDER BY rank_score DESC, puuid',
      )
      .all(platform) as PlayerRow[];

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
    let playersFailed = 0;
    let consecutiveFailed = 0;

    const stmts = prepareMatchPersist(db);
    const loadRanks = createRankLoader(db);

    for (const [index, player] of players.entries()) {
      const key = cursorKey(platform, player.puuid);
      let cursor = options.reset ? null : readCursor(db, key);

      try {
        if (cursor && windowWidened(cursor.sincePatch, sincePatch)) {
          const ids = await listMatchIds(client, platform, player.puuid, queueId, perPlayer);
          cursor = newCursor(ids, cursor.lastGameCreation, sincePatch);
        } else if (cursor?.status === 'done') {
          const newIds = await listMatchIds(
            client,
            platform,
            player.puuid,
            queueId,
            perPlayer,
            cursor.lastGameCreation,
          );
          if (newIds.length === 0) {
            consecutiveFailed = 0;
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
      } catch (error) {
        if (error instanceof RiotAuthError) {
          throw error;
        }
        if (isTransientMatchError(error)) {
          playersFailed += 1;
          consecutiveFailed += 1;
          playerResults.push({
            puuid: player.puuid,
            status: 'failed',
            listed: cursor?.snapshot.length ?? 0,
            stored: 0,
            duplicates: 0,
            filtered: 0,
            invalid: 0,
          });
          log(
            `[${index + 1}/${players.length}] ${player.puuid.slice(0, 12)}… transient failure while listing match ids`,
          );
          if (consecutiveFailed >= 3) {
            break;
          }
          continue;
        }
        throw error;
      }

      const base = {
        stored: cursor.stored,
        duplicates: cursor.duplicates,
        filtered: cursor.filtered,
        invalid: cursor.invalid,
      };
      const run = { stored: 0, duplicates: 0, filtered: 0, invalid: 0 };
      let lastGameCreation = cursor.lastGameCreation;
      let playerFailed = false;

      for (let i = cursor.processed; i < cursor.snapshot.length; i += 1) {
        const matchId = cursor.snapshot[i] as string;
        let outcome: 'stored' | 'duplicate' | 'filtered' | 'invalid' = 'filtered';
        let didCountOutcome = false;
        let repairingIncompleteMatch = false;

        try {
          const participantCount = storedParticipantCount(stmts, matchId);
          if (findRejection(db, matchId, sincePatch)) {
            outcome = 'filtered';
          } else if (isCompleteStoredMatch(participantCount)) {
            outcome = 'duplicate';
          } else {
            repairingIncompleteMatch = participantCount !== undefined;
            const raw = await client.getMatch(platform, matchId);
            const parsed = riotMatchDtoSchema.safeParse(raw);
            if (!parsed.success) {
              throw new RiotSchemaError(matchId, parsed.error.message);
            }
            const match = parsed.data;
            const evaluated = evaluateMatch(match, queueId, minDuration, sincePatch);
            outcome = evaluated.outcome;
            if (evaluated.reason === null) {
              lastGameCreation = Math.max(lastGameCreation, match.info.gameCreation);
              const participantIds = match.info.participants.map(
                (matchParticipant) => matchParticipant.puuid,
              );
              const ranksByPuuid = loadRanks(participantIds);
              const participants = extractParticipants(match, ranksByPuuid);
              const rank = rankSummary(
                ranksByPuuid,
                participants.map((row) => row.puuid),
                player.puuid,
                player.rank_score,
              );
              const matchRow = {
                match_id: matchId,
                platform,
                patch: patchFromGameVersion(match.info.gameVersion),
                queue_id: match.info.queueId,
                duration: match.info.gameDuration,
                created_at: match.info.gameCreation,
                avg_rank_score: rank.avg,
                rank_known_count: rank.known,
              };
              outcome = persistAcceptedMatch(db, stmts, {
                match: matchRow,
                participants,
                repairingIncompleteMatch,
                cursorKey: key,
                applyOutcome: (persisted) => {
                  cursor.processed = i + 1;
                  cursor.stored = base.stored + run.stored + (persisted === 'stored' ? 1 : 0);
                  cursor.duplicates =
                    base.duplicates + run.duplicates + (persisted === 'duplicate' ? 1 : 0);
                  cursor.filtered = base.filtered + run.filtered;
                  cursor.invalid = base.invalid + run.invalid;
                  cursor.lastGameCreation = lastGameCreation;
                  cursor.updatedAt = Date.now();
                  return cursor;
                },
              });
              if (outcome === 'duplicate') {
                run.duplicates += 1;
              } else {
                run.stored += 1;
              }
              didCountOutcome = true;
            } else {
              const persist = db.transaction(() => {
                stmts.insertReject.run({
                  match_id: matchId,
                  reason: evaluated.reason,
                  patch:
                    evaluated.reason === 'patch'
                      ? patchFromGameVersion(match.info.gameVersion)
                      : null,
                  checked_at: Date.now(),
                });
                if (repairingIncompleteMatch) {
                  stmts.deleteMatch.run(matchId);
                }
                cursor.processed = i + 1;
                cursor.filtered = base.filtered + run.filtered + 1;
                cursor.invalid = base.invalid + run.invalid;
                cursor.lastGameCreation = lastGameCreation;
                cursor.updatedAt = Date.now();
                writeCursor(db, key, cursor);
              });
              persist();
              run.filtered += 1;
              didCountOutcome = true;
            }
          }
        } catch (error) {
          if (error instanceof RiotAuthError) {
            throw error;
          }
          if (
            error instanceof RiotSchemaError ||
            error instanceof InvalidMatchParticipantsError ||
            (error instanceof RiotApiError && [400, 404].includes(error.status))
          ) {
            const persist = db.transaction(() => {
              if (repairingIncompleteMatch) {
                stmts.deleteMatch.run(matchId);
              }
              stmts.insertReject.run({
                match_id: matchId,
                reason: 'invalid',
                patch: null,
                checked_at: Date.now(),
              });
              cursor.processed = i + 1;
              cursor.invalid = base.invalid + run.invalid + 1;
              cursor.updatedAt = Date.now();
              writeCursor(db, key, cursor);
            });
            persist();
            run.invalid += 1;
            didCountOutcome = true;
            continue;
          }
          if (isTransientMatchError(error)) {
            playerFailed = true;
            break;
          }
          throw error;
        }

        if (!didCountOutcome) {
          run[outcome === 'duplicate' ? 'duplicates' : outcome] += 1;
        }

        cursor.processed = i + 1;
        cursor.stored = base.stored + run.stored;
        cursor.duplicates = base.duplicates + run.duplicates;
        cursor.filtered = base.filtered + run.filtered;
        cursor.invalid = base.invalid + run.invalid;
        cursor.lastGameCreation = lastGameCreation;
        cursor.updatedAt = Date.now();
        const persistCursor = db.transaction(() => {
          writeCursor(db, key, cursor);
        });
        persistCursor();
      }

      if (playerFailed) {
        playersFailed += 1;
        consecutiveFailed += 1;
        playerResults.push({
          puuid: player.puuid,
          status: 'failed',
          listed: cursor.snapshot.length,
          stored: run.stored,
          duplicates: run.duplicates,
          filtered: run.filtered,
          invalid: run.invalid,
        });
        log(
          `[${index + 1}/${players.length}] ${player.puuid.slice(0, 12)}… transient failure (player failed)`,
        );
        if (consecutiveFailed >= 3) {
          break;
        }
        continue;
      }

      consecutiveFailed = 0;
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
        `${totals.invalid} invalid; failed=${playersFailed}.`,
    );

    return {
      platform,
      sincePatch,
      playersProcessed: players.length - playersSkipped,
      playersSkipped,
      playersFailed,
      ...totals,
      playerResults,
    };
  } finally {
    if (ownsDb) db.close();
  }
}
