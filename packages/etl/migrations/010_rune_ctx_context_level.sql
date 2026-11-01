-- Migration 010: Add context_level to rune_ctx for back-off ordering
-- The rune aggregation (T-018) computes context_level in memory but the schema
-- lacked the column. This adds it and defaults to 1 (lane contexts).
ALTER TABLE rune_ctx ADD COLUMN context_level INTEGER NOT NULL DEFAULT 1;
