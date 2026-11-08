-- Migration 016: data_breakpoints + entity_change_scores (T-019.e, D-045..D-047)
-- DDL per DATA_MODEL.md §5.4. `entity_change_scores` is populated by the
-- `changes` command (T-019.d); `data_breakpoints` is managed by the
-- `breakpoint` command (manual rows) and by T-019.d (auto suggestions).
CREATE TABLE entity_change_scores (
  entity_type TEXT NOT NULL CHECK (entity_type IN ('champion','item','rune')),
  entity_id INTEGER NOT NULL,
  patch_index INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  change_score REAL CHECK (change_score IS NULL OR (change_score >= 0 AND change_score <= 1)),
  details TEXT NOT NULL,               -- JSON list of {key, old, new, contribution}
  PRIMARY KEY (entity_type, entity_id, patch_index)
);

CREATE TABLE data_breakpoints (
  id INTEGER PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('champion','item','rune','global')),
  scope_id INTEGER,                    -- NULL iff scope_type = 'global'
  from_patch_index INTEGER NOT NULL CHECK (from_patch_index >= 1),
  mode TEXT NOT NULL CHECK (mode IN ('reset','downweight')),
  weight_factor REAL,                  -- NULL for reset; 0 < weight_factor <= 1 for downweight
  status TEXT NOT NULL CHECK (status IN ('suggested','active','rejected')),
  source TEXT NOT NULL CHECK (source IN ('auto','manual')),
  reason TEXT NOT NULL CHECK (length(reason) > 0),
  created_at INTEGER NOT NULL,
  CHECK ((scope_type = 'global') = (scope_id IS NULL)),
  CHECK (
    (mode = 'reset' AND weight_factor IS NULL)
    OR (mode = 'downweight' AND weight_factor IS NOT NULL AND weight_factor > 0 AND weight_factor <= 1)
  )
);

-- One breakpoint per (scope, from_patch_index, source); the COALESCE makes
-- the NULL scope_id of 'global' rows participate in uniqueness (SPECS §16).
CREATE UNIQUE INDEX idx_data_breakpoints_unique ON data_breakpoints(scope_type, COALESCE(scope_id, -1), from_patch_index, source);
