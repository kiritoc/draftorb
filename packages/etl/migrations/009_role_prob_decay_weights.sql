-- Migration 009: decay-weighted role_prob evidence.
-- Adds games_w (sum of recency weights) and games_w2 (sum of squared weights)
-- so role_prob can use cross-patch recency decay like baseline (D-033) instead
-- of being wiped and rebuilt from a single patch (D-031 flaw).
ALTER TABLE role_prob ADD COLUMN games_w REAL NOT NULL DEFAULT 0;
ALTER TABLE role_prob ADD COLUMN games_w2 REAL NOT NULL DEFAULT 0;
