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
 * (re-)evaluated. A 'patch' reject is only authoritative while the run's
 * target patch differs from the patch stored in the row; when the run targets
 * that patch (or no patch at all) the row is dropped and the match refetched.
 */
export function findRejection(
  db: Database.Database,
  matchId: string,
  targetPatch?: string,
): RejectRow | null {
  const row = db
    .prepare('SELECT reason, patch FROM match_rejects WHERE match_id = ?')
    .get(matchId) as RejectRow | undefined;
  if (!row) return null;
  if (row.reason === 'patch' && (targetPatch === undefined || row.patch === targetPatch)) {
    db.prepare('DELETE FROM match_rejects WHERE match_id = ?').run(matchId);
    return null;
  }
  return row;
}

/** Mean rank_score of the match's discovered participants; falls back to the seeding player. */
export function meanRankScore(db: Database.Database, puuids: string[], fallback: number): number {
  if (puuids.length === 0) return fallback;
  const placeholders = puuids.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT rank_score FROM players WHERE puuid IN (${placeholders})`)
    .all(...puuids) as { rank_score: number }[];
  if (rows.length === 0) return fallback;
  return rows.reduce((sum, row) => sum + row.rank_score, 0) / rows.length;
}

/** First two numbers of `gameVersion` (e.g. "14.21.628.9812" -> "14.21"). */
export function patchFromGameVersion(gameVersion: string): string {
  return gameVersion.split('.').slice(0, 2).join('.');
}

/** Classify a validated match against this run's filters. */
export function evaluateMatch(
  match: RiotMatchDto,
  queueId: number,
  minDuration: number,
  targetPatch?: string,
): { outcome: MatchOutcome; reason: RejectReason | null } {
  if (match.info.queueId !== queueId) return { outcome: 'filtered', reason: 'queue' };
  if (match.info.gameDuration < minDuration) return { outcome: 'filtered', reason: 'short' };
  if (targetPatch !== undefined && patchFromGameVersion(match.info.gameVersion) !== targetPatch) {
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
