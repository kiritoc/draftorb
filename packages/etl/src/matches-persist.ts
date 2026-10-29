import type Database from 'better-sqlite3';

import { MATCH_PARTICIPANT_COUNT, type ParticipantRow } from './participants';
import { writeCursor, type PlayerCursor } from './matches-store';

export interface MatchPersistStatements {
  getStoredMatch: Database.Statement;
  deleteMatch: Database.Statement;
  deleteParticipants: Database.Statement;
  insertMatch: Database.Statement;
  updateMatchRanks: Database.Statement;
  insertParticipant: Database.Statement;
  insertReject: Database.Statement;
  isEnriched: Database.Statement;
  markEnriched: Database.Statement;
  loadParticipantsForEnrichment: Database.Statement;
}

/**
 * Prepares all SQLite statements for match persistence operations.
 * Returns an object containing prepared statements for querying, inserting,
 * updating, and deleting matches and their participants.
 */
export function prepareMatchPersist(db: Database.Database): MatchPersistStatements {
  return {
    getStoredMatch: db.prepare(
      `SELECT COUNT(p.puuid) AS participant_count
       FROM matches m
       LEFT JOIN participants p ON p.match_id = m.match_id
       WHERE m.match_id = ?
       GROUP BY m.match_id`,
    ),
    deleteMatch: db.prepare('DELETE FROM matches WHERE match_id = ?'),
    deleteParticipants: db.prepare('DELETE FROM participants WHERE match_id = ?'),
    insertMatch: db.prepare(
      `INSERT OR IGNORE INTO matches
       (match_id, platform, patch, queue_id, duration, created_at, avg_rank_score,
        rank_known_count, fetched_timeline, enriched)
      VALUES (@match_id, @platform, @patch, @queue_id, @duration, @created_at, @avg_rank_score,
         @rank_known_count, 0, 0)`,
    ),
    updateMatchRanks: db.prepare(
      `UPDATE matches SET
         platform = @platform,
         patch = @patch,
         queue_id = @queue_id,
         duration = @duration,
         created_at = @created_at,
         avg_rank_score = @avg_rank_score,
         rank_known_count = @rank_known_count,
         enriched = 0
       WHERE match_id = @match_id`,
    ),
    insertParticipant: db.prepare(
      `INSERT INTO participants (
          match_id, puuid, team_id, champion_id, role, win, rank_score, champion_games,
          mastery_points, is_expert, keystone, primary_style, sub_style, perks_json,
          items_json, kills, deaths, assists
        ) VALUES (
          @match_id, @puuid, @team_id, @champion_id, @role, @win, @rank_score, @champion_games,
          @mastery_points, @is_expert, @keystone, @primary_style, @sub_style, @perks_json,
          @items_json, @kills, @deaths, @assists
        )`,
    ),
    isEnriched: db.prepare('SELECT enriched FROM matches WHERE match_id = ?'),
    markEnriched: db.prepare('UPDATE matches SET enriched = 1 WHERE match_id = ?'),
    loadParticipantsForEnrichment: db.prepare(
      `SELECT match_id, puuid, team_id, champion_id, role, win, rank_score, champion_games,
              mastery_points, is_expert, keystone, primary_style, sub_style, perks_json,
              items_json, kills, deaths, assists
       FROM participants WHERE match_id = ?`,
    ),
    insertReject: db.prepare(
      `INSERT OR REPLACE INTO match_rejects (match_id, reason, patch, checked_at)
     VALUES (@match_id, @reason, @patch, @checked_at)`,
    ),
  };
}

/**
 * Retrieves the number of participants stored for a given match.
 * Returns undefined if the match does not exist in the database.
 */
export function storedParticipantCount(
  stmts: MatchPersistStatements,
  matchId: string,
): number | undefined {
  const storedMatch = stmts.getStoredMatch.get(matchId) as
    { participant_count: number } | undefined;
  return storedMatch?.participant_count;
}

/**
 * Checks if a stored match has the required minimum number of participants.
 * Returns true only if the participant count is defined and meets or exceeds
 * the threshold defined by MATCH_PARTICIPANT_COUNT.
 */
export function isCompleteStoredMatch(participantCount: number | undefined): boolean {
  return participantCount !== undefined && participantCount >= MATCH_PARTICIPANT_COUNT;
}

export interface StoredMatchRow {
  match_id: string;
  platform: string;
  patch: string;
  queue_id: number;
  duration: number;
  created_at: number;
  avg_rank_score: number;
  rank_known_count: number;
}

/**
 * Persists a match and its participants to the database in an atomic transaction.
 * Handles duplicate detection and supports repairing incomplete matches by
 * updating match metadata and replacing all participants when repairingIncompleteMatch is true.
 * Updates the processing cursor based on whether the match was stored or detected as a duplicate.
 */
export function persistAcceptedMatch(
  db: Database.Database,
  stmts: MatchPersistStatements,
  params: {
    match: StoredMatchRow;
    participants: ParticipantRow[];
    repairingIncompleteMatch: boolean;
    cursorKey: string;
    applyOutcome: (outcome: 'stored' | 'duplicate') => PlayerCursor;
  },
): 'stored' | 'duplicate' {
  let outcome: 'stored' | 'duplicate' = 'stored';
  const persist = db.transaction(() => {
    const change = stmts.insertMatch.run(params.match);
    if (change.changes === 0 && !params.repairingIncompleteMatch) {
      outcome = 'duplicate';
    } else {
      if (params.repairingIncompleteMatch) {
        stmts.updateMatchRanks.run(params.match);
        stmts.deleteParticipants.run(params.match.match_id);
      }
      for (const participant of params.participants) {
        stmts.insertParticipant.run(participant);
      }
      outcome = 'stored';
    }
    writeCursor(db, params.cursorKey, params.applyOutcome(outcome));
  });
  persist();
  return outcome;
}
