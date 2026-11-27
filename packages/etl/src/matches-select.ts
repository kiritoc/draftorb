/**
 * @draftorb/etl — Player selection for match ingestion (BL-023, D-102, D-114).
 *
 * Picks which discovered players `ingestMatches` processes, in order.
 * Pending players (no `done` cursor) always precede completed ones; inside
 * each group `rank_score` descending is the default order. When
 * `data/pool.config.json` provides champion×role pairs, players already seen
 * playing those pairs in `participants` rows are moved to the front of their
 * group, so pool evidence accumulates first. The pool never changes scores —
 * it only reorders ingestion (D-101/D-102).
 */

import type Database from 'better-sqlite3';

import type { PoolConfig } from '@draftorb/shared';

import type { Platform } from './riot';
import { cursorKey, readCursor } from './matches-store';

export interface SelectedPlayer {
  puuid: string;
  rank_score: number;
  /** True when the player already has a `done` ingest cursor. */
  done: boolean;
  /** True when the player has a `participants` row matching a pool champion×role pair. */
  poolMatch: boolean;
}

export interface PlayerSelectionOptions {
  /** Treat every player as pending (ignores stored cursors), like `--reset`. */
  reset?: boolean;
  /** Restrict the selection to players that already have an ingest cursor. */
  refresh?: boolean;
  playerLimit?: number;
  /** Parsed `data/pool.config.json`; `null`/`undefined` disables pool priority. */
  poolConfig?: PoolConfig | null;
}

interface PlayerRow {
  puuid: string;
  rank_score: number;
}

/** `"<championId>:<ROLE>"` keys for every pool entry (D-114 file format). */
export function poolChampionRolePairs(poolConfig: PoolConfig | null | undefined): Set<string> {
  const pairs = new Set<string>();
  if (!poolConfig) return pairs;
  for (const [role, entries] of Object.entries(poolConfig.pools)) {
    for (const entry of entries ?? []) {
      pairs.add(`${entry.championId}:${role}`);
    }
  }
  return pairs;
}

/**
 * Puuids with at least one `participants` row (on this platform's matches)
 * whose champion×role pair is in `pairs`.
 */
function poolMatchingPuuds(
  db: Database.Database,
  platform: Platform,
  pairs: ReadonlySet<string>,
): Set<string> {
  const championIds = [...new Set([...pairs].map((key) => Number(key.slice(0, key.indexOf(':')))))];
  const placeholders = championIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT DISTINCT p.puuid AS puuid, p.champion_id AS championId, p.role AS role
       FROM participants p
       JOIN matches m ON m.match_id = p.match_id
       WHERE m.platform = ? AND p.champion_id IN (${placeholders})`,
    )
    .all(platform, ...championIds) as { puuid: string; championId: number; role: string }[];

  const puuids = new Set<string>();
  for (const row of rows) {
    if (pairs.has(`${row.championId}:${row.role}`)) {
      puuids.add(row.puuid);
    }
  }
  return puuids;
}

/**
 * Ordered player selection for one ingestion run. Mirrors the historical
 * ordering exactly when no pool pairs are configured: pending first, then
 * `rank_score` desc, then puuid.
 */
export function selectPlayers(
  db: Database.Database,
  platform: Platform,
  options: PlayerSelectionOptions = {},
): SelectedPlayer[] {
  const allPlayers = db
    .prepare(
      'SELECT puuid, rank_score FROM players WHERE platform = ? AND rank_score IS NOT NULL ORDER BY rank_score DESC, puuid',
    )
    .all(platform) as PlayerRow[];

  const done = new Set<string>();
  const hasCursor = new Set<string>();
  if (!options.reset) {
    for (const player of allPlayers) {
      const cursor = readCursor(db, cursorKey(platform, player.puuid));
      if (cursor !== null) hasCursor.add(player.puuid);
      if (cursor?.status === 'done') {
        done.add(player.puuid);
      }
    }
  }

  const pairs = poolChampionRolePairs(options.poolConfig);
  const poolPlayers = pairs.size > 0 ? poolMatchingPuuds(db, platform, pairs) : new Set<string>();

  const ordered = [...allPlayers].sort(
    (a, b) =>
      Number(done.has(a.puuid)) - Number(done.has(b.puuid)) ||
      Number(poolPlayers.has(b.puuid)) - Number(poolPlayers.has(a.puuid)) ||
      b.rank_score - a.rank_score ||
      (a.puuid < b.puuid ? -1 : a.puuid > b.puuid ? 1 : 0),
  );
  const scoped = options.refresh ? ordered.filter((p) => hasCursor.has(p.puuid)) : ordered;
  const players = options.playerLimit !== undefined ? scoped.slice(0, options.playerLimit) : scoped;

  return players.map((player) => ({
    puuid: player.puuid,
    rank_score: player.rank_score,
    done: done.has(player.puuid),
    poolMatch: poolPlayers.has(player.puuid),
  }));
}
