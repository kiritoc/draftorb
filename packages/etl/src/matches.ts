import type Database from 'better-sqlite3';

import { RiotClient, RiotAuthError, type Platform } from './riot';
import type { Role } from '@draftorb/shared';
import { DEFAULT_CONFIG } from '@draftorb/engine';
import { openDb, migrate } from './db';
import { resolveDbPath } from './config/paths';
import { ETL_CONFIG } from './config/etl-config';
import {
  createPatchIndexLookup,
  createPatchResolver,
  latestPatchIndex,
  refreshPatches,
} from './patches';
import { UsageError } from './cli-args';
import {
  clearIngestState,
  clearPrunedTombstones,
  createRankLoader,
  cursorKey,
  listMatchIds,
  newCursor,
  readCursor,
  windowWidened,
  writeCursor,
} from './matches-store';
import { prepareMatchPersist } from './matches-persist';
import {
  isTransientMatchError,
  processMatch,
  type MatchProcessContext,
  type MatchProcessResult,
  type RunTotals,
} from './matches-process';
import { buildPlayerResult, reprocessUnenrichedMatches } from './matches-reprocess';

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
  /** Data Dragon `fetch` override for the `patches` refresh (tests). */
  patchesFetchFn?: typeof fetch;
  reset?: boolean;
  /** Clear 'pruned' tombstones so pruned matches become fetchable again (D-044). */
  resetTombstones?: boolean;
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
    if (options.resetTombstones) {
      clearPrunedTombstones(db);
      log(
        'Warning: --reset-tombstones cleared pruned tombstones; pruned matches become fetchable again.',
      );
    }

    // --since-patch is a version label resolved to patch_index via `patches`
    // (D-043); the resolver refreshes the table from Data Dragon on a miss.
    const patchResolver = createPatchResolver(db, {
      fetchFn: options.patchesFetchFn,
      onRefresh: (result) => {
        if (result.added > 0) {
          log(`Refreshed patches from Data Dragon: +${result.added} (total ${result.total}).`);
        }
      },
      onWarn: (message) => log(`Warning: ${message}`),
    });
    const patchLookup = createPatchIndexLookup(db);
    const explicitSincePatchIndex =
      sincePatch === undefined ? undefined : await patchResolver.resolve(sincePatch);
    if (sincePatch !== undefined && explicitSincePatchIndex === undefined) {
      throw new UsageError(
        `Unknown patch "${sincePatch}": not present in Data Dragon versions after refreshing the patches table.`,
      );
    }

    // Default ingestion window (SPECS §13, D-044): patch_index >=
    // latest - retentionPatches + 1, so ingestion never re-adds data the
    // next prune would delete. When the table is still empty it is refreshed
    // once so the bound reflects the real latest patch; on failure the run
    // proceeds unbounded (same as before the window existed).
    let latestIndex = latestPatchIndex(db);
    if (latestIndex === null) {
      try {
        const refreshed = await refreshPatches(db, { fetchFn: options.patchesFetchFn });
        if (refreshed.added > 0) {
          log(
            `Refreshed patches from Data Dragon: +${refreshed.added} (total ${refreshed.total}).`,
          );
        }
        latestIndex = latestPatchIndex(db);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`Warning: could not refresh patches from Data Dragon: ${message}`);
      }
    }
    const retentionBound =
      latestIndex === null ? undefined : Math.max(1, latestIndex - ETL_CONFIG.retentionPatches + 1);

    if (
      explicitSincePatchIndex !== undefined &&
      retentionBound !== undefined &&
      explicitSincePatchIndex < retentionBound &&
      !options.resetTombstones
    ) {
      throw new UsageError(
        `--since-patch "${sincePatch}" (patch_index ${explicitSincePatchIndex}) is below the ` +
          `retention window (patch_index >= ${retentionBound}). ` +
          'Pass --reset-tombstones to ingest it anyway.',
      );
    }
    const sincePatchIndex = explicitSincePatchIndex ?? retentionBound;

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
        // Legacy cursors carry only the sincePatch label; resolve it to a
        // patch_index once (post-refresh) for the widening comparison.
        const previousIndex =
          cursor?.sincePatchIndex ??
          (cursor?.sincePatch === undefined ? undefined : patchLookup(cursor.sincePatch));
        if (cursor && windowWidened(previousIndex, sincePatchIndex)) {
          const ids = await listMatchIds(client, platform, player.puuid, queueId, perPlayer);
          cursor = newCursor(ids, cursor.lastGameCreation, sincePatch, sincePatchIndex);
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
          cursor = newCursor(newIds, cursor.lastGameCreation, sincePatch, sincePatchIndex);
        } else if (!cursor) {
          const ids = await listMatchIds(client, platform, player.puuid, queueId, perPlayer);
          cursor = newCursor(ids, 0, sincePatch, sincePatchIndex);
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
        sincePatchIndex,
        resolvePatchIndex: patchResolver.resolve,
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
          minChampGames: options.minChampGames ?? DEFAULT_CONFIG.minChampGames,
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

    // Awaited (B-044): a floating retry pass would outlive `ingestMatches` and
    // hit a closed connection when this call owns the database.
    await reprocessUnenrichedMatches(
      db,
      client,
      {
        myRole: options.myRole ?? 'SUPPORT',
        minChampGames: options.minChampGames ?? DEFAULT_CONFIG.minChampGames,
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
