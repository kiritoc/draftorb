import type Database from 'better-sqlite3';

import { RiotClient, RiotAuthError, type Platform } from './riot';
import type { Role } from '@draftorb/shared';
import { openDb, migrate } from './db';
import { resolveDbPath } from './config/paths';
import { enrichParticipants, type EnrichmentOptions } from './enrichment';
import { MATCH_PARTICIPANT_COUNT, type ParticipantRow } from './participants';
import {
  clearIngestState,
  createRankLoader,
  cursorKey,
  listMatchIds,
  listUnenrichedMatches,
  readCursor,
  windowWidened,
  writeCursor,
  type PlayerCursor,
} from './matches-store';
import { prepareMatchPersist } from './matches-persist';
import {
  isTransientMatchError,
  processMatch,
  type MatchProcessContext,
  type MatchProcessResult,
  type RunTotals,
} from './matches-process';

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
  myRole?: Role;
  minChampGames?: number;
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

const ZERO_RUN: RunTotals = { stored: 0, duplicates: 0, filtered: 0, invalid: 0 };

/** Options for the unenriched-match reprocess pass. */
interface ReprocessOptions {
  myRole: Role;
  minChampGames: number;
}

/**
 * Dedicated pass over matches that were stored but not fully enriched
 * (transient HTTP failures on a previous run left `enriched = 0`).
 * Runs independently of match-ID listing or cursor position so that
 * completed players with no new matches still recover.
 *
 * Each match's own platform is used for API calls (not the invocation's
 * platform), so cross-platform databases are handled correctly.
 *
 * A seed is chosen from the match's own participants: prefer a bot-lane
 * participant with a known rank_score, then any participant with a known
 * rank_score. Matches with no ranked participant are skipped (they have
 * no reliable rank baseline to pass to `rankSummary`).
 */
async function reprocessUnenrichedMatches(
  db: Database.Database,
  client: RiotClient,
  opts: ReprocessOptions,
  log: (msg: string) => void,
): Promise<{ reprocessed: number; skipped: number }> {
  const pending = listUnenrichedMatches(db);
  let reprocessed = 0;
  let skipped = 0;

  for (const { matchId, platform } of pending) {
    const participants = db
      .prepare('SELECT * FROM participants WHERE match_id = ?')
      .all(matchId) as ParticipantRow[];

    if (participants.length < MATCH_PARTICIPANT_COUNT) {
      log(`Reprocess: skipping ${matchId} — incomplete participants (${participants.length})`);
      skipped += 1;
      continue;
    }

    const botLaneRoles: ReadonlySet<Role> = new Set(['ADC', 'SUPPORT']);
    const seed =
      participants.find((p) => botLaneRoles.has(p.role) && p.rank_score !== null) ??
      participants.find((p) => p.rank_score !== null);

    if (!seed || seed.rank_score === null) {
      log(`Reprocess: skipping ${matchId} — no ranked participant to use as seed`);
      skipped += 1;
      continue;
    }

    try {
      const enrichmentOpts: EnrichmentOptions = {
        db,
        client,
        platform,
        myRole: opts.myRole,
        seedPuuid: seed.puuid,
        seedRankScore: seed.rank_score,
        minChampGames: opts.minChampGames,
        onProgress: log,
      };
      const summary = await enrichParticipants(matchId, participants, enrichmentOpts);
      if (summary.failures === 0) {
        db.prepare('UPDATE matches SET enriched = 1 WHERE match_id = ?').run(matchId);
        log(
          `Reprocessed ${matchId}: ranks=${summary.ranksFetched} mastery=${summary.masteryFetched}`,
        );
      } else {
        log(`Reprocessed ${matchId}: ${summary.failures} failure(s), left unenriched for retry`);
      }
      reprocessed += 1;
    } catch (err) {
      log(`Reprocess: enrichment error for ${matchId}: ${String(err)}`);
      skipped += 1;
    }
  }

  if (reprocessed > 0) {
    log(`Reprocess pass: ${reprocessed} match(es) attempted, ${skipped} skipped`);
  }

  return { reprocessed, skipped };
}

function buildPlayerResult(
  puuid: string,
  status: PlayerIngestionResult['status'],
  listed: number,
  run: RunTotals,
): PlayerIngestionResult {
  return { puuid, status, listed, ...run };
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
  const ownsDb = options.db === undefined;
  const db = options.db ?? openDb(resolveDbPath());
  try {
    migrate(db);
    if (options.reset) clearIngestState(db, platform);

    const allPlayers = db
      .prepare(
        'SELECT puuid, rank_score FROM players WHERE platform = ? AND rank_score IS NOT NULL ORDER BY rank_score DESC, puuid',
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
            playerResults.push(buildPlayerResult(player.puuid, 'skipped', 0, ZERO_RUN));
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
          playerResults.push(
            buildPlayerResult(player.puuid, 'failed', cursor?.snapshot.length ?? 0, ZERO_RUN),
          );
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
      const run: RunTotals = { stored: 0, duplicates: 0, filtered: 0, invalid: 0 };
      let playerFailed = false;

      const ctx: MatchProcessContext = {
        db,
        stmts,
        client,
        platform,
        cursorKey: key,
        queueId,
        minDuration,
        sincePatch,
        player: { puuid: player.puuid, rank_score: player.rank_score },
        loadRanks,
        base,
        onProgress: log,
        enrichmentOptions: {
          db,
          client,
          platform,
          myRole: options.myRole ?? 'SUPPORT',
          seedPuuid: player.puuid,
          seedRankScore: player.rank_score,
          minChampGames: options.minChampGames ?? 30,
          onProgress: log,
        },
      };

      for (let i = cursor.processed; i < cursor.snapshot.length; i += 1) {
        const matchId = cursor.snapshot[i] as string;
        const result: MatchProcessResult = await processMatch(ctx, matchId, i, cursor, run);
        if (result.playerFailed) {
          playerFailed = true;
          break;
        }
      }

      if (playerFailed) {
        playersFailed += 1;
        consecutiveFailed += 1;
        playerResults.push(buildPlayerResult(player.puuid, 'failed', cursor.snapshot.length, run));
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

      playerResults.push(buildPlayerResult(player.puuid, 'done', cursor.snapshot.length, run));
      log(
        `[${index + 1}/${players.length}] ${player.puuid.slice(0, 12)}… ` +
          `ids=${cursor.snapshot.length} stored=${run.stored} dup=${run.duplicates} ` +
          `filtered=${run.filtered} invalid=${run.invalid}`,
      );
    }

    void reprocessUnenrichedMatches(
      db,
      client,
      {
        myRole: options.myRole ?? 'SUPPORT',
        minChampGames: options.minChampGames ?? 30,
      },
      log,
    );

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
