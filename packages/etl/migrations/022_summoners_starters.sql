-- BL-031a (issue #92): summoner-spell and starter-bundle aggregation.
--
-- participants gains the two summoner spell ids carried by every match-v5
-- participant payload (spell1Id/spell2Id, renamed summoner1Id/summoner2Id in
-- newer versions). Nullable: rows ingested before this migration have no
-- spell data until `pnpm etl backfill-summoners` refetches their match
-- details; aggregations skip NULL pairs.
--
-- summoner_ctx mirrors rune_ctx: per (champion, role, rank bucket, context,
-- spell pair) weighted evidence rows. The spell pair is the unordered
-- normalized "minId:maxId" key (SPECS §18.5).
--
-- starter_ctx aggregates the net starter bundles already stored per
-- (match, participant) in participant_starters (D-086 bundle half, D-134)
-- along the back-off chain exact lane -> champion -> role -> global.
-- champion_id / my_role are NULL only on 'global' rows (cross-role
-- fallback); SQLite treats NULLs as distinct in PRIMARY KEYs, so uniqueness
-- is enforced by the COALESCE expression indexes below.

ALTER TABLE participants ADD COLUMN summoner1_id INTEGER;
ALTER TABLE participants ADD COLUMN summoner2_id INTEGER;

CREATE TABLE IF NOT EXISTS summoner_ctx (
  champion_id INTEGER NOT NULL,
  my_role TEXT NOT NULL,
  rank_bucket TEXT NOT NULL,
  context_key TEXT NOT NULL,
  context_level INTEGER NOT NULL,
  spell_pair TEXT NOT NULL,          -- normalized unordered "minId:maxId"
  wins_w REAL NOT NULL,
  games_w REAL NOT NULL,
  games_w2 REAL NOT NULL,
  players INTEGER NOT NULL,          -- distinct expert players (D-102)
  PRIMARY KEY (champion_id, my_role, rank_bucket, context_key, context_level, spell_pair)
);
CREATE INDEX IF NOT EXISTS idx_summoner_ctx_champion ON summoner_ctx(champion_id, my_role);

CREATE TABLE IF NOT EXISTS starter_ctx (
  champion_id INTEGER,               -- NULL on 'role' and 'global' rows
  my_role TEXT,                      -- NULL only on 'global' rows (cross-role)
  rank_bucket TEXT NOT NULL,
  context_key TEXT NOT NULL,         -- 'lane:<slots>' | 'champion' | 'role' | 'global'
  context_level INTEGER NOT NULL,    -- 1 lane, 2 champion, 3 role, 4 global
  bundle_key TEXT NOT NULL,          -- starterBundleKey output "itemId:count,..."
  wins_w REAL NOT NULL,
  games_w REAL NOT NULL,
  games_w2 REAL NOT NULL,
  players INTEGER NOT NULL,          -- distinct expert players (D-102)
  PRIMARY KEY (champion_id, my_role, rank_bucket, context_key, context_level, bundle_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_starter_ctx_unique
  ON starter_ctx(COALESCE(champion_id, -1), COALESCE(my_role, ''), rank_bucket, context_key, context_level, bundle_key);
CREATE INDEX IF NOT EXISTS idx_starter_ctx_champion ON starter_ctx(champion_id, my_role);
