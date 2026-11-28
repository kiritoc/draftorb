-- Migration 023: per-game starter-window bundles for configured profiles
-- (BL-059, D-086 bundle half / D-139, DATA_MODEL.md).
-- starter_bundle_json stores the net starter bundle as a JSON array of
-- { "itemId", "count" } pairs sorted by itemId — the structured form of the
-- engine starterBundleKey "itemId:count" grouping, computed by
-- profile-sync from the same match timeline that fills items_ordered_json.
-- NULL when no timeline was fetched or the window recorded no purchases.
ALTER TABLE profile_games ADD COLUMN starter_bundle_json TEXT;
