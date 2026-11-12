-- T-051 Phase B (D-082 amendments): derived item-build context tables.
--
-- item_build gains decision_kind so path acquisitions (quest rewards, jungle
-- pet upgrades) are visible as 'path' rows distinct from purchased items
-- ('item'). Existing rows are preserved as 'item' rows. SQLite cannot ALTER a
-- PRIMARY KEY, so the table is rebuilt.
--
-- participant_starters stores the net purchased starter bundle per
-- (match, participant) for the starter window; starter_bundle_key is derived
-- at aggregation/export time, not stored.
--
-- item_state_scale stores the per-time-bucket standard deviation of
-- team_gold_diff used by time-normalized state buckets; empty until
-- `etl aggregate` recomputes it.

CREATE TABLE item_build_new (
  champion_id INTEGER NOT NULL,
  my_role TEXT NOT NULL,
  slot_idx INTEGER NOT NULL,
  time_bucket TEXT NOT NULL,
  state_bucket TEXT NOT NULL,
  profile_key TEXT NOT NULL,
  lane_key TEXT NOT NULL,
  decision_kind TEXT NOT NULL DEFAULT 'item' CHECK (decision_kind IN ('item','path')),
  item_id INTEGER NOT NULL,
  wins_w REAL NOT NULL,
  games_w REAL NOT NULL,
  games_w2 REAL NOT NULL,
  PRIMARY KEY (
    champion_id, my_role, slot_idx, time_bucket, state_bucket,
    profile_key, lane_key, decision_kind, item_id
  )
);
INSERT INTO item_build_new (
  champion_id, my_role, slot_idx, time_bucket, state_bucket,
  profile_key, lane_key, decision_kind, item_id, wins_w, games_w, games_w2
)
SELECT
  champion_id, my_role, slot_idx, time_bucket, state_bucket,
  profile_key, lane_key, 'item', item_id, wins_w, games_w, games_w2
FROM item_build;
DROP TABLE item_build;
ALTER TABLE item_build_new RENAME TO item_build;
CREATE INDEX idx_item_build_champion ON item_build(champion_id, my_role);
CREATE INDEX idx_item_build_item ON item_build(item_id);

CREATE TABLE IF NOT EXISTS participant_starters (
  match_id TEXT NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL CHECK (participant_id BETWEEN 1 AND 10),
  puuid TEXT NOT NULL,
  bundle_json TEXT NOT NULL,   -- sorted "itemId:count" pairs, e.g. ["2052:1","3364:1"]
  PRIMARY KEY (match_id, participant_id)
);

CREATE TABLE IF NOT EXISTS item_state_scale (
  patch TEXT NOT NULL,
  time_bucket TEXT NOT NULL,
  sample_count INTEGER NOT NULL,
  gold_sd REAL NOT NULL,
  PRIMARY KEY (patch, time_bucket)
);
