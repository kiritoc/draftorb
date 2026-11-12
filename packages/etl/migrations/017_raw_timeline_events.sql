-- T-051 Phase B (D-082 amendments): raw timeline-derived events.
--
-- item_events is rebuilt with the full event stream (purchase, undo, sold,
-- destroyed) keyed by participant_id instead of puuid, plus undo payload ids.
-- Derived columns (item_slot, state buckets, profiles) are computed at
-- aggregation time and are intentionally NOT stored here (raw facts rule).
-- The previous purchase/sold-only table is dropped; its rows are a strict
-- subset of what `etl backfill-timelines` re-extracts, so item_events must be
-- repopulated by the backfill after migrating.

DROP TABLE IF EXISTS item_events;

CREATE TABLE item_events (
  match_id TEXT NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL CHECK (participant_id BETWEEN 1 AND 10),
  puuid TEXT NOT NULL,
  ts_ms INTEGER NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,   -- per-participant event order; disambiguates same-ms duplicates
  event_type TEXT NOT NULL CHECK (event_type IN ('purchase','undo','sold','destroyed')),
  item_id INTEGER NOT NULL,
  before_id INTEGER,                -- ITEM_UNDO only, NULL otherwise
  after_id INTEGER,                 -- ITEM_UNDO only, NULL otherwise
  team_gold_diff INTEGER NOT NULL,
  kills_diff INTEGER NOT NULL,
  PRIMARY KEY (match_id, participant_id, ts_ms, seq)
);
CREATE INDEX idx_item_events_puuid ON item_events(match_id, puuid);
CREATE INDEX idx_item_events_match_ts ON item_events(match_id, ts_ms);

-- Champion kills reconstructed from CHAMPION_KILL timeline events.
-- killer_pid is NULL when the killer is not a champion (killerId = 0 or
-- unmapped); it is never stored as 0. assist_mask bit i (0-based) marks
-- participantId i+1 in assistingParticipantIds; bounty/shutdown_bounty are
-- NULL when the field is absent from the payload.
CREATE TABLE kill_events (
  match_id TEXT NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  t_ms INTEGER NOT NULL,
  killer_pid INTEGER CHECK (killer_pid BETWEEN 1 AND 10),
  victim_pid INTEGER NOT NULL CHECK (victim_pid BETWEEN 1 AND 10),
  assist_mask INTEGER NOT NULL DEFAULT 0,
  bounty INTEGER,
  shutdown_bounty INTEGER,
  PRIMARY KEY (match_id, seq)
);
CREATE INDEX idx_kill_events_match ON kill_events(match_id, t_ms);

-- participantId (1-10) -> puuid map per match, persisted so pid-based tables
-- (kill_events, item_events.participant_id) can be joined to participants.
CREATE TABLE match_participant_ids (
  match_id TEXT NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL CHECK (participant_id BETWEEN 1 AND 10),
  puuid TEXT NOT NULL,
  PRIMARY KEY (match_id, participant_id)
);

-- Per-match record of which timeline extractors have completed, so the
-- backfill is resumable per extractor and new extractors slot into the
-- registry without re-fetching finished work.
CREATE TABLE extractor_runs (
  match_id TEXT NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
  extractor TEXT NOT NULL,
  PRIMARY KEY (match_id, extractor)
);
