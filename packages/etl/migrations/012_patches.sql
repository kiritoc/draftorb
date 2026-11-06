-- Migration 012: patches table (D-043, SPECS §12)
-- Ordered list of game patches built from Data Dragon versions.json.
-- patch_index is assigned once, oldest-first starting at 1, append-only.
-- version_label is major.minor, identical to matches.patch; hotfixes that
-- share a major.minor label collapse to a single row.
CREATE TABLE patches (
  patch_index INTEGER PRIMARY KEY,
  version_label TEXT NOT NULL UNIQUE,
  released_at INTEGER
);
