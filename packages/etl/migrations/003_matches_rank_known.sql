-- Migration 003: known participant rank count
-- Stores how many match participants contributed to avg_rank_score.
ALTER TABLE matches ADD COLUMN rank_known_count INTEGER NOT NULL DEFAULT 0;
