-- Migration 006: Nullable rank fields for unranked player caching (T-014)
-- T-014 enriches bot-lane participant ranks via league-v4 entries/by-puuid.
-- Players with no RANKED_SOLO_5x5 entry are cached in `players` with
-- NULL rank_score (and NULL tier/division) so they are never re-fetched.
-- This also fixes `createRankLoader` to skip those NULL entries when
-- computing rank averages.

CREATE TABLE players_new (
  puuid TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  tier TEXT,
  division TEXT,
  lp INTEGER NOT NULL DEFAULT 0,
  rank_score REAL,
  updated_at INTEGER NOT NULL
);

INSERT INTO players_new (puuid, platform, tier, division, lp, rank_score, updated_at)
SELECT puuid, platform, tier, division, lp, rank_score, updated_at FROM players;

DROP TABLE players;
ALTER TABLE players_new RENAME TO players;

CREATE INDEX IF NOT EXISTS idx_players_platform_tier ON players(platform, tier);
CREATE INDEX IF NOT EXISTS idx_players_rank_score ON players(rank_score);
