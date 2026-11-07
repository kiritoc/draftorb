-- Migration 015: configured profiles (T-091, D-068/D-069, DATA_MODEL.md)
-- Match history of each profile declared in data/profiles.config.json.
-- profile_games.match_id is internal only: it is NEVER exported (it can
-- identify other participants).
CREATE TABLE profiles (
  id TEXT PRIMARY KEY,               -- stable slug from profiles.config.json, used in the export file name
  puuid TEXT NOT NULL,
  game_name TEXT NOT NULL,
  tag_line TEXT NOT NULL,
  platform TEXT NOT NULL,            -- e.g. EUW1
  region TEXT NOT NULL,              -- match-v5 regional routing (europe for EUW)
  synced_at INTEGER NOT NULL,
  last_game_creation INTEGER         -- incremental cursor: only newer matches are fetched (D-018 pattern)
);

CREATE TABLE profile_games (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  match_id TEXT NOT NULL,            -- internal only: NEVER exported (can identify other participants)
  created_at INTEGER NOT NULL,       -- gameCreation, unix milliseconds
  champion_id INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT')),
  win INTEGER NOT NULL CHECK (win IN (0, 1)),
  ally_adc_id INTEGER,
  enemy_support_id INTEGER,
  enemy_adc_id INTEGER,
  enemy_champions_json TEXT NOT NULL,  -- enemy team champion ids (JSON array)
  keystone INTEGER,
  primary_style INTEGER,
  sub_style INTEGER,
  perks_json TEXT,                   -- full rune page + stat shards
  items_json TEXT NOT NULL,          -- final items
  items_ordered_json TEXT,           -- build order from the match timeline; NULL when no timeline was fetched
  summoner1_id INTEGER NOT NULL,     -- match-v5 spell1Id
  summoner2_id INTEGER NOT NULL,     -- match-v5 spell2Id
  PRIMARY KEY (profile_id, match_id)
);

CREATE TABLE profile_mastery (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  champion_id INTEGER NOT NULL,
  mastery_points INTEGER NOT NULL,
  mastery_level INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, champion_id)
);
