-- Migration 013: match_rejects 'pruned' reason (D-044, SPECS §13)
-- `pnpm etl prune` tombstones deleted matches with reason 'pruned'. The
-- CHECK constraint from migration 002 cannot be altered in place, so the
-- table is rebuilt; existing reject rows are preserved.
CREATE TABLE match_rejects_new (
  match_id TEXT PRIMARY KEY,
  reason TEXT NOT NULL CHECK (reason IN ('queue', 'short', 'patch', 'invalid', 'pruned')),
  patch TEXT,              -- actual patch of the match ('patch' and 'pruned' reasons)
  checked_at INTEGER NOT NULL
);

INSERT INTO match_rejects_new (match_id, reason, patch, checked_at)
SELECT match_id, reason, patch, checked_at FROM match_rejects;

DROP TABLE match_rejects;
ALTER TABLE match_rejects_new RENAME TO match_rejects;
