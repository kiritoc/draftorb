-- Migration 004: role-generic aggregates and participant enrichment fields
-- The old support-only aggregate tables are derived data and safe to drop and
-- recreate. This is necessary because migration 001 used support_id columns
-- and omitted role/context dimensions required by DATA_MODEL.md.

ALTER TABLE item_events ADD COLUMN item_slot INTEGER;

UPDATE matches SET rank_known_count = 1 WHERE rank_known_count < 1;

CREATE TABLE participants_new (
  match_id TEXT NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
  puuid TEXT NOT NULL,
  team_id INTEGER NOT NULL,
  champion_id INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT')),
  win INTEGER NOT NULL CHECK (win IN (0, 1)),
  rank_score REAL,
  champion_games INTEGER NOT NULL DEFAULT 0,
  mastery_points INTEGER,
  is_expert INTEGER,
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

INSERT INTO participants_new (
  match_id, puuid, team_id, champion_id, role, win, rank_score,
  champion_games, mastery_points, is_expert, keystone, primary_style,
  sub_style, perks_json, items_json, kills, deaths, assists
)
SELECT
  match_id, puuid, team_id, champion_id, role, win, rank_score,
  champion_games, NULL, NULL, keystone, primary_style,
  sub_style, perks_json, items_json, kills, deaths, assists
FROM participants;

DROP TABLE participants;
ALTER TABLE participants_new RENAME TO participants;

CREATE TABLE item_events_new (
  match_id TEXT NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
  puuid TEXT NOT NULL,
  ts INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  team_gold_diff INTEGER NOT NULL,
  kills_diff INTEGER NOT NULL,
  item_slot INTEGER,
  PRIMARY KEY (match_id, puuid, ts, item_id, type)
);

INSERT INTO item_events_new (
  match_id, puuid, ts, item_id, type, team_gold_diff, kills_diff, item_slot
)
SELECT
  match_id, puuid, ts, item_id, type, team_gold_diff, kills_diff, item_slot
FROM item_events;

DROP TABLE item_events;
ALTER TABLE item_events_new RENAME TO item_events;

DROP TABLE IF EXISTS baseline;
DROP TABLE IF EXISTS pair_ally;
DROP TABLE IF EXISTS pair_enemy;
DROP TABLE IF EXISTS rune_ctx;
DROP TABLE IF EXISTS item_build;

CREATE TABLE baseline (
  champion_id INTEGER NOT NULL,
  my_role TEXT NOT NULL,
  rank_bucket TEXT NOT NULL,
  wins_w REAL NOT NULL,
  games_w REAL NOT NULL,
  games_w2 REAL NOT NULL,
  PRIMARY KEY (champion_id, my_role, rank_bucket)
);

CREATE TABLE pair_ally (
  my_champion_id INTEGER NOT NULL,
  my_role TEXT NOT NULL,
  other_champion_id INTEGER NOT NULL,
  other_role TEXT NOT NULL,
  rank_bucket TEXT NOT NULL,
  wins_w REAL NOT NULL,
  games_w REAL NOT NULL,
  games_w2 REAL NOT NULL,
  PRIMARY KEY (my_champion_id, my_role, other_champion_id, other_role, rank_bucket)
);

CREATE TABLE pair_enemy (
  my_champion_id INTEGER NOT NULL,
  my_role TEXT NOT NULL,
  other_champion_id INTEGER NOT NULL,
  other_role TEXT NOT NULL,
  rank_bucket TEXT NOT NULL,
  wins_w REAL NOT NULL,
  games_w REAL NOT NULL,
  games_w2 REAL NOT NULL,
  PRIMARY KEY (my_champion_id, my_role, other_champion_id, other_role, rank_bucket)
);

CREATE TABLE lane_vs (
  my_champion_id INTEGER NOT NULL,
  my_role TEXT NOT NULL,
  opp1_id INTEGER NOT NULL,
  opp2_id INTEGER,
  rank_bucket TEXT NOT NULL,
  wins_w REAL NOT NULL,
  games_w REAL NOT NULL,
  games_w2 REAL NOT NULL,
  PRIMARY KEY (my_champion_id, my_role, opp1_id, opp2_id, rank_bucket)
);

CREATE TABLE lane_full (
  my_champion_id INTEGER NOT NULL,
  my_role TEXT NOT NULL,
  partner_id INTEGER,
  opp1_id INTEGER NOT NULL,
  opp2_id INTEGER,
  rank_bucket TEXT NOT NULL,
  wins_w REAL NOT NULL,
  games_w REAL NOT NULL,
  games_w2 REAL NOT NULL,
  PRIMARY KEY (
    my_champion_id, my_role, partner_id, opp1_id, opp2_id, rank_bucket
  )
);

CREATE TABLE rune_ctx (
  champion_id INTEGER NOT NULL,
  my_role TEXT NOT NULL,
  context_key TEXT NOT NULL,
  perks_hash TEXT NOT NULL,
  perks_json TEXT NOT NULL,
  wins_w REAL NOT NULL,
  games_w REAL NOT NULL,
  games_w2 REAL NOT NULL,
  players INTEGER NOT NULL,
  PRIMARY KEY (champion_id, my_role, context_key, perks_hash)
);

CREATE TABLE item_build (
  champion_id INTEGER NOT NULL,
  my_role TEXT NOT NULL,
  slot_idx INTEGER NOT NULL,
  time_bucket TEXT NOT NULL,
  state_bucket TEXT NOT NULL,
  profile_key TEXT NOT NULL,
  lane_key TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  wins_w REAL NOT NULL,
  games_w REAL NOT NULL,
  games_w2 REAL NOT NULL,
  PRIMARY KEY (
    champion_id, my_role, slot_idx, time_bucket, state_bucket,
    profile_key, lane_key, item_id
  )
);

CREATE INDEX idx_part_champ_role ON participants(champion_id, role);
CREATE INDEX idx_part_match_id ON participants(match_id);
CREATE INDEX idx_part_puuid ON participants(puuid);
CREATE INDEX idx_baseline_champion_role ON baseline(champion_id, my_role);
CREATE INDEX idx_pair_ally_role ON pair_ally(my_champion_id, my_role);
CREATE INDEX idx_pair_enemy_role ON pair_enemy(my_champion_id, my_role);
CREATE INDEX idx_lane_vs_role ON lane_vs(my_champion_id, my_role);
CREATE INDEX idx_lane_full_role ON lane_full(my_champion_id, my_role);
CREATE INDEX idx_rune_ctx_champion ON rune_ctx(champion_id, my_role);
CREATE INDEX idx_item_build_champion ON item_build(champion_id, my_role);
