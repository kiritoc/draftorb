import type Database from 'better-sqlite3';

import {
  RiotApiError,
  RiotAuthError,
  RiotSchemaError,
  riotMatchDtoSchema,
  type Platform,
  type RiotClient,
} from './riot';
import { enrichParticipants, type EnrichmentOptions } from './enrichment';
import {
  extractParticipants,
  InvalidMatchParticipantsError,
  type ParticipantRow,
} from './participants';
import { extractChallenges } from './challenges';
import {
  isCompleteStoredMatch,
  storedParticipantCount,
  persistAcceptedMatch,
  type MatchPersistStatements,
} from './matches-persist';
import {
  evaluateMatch,
  findRejection,
  patchFromGameVersion,
  rankSummary,
  writeCursor,
  type MatchOutcome,
  type PlayerCursor,
} from './matches-store';

export interface MatchProcessContext {
  db: Database.Database;
  stmts: MatchPersistStatements;
  client: RiotClient;
  platform: Platform;
  cursorKey: string;
  queueId: number;
  minDuration: number;
  /** `patch_index` lower bound for this run (D-043); undefined = no window. */
  sincePatchIndex?: number;
  /** `version_label -> patch_index` via the `patches` table (refreshes on miss). */
  resolvePatchIndex: (versionLabel: string) => Promise<number | undefined>;
  player: { puuid: string; rank_score: number };
  loadRanks: (puuids: readonly string[]) => Map<string, number>;
  base: { stored: number; duplicates: number; filtered: number; invalid: number };
  onProgress?: (message: string) => void;
  enrichmentOptions: EnrichmentOptions;
}

export interface MatchProcessResult {
  outcome: MatchOutcome;
  playerFailed: boolean;
}

export type RunTotals = { stored: number; duplicates: number; filtered: number; invalid: number };

/**
 * Classifies errors that should abort the whole ingestion (auth) versus errors that
 * are transient for a single player (rate-limit spikes, network blips) and let the
 * run continue with later players. Auth and schema errors are never transient.
 */
export function isTransientMatchError(error: unknown): boolean {
  if (error instanceof RiotAuthError) return false;
  if (error instanceof RiotSchemaError) return false;
  if (error instanceof RiotApiError) {
    if (error.status === 429) return true;
    if (error.status >= 500) return true;
    if (error.status === 0) return true;
  }
  return error instanceof Error && /network|timeout|fetch/i.test(error.message);
}

/**
 * Runs enrichment for a stored match and marks it as enriched on success.
 * Failures are logged but never abort the ingestion flow — the match
 * stays `enriched = 0` so it will be retried on the next run.
 */
async function tryEnrich(
  ctx: MatchProcessContext,
  matchId: string,
  participants: ParticipantRow[],
): Promise<void> {
  try {
    const summary = await enrichParticipants(matchId, participants, ctx.enrichmentOptions);
    if (summary.failures === 0) {
      ctx.stmts.markEnriched.run(matchId);
    }
    ctx.onProgress?.(
      `Enrichment done: ranks=${summary.ranksFetched} cached=${summary.ranksCached} ` +
        `mastery=${summary.masteryFetched} reused=${summary.masteryCached}` +
        (summary.failures > 0 ? ` failures=${summary.failures}` : ''),
    );
  } catch (err) {
    ctx.onProgress?.(`enrichment failed: ${String(err)}`);
  }
}

/**
 * Processes one match id from a player's snapshot. Mutates `cursor` and `run` and
 * persists them transactionally so that kill / resume (the player resumability
 * contract) is preserved.
 *
 * Returns the match outcome and whether the player should be marked failed: a
 * transient error aborts this player's loop without persisting the cursor for the
 * current id, so the run can continue with the next player.
 */
export async function processMatch(
  ctx: MatchProcessContext,
  matchId: string,
  index: number,
  cursor: PlayerCursor,
  run: RunTotals,
): Promise<MatchProcessResult> {
  let outcome: MatchOutcome = 'filtered';
  let didCountOutcome = false;
  let repairingIncompleteMatch = false;
  let lastGameCreation = cursor.lastGameCreation;

  try {
    const participantCount = storedParticipantCount(ctx.stmts, matchId);
    if (await findRejection(ctx.db, matchId, ctx.sincePatchIndex, ctx.resolvePatchIndex)) {
      outcome = 'filtered';
    } else if (isCompleteStoredMatch(participantCount)) {
      outcome = 'duplicate';
      const enrichedRow = ctx.stmts.isEnriched.get(matchId) as { enriched: number } | undefined;
      if (!enrichedRow || !enrichedRow.enriched) {
        const storedParticipants = ctx.stmts.loadParticipantsForEnrichment.all(
          matchId,
        ) as ParticipantRow[];
        await tryEnrich(ctx, matchId, storedParticipants);
      }
    } else {
      repairingIncompleteMatch = participantCount !== undefined;
      const raw = await ctx.client.getMatch(ctx.platform, matchId);
      const parsed = riotMatchDtoSchema.safeParse(raw);
      if (!parsed.success) {
        throw new RiotSchemaError(matchId, parsed.error.message);
      }
      const match = parsed.data;
      const evaluated = await evaluateMatch(
        match,
        ctx.queueId,
        ctx.minDuration,
        ctx.resolvePatchIndex,
        ctx.sincePatchIndex,
      );
      outcome = evaluated.outcome;
      if (evaluated.reason === null) {
        lastGameCreation = Math.max(lastGameCreation, match.info.gameCreation);
        const participantIds = match.info.participants.map(
          (matchParticipant) => matchParticipant.puuid,
        );
        const ranksByPuuid = ctx.loadRanks(participantIds);
        const participants = extractParticipants(match, ranksByPuuid);
        const rank = rankSummary(
          ranksByPuuid,
          participants.map((row) => row.puuid),
          ctx.player.puuid,
          ctx.player.rank_score,
        );
        const matchRow = {
          match_id: matchId,
          platform: ctx.platform,
          patch: patchFromGameVersion(match.info.gameVersion),
          queue_id: match.info.queueId,
          duration: match.info.gameDuration,
          created_at: match.info.gameCreation,
          avg_rank_score: rank.avg,
          rank_known_count: rank.known,
        };
        outcome = persistAcceptedMatch(ctx.db, ctx.stmts, {
          match: matchRow,
          participants,
          challenges: extractChallenges(match, matchId),
          repairingIncompleteMatch,
          cursorKey: ctx.cursorKey,
          applyOutcome: (persisted) => {
            cursor.processed = index + 1;
            cursor.stored = ctx.base.stored + run.stored + (persisted === 'stored' ? 1 : 0);
            cursor.duplicates =
              ctx.base.duplicates + run.duplicates + (persisted === 'duplicate' ? 1 : 0);
            cursor.filtered = ctx.base.filtered + run.filtered;
            cursor.invalid = ctx.base.invalid + run.invalid;
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

        if (outcome === 'stored') {
          await tryEnrich(ctx, matchId, participants);
        }

        didCountOutcome = true;
      } else {
        const persist = ctx.db.transaction(() => {
          ctx.stmts.insertReject.run({
            match_id: matchId,
            reason: evaluated.reason,
            patch: evaluated.patchLabel ?? null,
            checked_at: Date.now(),
          });
          if (repairingIncompleteMatch) {
            ctx.stmts.deleteMatch.run(matchId);
          }
          cursor.processed = index + 1;
          if (evaluated.outcome === 'invalid') {
            cursor.invalid = ctx.base.invalid + run.invalid + 1;
          } else {
            cursor.filtered = ctx.base.filtered + run.filtered + 1;
          }
          cursor.lastGameCreation = lastGameCreation;
          cursor.updatedAt = Date.now();
          writeCursor(ctx.db, ctx.cursorKey, cursor);
        });
        persist();
        if (evaluated.outcome === 'invalid') {
          run.invalid += 1;
        } else {
          run.filtered += 1;
        }
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
      const persist = ctx.db.transaction(() => {
        if (repairingIncompleteMatch) {
          ctx.stmts.deleteMatch.run(matchId);
        }
        ctx.stmts.insertReject.run({
          match_id: matchId,
          reason: 'invalid',
          patch: null,
          checked_at: Date.now(),
        });
        cursor.processed = index + 1;
        cursor.invalid = ctx.base.invalid + run.invalid + 1;
        cursor.updatedAt = Date.now();
        writeCursor(ctx.db, ctx.cursorKey, cursor);
      });
      persist();
      run.invalid += 1;
      didCountOutcome = true;
      return { outcome: 'invalid', playerFailed: false };
    }
    if (isTransientMatchError(error)) {
      return { outcome, playerFailed: true };
    }
    throw error;
  }

  if (!didCountOutcome) {
    run[outcome === 'duplicate' ? 'duplicates' : outcome] += 1;
  }

  cursor.processed = index + 1;
  cursor.stored = ctx.base.stored + run.stored;
  cursor.duplicates = ctx.base.duplicates + run.duplicates;
  cursor.filtered = ctx.base.filtered + run.filtered;
  cursor.invalid = ctx.base.invalid + run.invalid;
  cursor.lastGameCreation = lastGameCreation;
  cursor.updatedAt = Date.now();
  const persistCursor = ctx.db.transaction(() => {
    writeCursor(ctx.db, ctx.cursorKey, cursor);
  });
  persistCursor();

  return { outcome, playerFailed: false };
}
