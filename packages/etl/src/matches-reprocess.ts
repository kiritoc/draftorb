/**
 * @draftorb/etl — Retry pass for matches stored but not fully enriched.
 *
 * Split out of matches.ts (file size); pure move, no logic change.
 */

import type Database from 'better-sqlite3';

import type { Role } from '@draftorb/shared';
import type { RiotClient, Platform } from './riot';
import { enrichParticipants, type EnrichmentOptions } from './enrichment';
import { MATCH_PARTICIPANT_COUNT, type ParticipantRow } from './participants';
import { listUnenrichedMatches } from './matches-store';
import type { PlayerIngestionResult } from './matches';
import type { RunTotals } from './matches-process';

/** Options for the unenriched-match reprocess pass. */
export interface ReprocessOptions {
  myRole: Role;
  minChampGames: number;
}

export function buildPlayerResult(
  puuid: string,
  status: PlayerIngestionResult['status'],
  listed: number,
  run: RunTotals,
): PlayerIngestionResult {
  return { puuid, status, listed, ...run };
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
export async function reprocessUnenrichedMatches(
  db: Database.Database,
  client: RiotClient,
  opts: ReprocessOptions,
  log: (msg: string) => void,
): Promise<{ reprocessed: number; skipped: number }> {
  const pending = listUnenrichedMatches(db);
  let reprocessed = 0;
  let skipped = 0;

  // Match IDs and puuids are never logged: workflow logs are public (D-078).
  for (const [index, { matchId, platform }] of pending.entries()) {
    const tag = `[${index + 1}/${pending.length}]`;
    const participants = db
      .prepare('SELECT * FROM participants WHERE match_id = ?')
      .all(matchId) as ParticipantRow[];

    if (participants.length < MATCH_PARTICIPANT_COUNT) {
      log(`Reprocess ${tag}: skipping match — incomplete participants (${participants.length})`);
      skipped += 1;
      continue;
    }

    const botLaneRoles: ReadonlySet<Role> = new Set(['ADC', 'SUPPORT']);
    const seed =
      participants.find((p) => botLaneRoles.has(p.role) && p.rank_score !== null) ??
      participants.find((p) => p.rank_score !== null);

    if (!seed || seed.rank_score === null) {
      log(`Reprocess ${tag}: skipping match — no ranked participant to use as seed`);
      skipped += 1;
      continue;
    }

    try {
      const enrichmentOpts: EnrichmentOptions = {
        db,
        client,
        platform: platform as Platform,
        myRole: opts.myRole,
        seedPuuid: seed.puuid,
        seedRankScore: seed.rank_score,
        minChampGames: opts.minChampGames,
        onProgress: log,
      };
      const summary = await enrichParticipants(matchId, participants, enrichmentOpts);
      if (summary.failures === 0) {
        db.prepare('UPDATE matches SET enriched = 1 WHERE match_id = ?').run(matchId);
        log(`Reprocessed ${tag}: ranks=${summary.ranksFetched} mastery=${summary.masteryFetched}`);
      } else {
        log(`Reprocessed ${tag}: ${summary.failures} failure(s), left unenriched for retry`);
      }
      reprocessed += 1;
    } catch (err) {
      log(`Reprocess ${tag}: enrichment error: ${String(err)}`);
      skipped += 1;
    }
  }

  if (reprocessed > 0) {
    log(`Reprocess pass: ${reprocessed} match(es) attempted, ${skipped} skipped`);
  }

  return { reprocessed, skipped };
}
