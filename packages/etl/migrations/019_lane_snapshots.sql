-- Prompt-2 Phase 2 (D-091 follow-up): per-participant lane snapshots from
-- timeline participantFrames. One row per (match, participant, minute) at
-- the first frame at-or-after each target minute; matches without frames
-- (early surrender/remake) simply have no rows — never store 0.

CREATE TABLE lane_snapshots (
  match_id TEXT NOT NULL,
  participant_id INTEGER NOT NULL,
  minute INTEGER NOT NULL,
  ts_ms INTEGER NOT NULL,
  position TEXT,
  level INTEGER,
  gold INTEGER,
  xp INTEGER,
  cs INTEGER,
  PRIMARY KEY (match_id, participant_id, minute)
);

CREATE INDEX idx_lane_snapshots_match ON lane_snapshots (match_id);
