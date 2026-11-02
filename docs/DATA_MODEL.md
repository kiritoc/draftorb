# DATA MODEL

## SQLite (local, `data/DraftOrb.sqlite`, override with `DRAFTORB_DB_PATH`, gitignored)

```sql
CREATE TABLE players (
  puuid TEXT PRIMARY KEY, platform TEXT, tier TEXT, division TEXT, lp INTEGER,
  rank_score REAL,            -- tier + division score from D-016; not an exact rank or SPECS §3 bucket
  updated_at INTEGER
);
CREATE TABLE matches (
  match_id TEXT PRIMARY KEY, platform TEXT, patch TEXT, queue_id INTEGER,
  duration INTEGER, created_at INTEGER, avg_rank_score REAL,
  rank_known_count INTEGER NOT NULL DEFAULT 0, -- known participant ranks including the seed; ingested matches are >= 1
  fetched_timeline INTEGER DEFAULT 0
);
CREATE TABLE participants (
  match_id TEXT NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
  puuid TEXT NOT NULL, team_id INTEGER NOT NULL, champion_id INTEGER NOT NULL,
  role TEXT NOT NULL,          -- TOP|JUNGLE|MID|ADC|SUPPORT; MIDDLE->MID, BOTTOM->ADC, UTILITY->SUPPORT
  win INTEGER NOT NULL CHECK (win IN (0, 1)),
  rank_score REAL, champion_games INTEGER NOT NULL DEFAULT 0, -- pure count of games on the champion in our data (D-022)
  mastery_points INTEGER,      -- champion-mastery-v4 points for THIS champion at last fetch; NULL = never fetched (at most one call per (puuid, champion) pair)
  is_expert INTEGER,          -- derived: recomputed each aggregation run from champion_games/mastery_points (D-022), not written at extraction
  keystone INTEGER, primary_style INTEGER, sub_style INTEGER,
  perks_json TEXT,            -- full rune selection + shards
  items_json TEXT,            -- final items
  kills INTEGER, deaths INTEGER, assists INTEGER,
  PRIMARY KEY (match_id, puuid)
);
CREATE TABLE item_events (    -- from timelines (epic E5)
  match_id TEXT NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
  puuid TEXT NOT NULL, ts INTEGER NOT NULL, item_id INTEGER NOT NULL, type TEXT NOT NULL,
  team_gold_diff INTEGER NOT NULL, kills_diff INTEGER NOT NULL,
  item_slot INTEGER,          -- 0 = starting purchase (before the first completed item and game time < 90 s), k >= 1 = k-th completed item, NULL for components/consumables bought later (D-022)
  PRIMARY KEY (match_id, puuid, ts, item_id, type)
);
CREATE TABLE ingest_state (key TEXT PRIMARY KEY, value TEXT);  -- cursors for resumability
CREATE TABLE match_rejects (  -- matches seen and rejected, deduped across players
  match_id TEXT PRIMARY KEY, reason TEXT NOT NULL,
  patch TEXT,                 -- actual patch of the match (reason='patch' only)
  checked_at INTEGER NOT NULL
);
CREATE INDEX idx_part_champ_role ON participants(champion_id, role);

CREATE TABLE patches (
  patch_index INTEGER PRIMARY KEY,
  version_label TEXT NOT NULL UNIQUE,   -- major.minor, matches matches.patch
  released_at INTEGER
);

CREATE TABLE entity_change_scores (
  entity_type TEXT NOT NULL CHECK (entity_type IN ('champion','item','rune')),
  entity_id INTEGER NOT NULL,
  patch_index INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  change_score REAL CHECK (change_score IS NULL OR (change_score >= 0 AND change_score <= 1)),
  details TEXT NOT NULL,               -- JSON list of {key, old, new, contribution}
  PRIMARY KEY (entity_type, entity_id, patch_index)
);

CREATE TABLE data_breakpoints (
  id INTEGER PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('champion','item','rune','global')),
  scope_id INTEGER,                    -- NULL iff scope_type = 'global'
  from_patch_index INTEGER NOT NULL CHECK (from_patch_index >= 1),
  mode TEXT NOT NULL CHECK (mode IN ('reset','downweight')),
  weight_factor REAL,                  -- NULL for reset; 0 < weight_factor <= 1 for downweight
  status TEXT NOT NULL CHECK (status IN ('suggested','active','rejected')),
  source TEXT NOT NULL CHECK (source IN ('auto','manual')),
  reason TEXT NOT NULL CHECK (length(reason) > 0),
  created_at INTEGER NOT NULL,
  CHECK ((scope_type = 'global') = (scope_id IS NULL)),
  CHECK (
    (mode = 'reset' AND weight_factor IS NULL)
    OR (mode = 'downweight' AND weight_factor IS NOT NULL AND weight_factor > 0 AND weight_factor <= 1)
  )
);
CREATE UNIQUE INDEX idx_data_breakpoints_unique ON data_breakpoints(scope_type, COALESCE(scope_id, -1), from_patch_index, source);
```

Notes: match ingestion persists the match row and its 10 participant rows in one transaction. A match is accepted only when each of two teams has exactly one participant in each role; invalid layouts are rejected and have no stored participants. `rank_score` = coarse tier/division score at collection time (approximation, documented in RIOT_API.md). Exact rank ordering uses the stored `tier`, `division`, and `lp` fields separately. The score uses the D-016 tier base and division bonus formula; it excludes LP and is distinct from the SPECS §3 weighting buckets. Store only needed fields. `match_rejects` records match ids already evaluated and rejected (wrong queue, too short, off-patch, invalid payload) so shared matches are not re-fetched per player; a `patch` reject keeps the match's actual patch so it is re-evaluated once a run's `--since-patch` window includes it (D-017). `reason` is `queue|short|patch|invalid|pruned`; `pruned` is written by `pnpm etl prune` (reason for deletion = retention, actual `patch`, `checked_at`) and is permanent: `findRejection` never deletes or re-evaluates it, whatever `--since-patch` says (D-044).

`champions.json.roles` is kept (D-034, PROPOSED). `pnpm etl derive-roles` rewrites it with the roles observed for that patch's participants (probability > 0, canonical order). Champions with no observations keep the Data Dragon tag roles, read from an untouched `champions.bootstrap.json` snapshot. Re-run `derive-roles` after `static`, because `static` restores the tag roles.

## Aggregated tables (SQLite) — recomputed on every `aggregate` run; weights baked into `wins_w`, `games_w`, `games_w2` (SPECS §14, D-045); role-generic (Phase 1 populates only `my_role = 'SUPPORT'`)

Rank buckets: every `rank_bucket` column and every exported `bucket` field uses the 8 SPECS §3 rank buckets (IRON, BRONZE, SILVER, GOLD, PLATINUM, EMERALD, DIAMOND, MASTER_PLUS), not the 10 raw rank tiers. `MANIFEST.rankBuckets` mirrors this same 8-value list.

- `role_prob(champion_id, role, games, games_w, games_w2, prob)` (weighted; `games_w` = sum of recency weights, `games_w2` = sum of squared weights for `n_eff`, SPECS §3; `games` = raw unweighted match count)
- `baseline(champion_id, my_role, rank_bucket, wins_w, games_w, games_w2, games)` (weighted; `games_w2` = sum of squared weights for `n_eff`, SPECS §3; `games` = raw unweighted match count)
- `pair_ally(my_champion_id, my_role, other_champion_id, other_role, rank_bucket, wins_w, games_w, games_w2)`
- `pair_enemy(my_champion_id, my_role, other_champion_id, other_role, rank_bucket, wins_w, games_w, games_w2)`
- `lane_vs(my_champion_id, my_role, opp1_id, opp2_id, rank_bucket, wins_w, games_w, games_w2)` (D-021; `opp*_id` = enemy lane-group champions in `laneGroup(my_role).enemies` order — SUPPORT: `[SUPPORT, ADC]`, ADC: `[ADC, SUPPORT]` — and `lane_full.partner_id` = `laneGroup(my_role).allies[0]`; the engine looks rows up in this order, so T-017 must export it; `opp2_id` NULL for 1v1 lane groups). SQLite PRIMARY KEY treats NULLs as distinct; uniqueness is enforced by the unique expression index `idx_lane_vs_unique` (migration 005) on `COALESCE(opp2_id, -1)`, so two rows with the same key and a NULL `opp2_id` conflict (-1 is never a valid champion id).
- `lane_full(my_champion_id, my_role, partner_id, opp1_id, opp2_id, rank_bucket, wins_w, games_w, games_w2)` (D-021; `partner_id` = ally lane partner, NULL for 1v1 lane groups (TOP, MID, JUNGLE)). Uniqueness is enforced by the unique expression index `idx_lane_full_unique` (migration 005) on `COALESCE(partner_id, -1)` and `COALESCE(opp2_id, -1)`, with the same NULL handling.
- `rune_ctx(champion_id, my_role, rank_bucket, context_key, context_level, perks_hash, perks_json, wins_w, games_w, games_w2, players)` (`context_key` = D-021 back-off level, SPECS §8.1; `context_level` = back-off hierarchy: lane contexts increment as slots drop (3-slot=1, 2-slot=2, 1-slot=3), damage mix=4, global=5; `rank_bucket` = user rank bucket, weighted by `expertWeight` (games below the bucket excluded, above boosted up to `wMax`, migration 011); experts = in-window `champion_games >= minChampGames` or `mastery_points >= minMasteryPoints`)
- `item_build(champion_id, my_role, slot_idx, time_bucket, state_bucket, profile_key, lane_key, item_id, wins_w, games_w, games_w2)` (D-022; `slot_idx` = `item_events.item_slot`, 0 = starting items; `lane_key` empty outside the `lane` phase)

Adding a role means data only: no schema or code change. Migration 004 (T-011.b) creates these tables.

## Exported JSON (`data/public/<patch>/`) — role-keyed from day one

Validated by one zod schema family parameterized by role (`packages/shared`, T-002.b). The role is carried by the file path, not by a column in the rows (the SQLite tables keep `my_role`). The web app loads only the roles listed in `manifest.json`. Keep each file < 5 MB gzip.

```
manifest.json          // { patch, generatedAt, region, rankBuckets: [the 8 §3 buckets, not 10 tiers], roles: ["SUPPORT"], files[], schemaVersion }
champions.json         // id, name, icon, roles
items.json             // item catalog (from Data Dragon)
runes.json             // rune tree catalog (from Data Dragon)
role-prob.json         // Global across roles, independent of manifest.roles: { [championId]: { SUPPORT: 0.92, ... } }. Sparse roles with games only; absent roles are 0. Probabilities sum to 1 (tolerance 1e-6). Gated-in rows use stored `role_prob.prob` and are renormalized per champion; an unknown exported role fails the export with a role-prob.json error.
roles/<ROLE>/baseline.json    // [championId, bucket, wins_w, games_w, games_w2, games] (games = raw match count)
roles/<ROLE>/ally-pairs.json  // [championId, allyId, otherRole, bucket, wins_w, games_w, games_w2]
roles/<ROLE>/enemy-pairs.json // [championId, enemyId, otherRole, bucket, wins_w, games_w, games_w2]
roles/<ROLE>/lane-vs.json     // [championId, opp1Id, opp2Id, bucket, wins_w, games_w, games_w2]
roles/<ROLE>/lane-full.json   // [championId, partnerId, opp1Id, opp2Id, bucket, wins_w, games_w, games_w2]
roles/<ROLE>/runes/<championId>.json  // contexts (rankBucket, contextKey, contextLevel) -> top pages
roles/<ROLE>/builds/<championId>.json // item build stats
```

Every exported row carries `games_w2` so the engine can compute `n_eff` (SPECS §3). Rows, including rune global-context rows, are exported only when `n_eff >= exportMinGames` (default 10), and `exportMinGames <= minGames`. Rune and build `pickShare` values use each context's raw `games_w` total before this gate and are rounded once. Size budget: `lane-*` and `*-pairs` files are the largest; size is `zlib.gzipSync(content).length` vs `MAX_FILE_BYTES` (5 MB gzip); oversize files are returned in `ExportResult.warnings`.

Pair tuple roles are the paired champion's `other_role`, not the row owner's `my_role`. Rune contexts remain separate by `rank_bucket`; each exported context includes that bucket so rank-weighted rune statistics are not combined. Manifest schema version 3 adds `rankBucket` to rune contexts.

When present, `champions.json`, `items.json`, and `runes.json` are retained in the export and included in `manifest.files` with hashes; missing catalogs produce a warning. The `champions.bootstrap.json` and `champions.derived.json` role-derivation snapshots are preserved across exports but are internal state and are not listed in the manifest. The `static` and `derive-roles` commands invalidate an existing manifest before changing catalog data; run `export` afterward to publish fresh catalog hashes.

The exporter builds in a unique dot-prefixed temp directory, renames any previous patch directory to a dot-prefixed backup, then renames the new directory into place; if publish fails it attempts to restore the previous directory. A failure to remove the superseded backup after a successful publish is returned as a warning (the backup is left for stale cleanup), not as an export failure. It only removes matching temp/backup directories older than 24 hours, and preserves backups while the patch directory is missing. Temporary and backup directories under `data/public` are internal and must not be served as static assets. Builds with no context passing the gate produce no file. Rounded role probabilities assign the residual to the last surviving role and `role-prob.json` is validated against `championRoleProbabilitiesSchema` before writing. Aggregate tables are not patch- or platform-scoped: exporting a patch other than the latest in the database warns, and a multi-platform database always warns (even with `--region`) that aggregates combine all platforms.

Manual files (committed, hand-written, zod-validated): `data/manual/champion-tags.json`, `data/manual/item-tags.json`, `data/manual/gameplans/*.md`.

`schemaVersion` is bumped once for this role-keyed layout, and again whenever a JSON format changes; the web app checks it and shows a clear error on mismatch. The exporter warns if an explicit patch differs from the latest stored patch or if data spans multiple platforms; `region` labels the manifest and does not filter aggregate data.

Core scoring and engine contracts are unchanged (SPECS §14, D-045). The exported JSON format changes described above do not alter `n_eff` thresholds or D-021..D-027 semantics.

## Browser storage (apps/web, not exported, D-024)

| Key                | Content                                                       | Notes                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `draftorb.pool.v1` | `{ "version": 1, "pools": { "SUPPORT": [championId, ...] } }` | Per-role champion pool. Unique ids, at most `poolMaxSize` (default 40) per role. Validated with the shared zod `championPoolSchema` (T-002.b) on every read and on import. |

Every storage access is wrapped in try/catch; unavailable, full or corrupted storage means an empty in-memory pool plus a visible notice. Ids not present in the current `champions.json` are dropped on load. Bumping the key suffix (`v2`) requires a migration function; never reuse a key with a different shape.
