-- Migration 014: drop patches.released_at (D-055)
-- Nothing populates released_at (versions.json carries no release dates and
-- none are invented), so the permanently empty column is removed. The table
-- is rebuilt; patch_index/version_label rows are preserved.
CREATE TABLE patches_new (
  patch_index INTEGER PRIMARY KEY,
  version_label TEXT NOT NULL UNIQUE
);

INSERT INTO patches_new (patch_index, version_label)
SELECT patch_index, version_label FROM patches;

DROP TABLE patches;
ALTER TABLE patches_new RENAME TO patches;
