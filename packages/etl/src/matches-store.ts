/**
 * Internal helpers for match ingestion: per-player resumable cursors in
 * `ingest_state`, the `match_rejects` dedup table, and pure evaluation
 * functions (patch extraction, queue/duration/patch filtering, id listing).
 */

import type Database from 'better-sqlite3';

import type { Platform, RiotClient, RiotMatchDto } from './riot';
import { comparePatchLabels, lookupPatchIndex } from './patches';

/** Numeric `major.minor` compare lives in `patches.ts` (D-055); re-exported here. */
export { comparePatchLabels as comparePatches };

export const MATCH_IDS_PAGE_SIZE = 100;

export type RejectReason = 'queue' | 'short' | 'patch' | 'invalid' | 'pruned';
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
  /** Lower-bound patch window used by the cursor (version label). */
  sincePatch?: string;
  /** `patch_index` of `sincePatch` resolved via the `patches` table (D-043). */
  sincePatchIndex?: number;
  stored: number;
  duplicates: number;
  filtered: number;
  invalid: number;
  updatedAt: number;
}

export function cursorKey(platform: string, puuid: string): string {
  return `match-ingest:${platform}:${puuid}`;
}

export const newCursor = (
  snapshot: string[],
  lastGameCreation = 0,
  sincePatch?: string,
  sincePatchIndex?: number,
): PlayerCursor => ({
  status: 'partial',
  snapshot,
  processed: 0,
  lastGameCreation,
  sincePatch,
  sincePatchIndex,
  stored: 0,
  duplicates: 0,
  filtered: 0,
  invalid: 0,
  updatedAt: 0,
});

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
      sincePatchIndex:
        typeof parsed.sincePatchIndex === 'number' ? parsed.sincePatchIndex : undefined,
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
 * the match's actual patch, or when no lower bound is set. The comparison is
 * on `patch_index` (D-043); a reject whose label cannot be resolved keeps its
 * rejection (conservative: it cannot be proven in-window). An 'invalid'
 * reject that carries a patch label was recorded only because the label was
 * missing from `patches` (D-043); once `resolvePatchIndex` resolves it the
 * stale reject is dropped so the match is fetched and re-evaluated — this is
 * how matches rejected during a Data Dragon lag recover after the catalog
 * catches up. 'invalid' rejects without a label (schema/participant
 * failures), 'queue' and 'short' rejects stay permanent until `--reset`.
 * A 'pruned' tombstone (D-044) is permanent: it is never deleted or
 * re-evaluated, whatever `--since-patch` says; only `--reset-tombstones`
 * clears it.
 */
export async function findRejection(
  db: Database.Database,
  matchId: string,
  sincePatchIndex?: number,
  resolvePatchIndex?: (versionLabel: string) => Promise<number | undefined>,
): Promise<RejectRow | null> {
  const row = db
    .prepare('SELECT reason, patch FROM match_rejects WHERE match_id = ?')
    .get(matchId) as RejectRow | undefined;
  if (!row) return null;
  if (row.reason === 'pruned') return row;
  if (row.reason === 'patch') {
    const rejectIndex = row.patch === null ? undefined : lookupPatchIndex(db, row.patch);
    if (
      sincePatchIndex === undefined ||
      (rejectIndex !== undefined && rejectIndex >= sincePatchIndex)
    ) {
      db.prepare('DELETE FROM match_rejects WHERE match_id = ?').run(matchId);
      return null;
    }
  }
  if (
    row.reason === 'invalid' &&
    row.patch !== null &&
    resolvePatchIndex !== undefined &&
    (await resolvePatchIndex(row.patch)) !== undefined
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

/** Returns matches that have been stored but not yet enriched, with their platform. */
export function listUnenrichedMatches(
  db: Database.Database,
  limit = 1000,
): { matchId: string; platform: Platform }[] {
  const rows = db
    .prepare('SELECT match_id, platform FROM matches WHERE enriched = 0 LIMIT ?')
    .all(limit) as { match_id: string; platform: string }[];
  return rows.map((row) => ({ matchId: row.match_id, platform: row.platform as Platform }));
}

/** Whether `next` expands the previously ingested lower-bound window (patch_index). */
export function windowWidened(
  previousIndex: number | undefined,
  nextIndex: number | undefined,
): boolean {
  return previousIndex !== undefined && (nextIndex === undefined || nextIndex < previousIndex);
}

/**
 * Wipe a platform's cursors and the re-evaluable rejections (`--reset`,
 * D-018). 'pruned' tombstones survive: they are permanent retention markers
 * (D-044) cleared only by `clearPrunedTombstones` (`--reset-tombstones`).
 */
export function clearIngestState(db: Database.Database, platform: string): void {
  db.prepare("DELETE FROM ingest_state WHERE key LIKE 'match-ingest:' || ? || ':%'").run(platform);
  db.prepare("DELETE FROM match_rejects WHERE reason != 'pruned'").run();
}

/** Delete every 'pruned' tombstone (`--reset-tombstones`, D-044). */
export function clearPrunedTombstones(db: Database.Database): void {
  db.prepare("DELETE FROM match_rejects WHERE reason = 'pruned'").run();
}

export interface MatchEvaluation {
  outcome: MatchOutcome;
  reason: RejectReason | null;
  /** The match's `major.minor` label when it was computed (patch/invalid-label rejects). */
  patchLabel?: string;
}

/**
 * Classify a validated match against this run's filters. The patch window is
 * compared on `patch_index` (D-043): `resolvePatchIndex` maps the match's
 * `major.minor` label through the `patches` table (refreshing it first when
 * needed). A label still unknown after the refresh yields an `invalid`
 * reject — distinct from `patch` (outside the window) and `pruned`.
 */
export async function evaluateMatch(
  match: RiotMatchDto,
  queueId: number,
  minDuration: number,
  resolvePatchIndex: (versionLabel: string) => Promise<number | undefined>,
  sincePatchIndex?: number,
): Promise<MatchEvaluation> {
  if (match.info.queueId !== queueId) return { outcome: 'filtered', reason: 'queue' };
  if (match.info.gameDuration <= minDuration) return { outcome: 'filtered', reason: 'short' };
  const patchLabel = patchFromGameVersion(match.info.gameVersion);
  const matchIndex = await resolvePatchIndex(patchLabel);
  if (matchIndex === undefined) {
    return { outcome: 'invalid', reason: 'invalid', patchLabel };
  }
  if (sincePatchIndex !== undefined && matchIndex < sincePatchIndex) {
    return { outcome: 'filtered', reason: 'patch', patchLabel };
  }
  return { outcome: 'stored', reason: null, patchLabel };
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
