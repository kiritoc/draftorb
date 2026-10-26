-- Migration 005: unique indexes for nullable lane keys
-- Prevents duplicate rows when opp2_id or partner_id is NULL in lane tables.
-- These are derived aggregate tables; duplicates can occur if the same
-- (champion, role, rank_bucket) combination appears with a NULL opponent/partner.

CREATE UNIQUE INDEX IF NOT EXISTS idx_lane_vs_unique ON lane_vs(
  my_champion_id,
  my_role,
  opp1_id,
  COALESCE(opp2_id, -1),
  rank_bucket
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lane_full_unique ON lane_full(
  my_champion_id,
  my_role,
  COALESCE(partner_id, -1),
  opp1_id,
  COALESCE(opp2_id, -1),
  rank_bucket
);
