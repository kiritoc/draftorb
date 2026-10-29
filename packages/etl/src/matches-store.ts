/**
 * Internal helpers for match ingestion: per-player resumable cursors in
 * `ingest_state`, the `match_rejects` dedup table, and pure evaluation
 * functions (patch extraction, queue/duration/patch filtering, id listing).
 */

import type Database from 'better-sqlite3';

import type { Platform, RiotClient, RiotMatchDto } from './riot';

export const MATCH_IDS_PAGE_SIZE = 100;

export type RejectReason = 'queue' | 'short' | 'patch' | 'invalid';
export type MatchOutcome = 'stored' | 'duplicate' | 'filtered' | 'invalid';

export interface RejectRow {
  reason: RejectReason;
  patch: string | null;
}

export interface PlayerCursor {
  status: 'partial' | 'done';
  snapshot: string[];
  processed: number;
  lastGameCreation: number;
  /** Lower-bound patch window used by the cursor. */
  sincePatch?: string;
  stored: number;
  duplicates: number;
  filtered: number;
  invalid: number;
  updatedAt: number;
}

export function cursorKey(platform: string, puuid: string): string {
  return `match-ingest:${platform}:${puuid}`;
}

export function readCursor(db: Database.Database, key: string): PlayerCursor | null {
  const row = db.prepare('SELECT value FROM ingest_state WHERE key = ?').get(key) as
    { value: string } | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as Partial<PlayerCursor>;
    if (!Array.isArray(parsed.snapshot) || typeof parsed.processed !== 'number') {
      return null; // corrupted cursor: redo the player from scratch
    }
    return {
      status: parsed.status === 'done' ? 'done' : 'partial',
      snapshot: parsed.snapshot.filter((id): id is string => typeof id === 'string'),
      processed: Math.max(0, Math.min(parsed.processed, parsed.snapshot.length)),
      lastGameCreation: typeof parsed.lastGameCreation === 'number' ? parsed.lastGameCreation : 0,
      sincePatch: typeof parsed.sincePatch === 'string' ? parsed.sincePatch : undefined,
      stored: parsed.stored ?? 0,
      duplicates: parsed.duplicates ?? 0,
      filtered: parsed.filtered ?? 0,
      invalid: parsed.invalid ?? 0,
      updatedAt: parsed.updatedAt ?? 0,
    };
  } catch {
    return null;
  }
}

export function writeCursor(db: Database.Database, key: string, cursor: PlayerCursor): void {
  db.prepare(
    `INSERT INTO ingest_state (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, JSON.stringify(cursor));
}

/**
 * Returns the known rejection for a match id, `null` when it must be
 * (re-)evaluated. A 'patch' reject is dropped when the run's window includes
 * the match's actual patch, or when no lower bound is set.
 */
export function findRejection(
  db: Database.Database,
  matchId: string,
  sincePatch?: string,
): RejectRow | null {
  const row = db
    .prepare('SELECT reason, patch FROM match_rejects WHERE match_id = ?')
    .get(matchId) as RejectRow | undefined;
  if (!row) return null;
  if (
    row.reason === 'patch' &&
    (sincePatch === undefined || (row.patch !== null && comparePatches(row.patch, sincePatch) >= 0))
  ) {
    db.prepare('DELETE FROM match_rejects WHERE match_id = ?').run(matchId);
    return null;
  }
  return row;
}

/** Prepared lookup for `players.rank_score` (one parameterized get, reused per run). */
export function createRankLoader(
  db: Database.Database,
): (puuids: readonly string[]) => Map<string, number> {
  const stmt = db.prepare('SELECT puuid, rank_score FROM players WHERE puuid = ?');
  return (puuids) => {
    const ranks = new Map<string, number>();
    for (const puuid of new Set(puuids)) {
      const row = stmt.get(puuid) as { puuid: string; rank_score: number | null } | undefined;
      if (row && row.rank_score !== null) ranks.set(row.puuid, row.rank_score);
    }
    return ranks;
  };
}

/**
 * Mean known rank among the persisted match participants, including the seed
 * (D-019). Only `participantPuuids` (the stored 10) contribute besides the seed.
 */
export function rankSummary(
  ranksByPuuid: ReadonlyMap<string, number>,
  participantPuuids: readonly string[],
  seedPuuid: string,
  fallback: number,
): { avg: number; known: number } {
  const ranks = new Map<string, number>();
  for (const puuid of new Set(participantPuuids)) {
    const rank = ranksByPuuid.get(puuid);
    if (rank !== undefined) ranks.set(puuid, rank);
  }
  if (!ranks.has(seedPuuid)) {
    ranks.set(seedPuuid, ranksByPuuid.get(seedPuuid) ?? fallback);
  }
  const knownRanks = [...ranks.values()];
  return {
    avg: knownRanks.reduce((sum, rank) => sum + rank, 0) / knownRanks.length,
    known: knownRanks.length,
  };
}

/** First two numbers of `gameVersion` (e.g. "14.21.628.9812" -> "14.21"). */
export function patchFromGameVersion(gameVersion: string): string {
  return gameVersion.split('.').slice(0, 2).join('.');
}

/** Compare two major.minor patches numerically. */
export function comparePatches(a: string, b: string): number {
  const [aMajor = 0, aMinor = 0] = a.split('.').map(Number);
  const [bMajor = 0, bMinor = 0] = b.split('.').map(Number);
  return aMajor - bMajor || aMinor - bMinor;
}

/** Updates a match's rank summary columns after enrichment. */
export function updateMatchRankStats(
  db: Database.Database,
  matchId: string,
  avgRankScore: number,
  rankKnownCount: number,
): void {
  db.prepare('UPDATE matches SET avg_rank_score = ?, rank_known_count = ? WHERE match_id = ?').run(
    avgRankScore,
    rankKnownCount,
    matchId,
  );
}

/** Whether `next` expands the previously ingested lower-bound window. */
export function windowWidened(previous?: string, next?: string): boolean {
  return previous !== undefined && (next === undefined || comparePatches(next, previous) < 0);
}

/** Wipe a platform's cursors and every shared rejection (`--reset`). */
export function clearIngestState(db: Database.Database, platform: string): void {
  db.prepare("DELETE FROM ingest_state WHERE key LIKE 'match-ingest:' || ? || ':%'").run(platform);
  db.prepare('DELETE FROM match_rejects').run();
}

/** Classify a validated match against this run's filters. */
export function evaluateMatch(
  match: RiotMatchDto,
  queueId: number,
  minDuration: number,
  sincePatch?: string,
): { outcome: MatchOutcome; reason: RejectReason | null } {
  if (match.info.queueId !== queueId) return { outcome: 'filtered', reason: 'queue' };
  if (match.info.gameDuration <= minDuration) return { outcome: 'filtered', reason: 'short' };
  if (
    sincePatch !== undefined &&
    comparePatches(patchFromGameVersion(match.info.gameVersion), sincePatch) < 0
  ) {
    return { outcome: 'filtered', reason: 'patch' };
  }
  return { outcome: 'stored', reason: null };
}

export async function listMatchIds(
  client: RiotClient,
  platform: Platform,
  puuid: string,
  queueId: number,
  limit: number,
  startTimeMs?: number,
): Promise<string[]> {
  const ids: string[] = [];
  let start = 0;
  while (ids.length < limit) {
    const page = await client.getMatchIdsByPuuid(platform, puuid, {
      queue: queueId,
      type: 'ranked',
      start,
      count: Math.min(MATCH_IDS_PAGE_SIZE, limit - ids.length),
      // Riot match-v5 startTime is epoch seconds; gameCreation is stored in ms.
      startTime: startTimeMs !== undefined ? Math.floor(startTimeMs / 1000) : undefined,
    });
    ids.push(...page);
    if (page.length < MATCH_IDS_PAGE_SIZE) break;
    start += page.length;
  }
  return [...new Set(ids)].slice(0, limit);
}
