/**
 * @draftorb/etl — Timeline extractor registry (T-051 Phase B).
 *
 * Each extractor turns a fetched match-v5 timeline into rows for its own
 * table(s). The pipeline extracts the shared event set once per timeline
 * fetch, then runs every pending extractor over it. Completion is recorded
 * per (match, extractor) in `extractor_runs`, so the backfill is resumable
 * per extractor and new extractors can be added without re-fetching
 * finished work. All writes for one match happen in a single transaction
 * together with the `extractor_runs` markers: a match is never marked done
 * on partial failure.
 */

import type Database from 'better-sqlite3';

import type { RiotMatchTimeline } from './riot';
import {
  type ExtractedTimelineEvents,
  type KillEventRow,
  type ItemEventRawRow,
  type ParticipantIdRow,
  type TimelineParticipantRef,
} from './timeline-events';

export interface TimelineMatchContext {
  readonly matchId: string;
  readonly platform: string;
  readonly patch: string;
}

export interface TimelineExtractor {
  readonly name: string;
  extract(
    events: ExtractedTimelineEvents,
    match: TimelineMatchContext,
    refs: readonly TimelineParticipantRef[],
    timeline: RiotMatchTimeline,
  ): void;
}

function writeItemEvents(
  db: Database.Database,
  matchId: string,
  rows: readonly ItemEventRawRow[],
): void {
  const remove = db.prepare('DELETE FROM item_events WHERE match_id = ?');
  const insert = db.prepare(
    `INSERT OR REPLACE INTO item_events
     (match_id, participant_id, puuid, ts_ms, seq, event_type, item_id,
      before_id, after_id, team_gold_diff, kills_diff)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const write = db.transaction(() => {
    remove.run(matchId);
    for (const row of rows) {
      insert.run(
        matchId,
        row.participant_id,
        row.puuid,
        row.ts_ms,
        row.seq,
        row.event_type,
        row.item_id,
        row.before_id,
        row.after_id,
        row.team_gold_diff,
        row.kills_diff,
      );
    }
  });
  write.immediate();
}

function writeKillEvents(
  db: Database.Database,
  matchId: string,
  rows: readonly KillEventRow[],
): void {
  const remove = db.prepare('DELETE FROM kill_events WHERE match_id = ?');
  const insert = db.prepare(
    `INSERT OR REPLACE INTO kill_events
     (match_id, seq, t_ms, killer_pid, victim_pid, assist_mask, bounty, shutdown_bounty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const write = db.transaction(() => {
    remove.run(matchId);
    for (const row of rows) {
      insert.run(
        matchId,
        row.seq,
        row.t_ms,
        row.killer_pid,
        row.victim_pid,
        row.assist_mask,
        row.bounty,
        row.shutdown_bounty,
      );
    }
  });
  write.immediate();
}

function writeParticipantIds(
  db: Database.Database,
  matchId: string,
  rows: readonly ParticipantIdRow[],
): void {
  const remove = db.prepare('DELETE FROM match_participant_ids WHERE match_id = ?');
  const insert = db.prepare(
    'INSERT OR REPLACE INTO match_participant_ids (match_id, participant_id, puuid) VALUES (?, ?, ?)',
  );
  const write = db.transaction(() => {
    remove.run(matchId);
    for (const row of rows) {
      insert.run(matchId, row.participant_id, row.puuid);
    }
  });
  write.immediate();
}

/** Built-in extractors, bound to a db handle for one run. */
export function createTimelineExtractors(db: Database.Database): TimelineExtractor[] {
  return [
    {
      name: 'item-events',
      extract(events, match) {
        writeItemEvents(db, match.matchId, events.itemEvents);
      },
    },
    {
      name: 'kill-events',
      extract(events, match) {
        writeKillEvents(db, match.matchId, events.killEvents);
      },
    },
    {
      name: 'participant-ids',
      extract(events, match) {
        writeParticipantIds(db, match.matchId, events.participantIds);
      },
    },
  ];
}

/** Names of the built-in timeline extractors (all share one timeline fetch). */
export const TIMELINE_EXTRACTOR_NAMES = ['item-events', 'kill-events', 'participant-ids'] as const;

export function pendingExtractors(
  db: Database.Database,
  matchId: string,
  extractors: readonly TimelineExtractor[],
): TimelineExtractor[] {
  const done = new Set(
    (
      db.prepare('SELECT extractor FROM extractor_runs WHERE match_id = ?').all(matchId) as Array<{
        extractor: string;
      }>
    ).map((row) => row.extractor),
  );
  return extractors.filter((extractor) => !done.has(extractor.name));
}

export function markExtractorDone(db: Database.Database, matchId: string, extractor: string): void {
  db.prepare('INSERT OR IGNORE INTO extractor_runs (match_id, extractor) VALUES (?, ?)').run(
    matchId,
    extractor,
  );
}
