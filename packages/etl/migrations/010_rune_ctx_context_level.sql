-- Migration 010: Add context_level to rune_ctx for back-off ordering
-- The rune aggregation (T-018) computes context_level in memory but the schema
-- lacked the column. This adds it and defaults to 1 (lane contexts).
ALTER TABLE rune_ctx ADD COLUMN context_level INTEGER NOT NULL DEFAULT 1;

-- Backfill existing rows from context_key (lane: 3-slot=1, 2-slot=2, 1-slot=3;
-- damagemix=4; global=5).
UPDATE rune_ctx SET context_level = CASE
  WHEN context_key = 'global' THEN 5
  WHEN context_key LIKE 'damagemix:%' THEN 4
  WHEN context_key LIKE 'lane:%' THEN
    MAX(1, 3 - (LENGTH(context_key) - LENGTH(REPLACE(context_key, ',', ''))))
  ELSE context_level
END;
