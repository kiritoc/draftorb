/**
 * @draftorb/etl — Summoner-spell backfill (BL-031a).
 *
 * Matches ingested before migration 022 have NULL `summoner1_id`/
 * `summoner2_id` on their participant rows. This pass refetches the
 * match-v5 match detail (which always carries the spell ids) and fills the
 * two columns, so `summoner_ctx` aggregation covers the whole database
 * instead of only newly ingested games.
 *
 * Resumable without a cursor: the pending set is derived from the NULL
 * columns themselves, so kill/restart simply resumes where it stopped.
 * `--limit` and `--call-budget` bound each run (one match call per match).
 * Progress messages never contain match ids or puuids (D-078).
 */

import type Database from 'better-sqlite3';

import { openDb } from './db';
import { resolveDbPath } from './config/paths';
import { isTransientMatchError } from './matches-process';
import { RiotAuthError, RiotClient, riotMatchDtoSchema, type Platform } from './riot';

export interface SummonerBackfillOptions {
  platform?: Platform;
  /** Max matches processed this run (resumable across runs). */
  limit?: number;
  /** Stop after this many match-detail API calls. */
  callBudget?: number;
  db?: Database.Database;
  client?: RiotClient;
  onProgress?: (message: string) => void;
}

export interface SummonerBackfillResult {
  platform?: Platform;
  candidates: number;
  fetched: number;
  updated: number;
  skipped: number;
  failed: number;
  stoppedEarly: boolean;
  budgetExhausted: boolean;
}

interface PendingMatchRow {
  match_id: string;
  platform: string;
}

/** Matches with at least one participant still missing spell ids, newest first. */
function pendingMatches(
  db: Database.Database,
  platform: Platform | undefined,
  limit: number | undefined,
): PendingMatchRow[] {
  const wherePlatform = platform === undefined ? '' : 'AND m.platform = ?';
  const limitSql = limit === undefined ? '' : 'LIMIT ?';
  const params: Array<string | number> = [];
  if (platform !== undefined) params.push(platform);
  if (limit !== undefined) params.push(limit);

  return db
    .prepare(
      `SELECT m.match_id, m.platform FROM matches m
       WHERE EXISTS (
         SELECT 1 FROM participants p
         WHERE p.match_id = m.match_id
           AND (p.summoner1_id IS NULL OR p.summoner2_id IS NULL)
       )
       ${wherePlatform}
       ORDER BY m.created_at DESC, m.match_id
       ${limitSql}`,
    )
    .all(...params) as PendingMatchRow[];
}

/**
 * Fills `participants.summoner1_id`/`summoner2_id` for up to `limit` pending
 * matches (or until `callBudget` match calls are consumed). Per-match
 * failures are logged and counted; the run stops early after 3 consecutive
 * transient failures.
 */
export async function runSummonerBackfill(
  options: SummonerBackfillOptions = {},
): Promise<SummonerBackfillResult> {
  const log = options.onProgress ?? (() => {});

  const ownsDb = options.db === undefined;
  const db = options.db ?? openDb(resolveDbPath());
  const client = options.client ?? new RiotClient({ autoLoadEnv: true });
  try {
    return await runSummonerBackfillInner(db, options, log, client);
  } finally {
    if (ownsDb) db.close();
  }
}

async function runSummonerBackfillInner(
  db: Database.Database,
  options: SummonerBackfillOptions,
  log: (message: string) => void,
  client: RiotClient,
): Promise<SummonerBackfillResult> {
  const matches = pendingMatches(db, options.platform, options.limit);

  const result: SummonerBackfillResult = {
    platform: options.platform,
    candidates: matches.length,
    fetched: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    stoppedEarly: false,
    budgetExhausted: false,
  };

  const updateStmt = db.prepare(
    `UPDATE participants SET summoner1_id = ?, summoner2_id = ?
     WHERE match_id = ? AND puuid = ?`,
  );

  let calls = 0;
  let consecutiveFailed = 0;
  for (const [index, match] of matches.entries()) {
    if (options.callBudget !== undefined && calls >= options.callBudget) {
      result.budgetExhausted = true;
      break;
    }
    try {
      calls += 1;
      const raw = await client.getMatch(
        match.platform as Parameters<RiotClient['getMatch']>[0],
        match.match_id,
      );
      const parsed = riotMatchDtoSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(`match detail schema mismatch: ${parsed.error.message}`);
      }
      const spells = new Map<string, { s1: number | null; s2: number | null }>();
      for (const p of parsed.data.info.participants) {
        spells.set(p.puuid, {
          s1: p.spell1Id ?? p.summoner1Id ?? null,
          s2: p.spell2Id ?? p.summoner2Id ?? null,
        });
      }

      const write = db.transaction(() => {
        let touched = 0;
        for (const [puuid, spell] of spells) {
          if (spell.s1 === null || spell.s2 === null) continue;
          touched += updateStmt.run(spell.s1, spell.s2, match.match_id, puuid).changes;
        }
        return touched;
      });
      const touched = write.immediate();

      result.fetched += 1;
      result.updated += touched;
      if (touched === 0) result.skipped += 1;
      consecutiveFailed = 0;
      log(`[${index + 1}/${matches.length}] ${result.fetched} match(es) processed`);
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
      throw error;
    }
  }

  log(
    `Summoner backfill ${result.stoppedEarly ? 'stopped early' : 'complete'}: ` +
      `${result.fetched} matches fetched, ${result.updated} participant row(s) updated, ` +
      `${result.skipped} skipped, ${result.failed} failed` +
      `${result.budgetExhausted ? `, call budget ${options.callBudget} reached` : ''}.`,
  );

  return result;
}
