-- Migration 007: Enriched flag on matches (T-014 follow-up)
-- Allows retrying enrichment on transient failures (HTTP 429/5xx) by
-- detecting stored matches that were not yet enriched.
ALTER TABLE matches ADD COLUMN enriched INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_matches_enriched ON matches(enriched)
WHERE enriched = 0;
