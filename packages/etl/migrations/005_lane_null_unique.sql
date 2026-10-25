-- Migration 005: unique lane keys that treat NULL opponents/partners as equal.
-- SQLite PRIMARY KEY allows duplicate NULLs (NULL != NULL). DATA_MODEL.md keeps
-- opp2_id/partner_id nullable for 1v1 lane groups; these indexes enforce one
-- row per logical key using IFNULL sentinels that never collide with champion ids.

CREATE UNIQUE INDEX idx_lane_vs_unique ON lane_vs (
  my_champion_id,
  my_role,
  opp1_id,
  IFNULL(opp2_id, -1),
  rank_bucket
);

CREATE UNIQUE INDEX idx_lane_full_unique ON lane_full (
  my_champion_id,
  my_role,
  IFNULL(partner_id, -1),
  opp1_id,
  IFNULL(opp2_id, -1),
  rank_bucket
);
