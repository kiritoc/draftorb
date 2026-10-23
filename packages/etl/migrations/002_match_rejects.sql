-- Migration 002: match_rejects
-- Records match ids that were fetched during ingestion but not stored in
-- `matches` (wrong queue, too short, off-patch, invalid payload). Used for
-- cross-player dedup so a shared match is only fetched and evaluated once.
CREATE TABLE IF NOT EXISTS match_rejects (
  match_id TEXT PRIMARY KEY,
  reason TEXT NOT NULL CHECK (reason IN ('queue', 'short', 'patch', 'invalid')),
  patch TEXT,              -- actual patch of the match (reason = 'patch' only)
  checked_at INTEGER NOT NULL
);
