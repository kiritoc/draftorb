-- Migration 001: Initial schema
-- Creates core tables for ETL pipeline and aggregated tables for recommendations

-- Core tables
CREATE TABLE IF NOT EXISTS players (
  puuid TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  tier TEXT NOT NULL,
  division TEXT NOT NULL,
  lp INTEGER NOT NULL,
  rank_score REAL NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS matches (
  match_id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  patch TEXT NOT NULL,
  queue_id INTEGER NOT NULL,
  duration INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  avg_rank_score REAL NOT NULL,
  fetched_timeline INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS participants (
  match_id TEXT NOT NULL,
  puuid TEXT NOT NULL,
  team_id INTEGER NOT NULL,
  champion_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  win INTEGER NOT NULL,
  rank_score REAL NOT NULL,
  champion_games INTEGER NOT NULL,
  keystone INTEGER NOT NULL,
  primary_style INTEGER NOT NULL,
  sub_style INTEGER NOT NULL,
  perks_json TEXT NOT NULL,
  items_json TEXT NOT NULL,
  kills INTEGER NOT NULL,
  deaths INTEGER NOT NULL,
  assists INTEGER NOT NULL,
  PRIMARY KEY (match_id, puuid)
);

CREATE TABLE IF NOT EXISTS item_events (
  match_id TEXT NOT NULL,
  puuid TEXT NOT NULL,
  ts INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  team_gold_diff INTEGER NOT NULL,
  kills_diff INTEGER NOT NULL,
  PRIMARY KEY (match_id, puuid, ts, item_id)
);

CREATE TABLE IF NOT EXISTS ingest_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_part_champ_role ON participants(champion_id, role);
CREATE INDEX IF NOT EXISTS idx_part_match_id ON participants(match_id);
CREATE INDEX IF NOT EXISTS idx_part_puuid ON participants(puuid);
CREATE INDEX IF NOT EXISTS idx_matches_platform_patch ON matches(platform, patch);
CREATE INDEX IF NOT EXISTS idx_players_platform_tier ON players(platform, tier);

-- Aggregated tables (recomputed per patch)
CREATE TABLE IF NOT EXISTS role_prob (
  champion_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  games INTEGER NOT NULL,
  prob REAL NOT NULL,
  PRIMARY KEY (champion_id, role)
);

CREATE TABLE IF NOT EXISTS baseline (
  champion_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  rank_bucket TEXT NOT NULL,
  wins_w REAL NOT NULL,
  games_w REAL NOT NULL,
  PRIMARY KEY (champion_id, role, rank_bucket)
);

CREATE TABLE IF NOT EXISTS pair_ally (
  support_id INTEGER NOT NULL,
  ally_id INTEGER NOT NULL,
  ally_role TEXT NOT NULL,
  rank_bucket TEXT NOT NULL,
  wins_w REAL NOT NULL,
  games_w REAL NOT NULL,
  PRIMARY KEY (support_id, ally_id, ally_role, rank_bucket)
);

CREATE TABLE IF NOT EXISTS pair_enemy (
  support_id INTEGER NOT NULL,
  enemy_id INTEGER NOT NULL,
  enemy_role TEXT NOT NULL,
  rank_bucket TEXT NOT NULL,
  wins_w REAL NOT NULL,
  games_w REAL NOT NULL,
  PRIMARY KEY (support_id, enemy_id, enemy_role, rank_bucket)
);

CREATE TABLE IF NOT EXISTS rune_ctx (
  champion_id INTEGER NOT NULL,
  context_key TEXT NOT NULL,
  perks_hash TEXT NOT NULL,
  perks_json TEXT NOT NULL,
  wins_w REAL NOT NULL,
  games_w REAL NOT NULL,
  players INTEGER NOT NULL,
  PRIMARY KEY (champion_id, context_key, perks_hash)
);

CREATE TABLE IF NOT EXISTS item_build (
  champion_id INTEGER NOT NULL,
  context_key TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  order_idx INTEGER NOT NULL,
  wins_w REAL NOT NULL,
  games_w REAL NOT NULL,
  PRIMARY KEY (champion_id, context_key, item_id, order_idx)
);

-- Indexes for aggregated tables
CREATE INDEX IF NOT EXISTS idx_role_prob_champion ON role_prob(champion_id);
CREATE INDEX IF NOT EXISTS idx_baseline_champion_role ON baseline(champion_id, role);
CREATE INDEX IF NOT EXISTS idx_pair_ally_support ON pair_ally(support_id);
CREATE INDEX IF NOT EXISTS idx_pair_enemy_support ON pair_enemy(support_id);
CREATE INDEX IF NOT EXISTS idx_rune_ctx_champion ON rune_ctx(champion_id);
CREATE INDEX IF NOT EXISTS idx_item_build_champion ON item_build(champion_id);
