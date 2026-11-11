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
  is_expert INTEGER,          -- column exists but is never written; expert status is computed on the fly during rune aggregation (D-022, aggregate-runes.ts)
  keystone INTEGER, primary_style INTEGER, sub_style INTEGER,
  perks_json TEXT,            -- full rune selection + shards
  items_json TEXT,            -- final items
  kills INTEGER, deaths INTEGER, assists INTEGER,
  PRIMARY KEY (match_id, puuid)
);
CREATE TABLE item_events (    -- from timelines (epic E5)
  match_id TEXT NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
  puuid TEXT NOT NULL, ts INTEGER NOT NULL, item_id INTEGER NOT NULL, type TEXT NOT NULL,  -- ts = raw timeline ms; type = 'purchase' | 'sold'
  team_gold_diff INTEGER NOT NULL, kills_diff INTEGER NOT NULL,   -- purchaser team minus enemy team at ts
  item_slot INTEGER,          -- 0 = starting purchase (before the first completed item and game time < 90 s), k >= 1 = k-th completed item, NULL for components/consumables bought later (D-022, D-082)
  PRIMARY KEY (match_id, puuid, ts, item_id, type)
);
CREATE TABLE ingest_state (key TEXT PRIMARY KEY, value TEXT);  -- cursors for resumability
CREATE TABLE match_rejects (  -- matches seen and rejected, deduped across players
  match_id TEXT PRIMARY KEY,
  reason TEXT NOT NULL CHECK (reason IN ('queue','short','patch','invalid','pruned')),
  patch TEXT,                 -- actual major.minor label (reason='patch'; also set for 'invalid' rejects caused by an unknown patch label, and 'pruned' tombstones)
  checked_at INTEGER NOT NULL
);
CREATE INDEX idx_part_champ_role ON participants(champion_id, role);

-- Migration 012 (T-019.b, D-043) created the ordered patch catalog;
-- migration 014 (D-055) dropped released_at (nothing populated it).
-- matches.patch stays a TEXT label resolved to patch_index through this
-- table; no patch_index column on matches.
CREATE TABLE patches (
  patch_index INTEGER PRIMARY KEY,   -- gap-free from 1, numeric (major, minor) order, append-only (D-055)
  version_label TEXT NOT NULL UNIQUE   -- major.minor, identical to matches.patch
);

-- Migration 016 (T-019.e, D-046/D-047) created this table; rows are written
-- by the `changes` command (T-019.d, not implemented yet).
CREATE TABLE entity_change_scores (
  entity_type TEXT NOT NULL CHECK (entity_type IN ('champion','item','rune')),
  entity_id INTEGER NOT NULL,
  patch_index INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  change_score REAL CHECK (change_score IS NULL OR (change_score >= 0 AND change_score <= 1)),
  details TEXT NOT NULL,               -- JSON list of {key, old, new, contribution}
  PRIMARY KEY (entity_type, entity_id, patch_index)
);

-- Migration 016 (T-019.e, D-047) created this table; managed by the
-- `breakpoint` command (manual rows) and by T-019.d (auto suggestions).
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

-- PLANNED (T-091, D-068/D-069): match history of each configured profile
-- (data/profiles.config.json). Only configured profiles are ever synced.
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
  created_at INTEGER NOT NULL,       -- gameCreation, unix seconds
  champion_id INTEGER NOT NULL,
  role TEXT NOT NULL,                -- same role mapping as participants.role
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
```

Notes: match ingestion persists the match row and its 10 participant rows in one transaction. A match is accepted only when each of two teams has exactly one participant in each role; invalid layouts are rejected and have no stored participants. `rank_score` = coarse tier/division score at collection time (approximation, documented in RIOT_API.md). Exact rank ordering uses the stored `tier`, `division`, and `lp` fields separately. The score uses the D-016 tier base and division bonus formula; it excludes LP and is distinct from the SPECS §3 weighting buckets. Store only needed fields. `match_rejects` records match ids already evaluated and rejected (wrong queue, too short, off-patch window, invalid payload, unknown patch label) so shared matches are not re-fetched per player; a `patch` reject keeps the match's actual patch label and is deleted and re-evaluated once a run's `--since-patch` window (compared on `patch_index`, D-043) includes it (D-017). An `invalid` reject caused by a patch label absent from `patches` also stores that label in `patch` for diagnosis. `reason` is `queue|short|patch|invalid|pruned` (D-044): `pruned` is written by `pnpm etl prune` (reason for deletion = retention, actual `patch`, `checked_at`) and is permanent: `findRejection` never deletes or re-evaluates it, whatever `--since-patch` says. `--reset` clears every reason except `pruned`; only `--reset-tombstones` clears `pruned`, after which pruned matches become fetchable again.

Patch catalog rules (D-055): `patch_index` is gap-free from 1, ordered NUMERICALLY by (major, minor) — never string order — and append-only; `refreshPatches` refuses to insert a label that does not sort after the newest stored one or to touch a non gap-free/misordered table. Read commands (`aggregate`, `derive-roles`) fetch `versions.json` at most once per run and only when the explicit snapshot or a stored label is missing from `patches`; stored labels still unresolved afterwards are orphans — excluded from aggregates and reported by count and label, never silently. `pnpm etl aggregate` also records `{ patch, patchIndex, currentPatchIndex, patchesMaxIndex, aggregatedAt }` in `ingest_state` under key `aggregate:snapshot` (only when at least one aggregate table was rewritten); `export` publishes it verbatim as `patch-meta.json`.

`champions.json.roles` is kept (D-034). `pnpm etl derive-roles` rewrites it with the roles observed for that patch's participants (probability >= `roleProbThreshold` (default 0.05), canonical order). Champions with no observations keep the Data Dragon tag roles, read from an untouched `champions.bootstrap.json` snapshot. Re-run `derive-roles` after `static`, because `static` restores the tag roles.

## Aggregated tables (SQLite) — recomputed on every `aggregate` run; weights baked into `wins_w`, `games_w`, `games_w2` (SPECS §14, D-045); role-generic (Phase 1 populates only `my_role = 'SUPPORT'`)

Rank buckets: every `rank_bucket` column and every exported `bucket` field uses the 8 SPECS §3 rank buckets (IRON, BRONZE, SILVER, GOLD, PLATINUM, EMERALD, DIAMOND, MASTER_PLUS), not the 10 raw rank tiers. `MANIFEST.rankBuckets` mirrors this same 8-value list.

- `role_prob(champion_id, role, games, games_w, games_w2, prob)` (weighted; `games_w` = sum of recency weights, `games_w2` = sum of squared weights for `n_eff`, SPECS §3; `games` = raw unweighted match count)
- `baseline(champion_id, my_role, rank_bucket, wins_w, games_w, games_w2, games)` (weighted; `games_w2` = sum of squared weights for `n_eff`, SPECS §3; `games` = raw unweighted match count)
- `pair_ally(my_champion_id, my_role, other_champion_id, other_role, rank_bucket, wins_w, games_w, games_w2)`
- `pair_enemy(my_champion_id, my_role, other_champion_id, other_role, rank_bucket, wins_w, games_w, games_w2)`
- `lane_vs(my_champion_id, my_role, opp1_id, opp2_id, rank_bucket, wins_w, games_w, games_w2)` (D-021; `opp*_id` = enemy lane-group champions in `laneGroup(my_role).enemies` order — SUPPORT: `[SUPPORT, ADC]`, ADC: `[ADC, SUPPORT]` — and `lane_full.partner_id` = `laneGroup(my_role).allies[0]`; the engine looks rows up in this order, so T-017 must export it; `opp2_id` NULL for 1v1 lane groups). SQLite PRIMARY KEY treats NULLs as distinct; uniqueness is enforced by the unique expression index `idx_lane_vs_unique` (migration 005) on `COALESCE(opp2_id, -1)`, so two rows with the same key and a NULL `opp2_id` conflict (-1 is never a valid champion id).
- `lane_full(my_champion_id, my_role, partner_id, opp1_id, opp2_id, rank_bucket, wins_w, games_w, games_w2)` (D-021; `partner_id` = ally lane partner, NULL for 1v1 lane groups (TOP, MID, JUNGLE)). Uniqueness is enforced by the unique expression index `idx_lane_full_unique` (migration 005) on `COALESCE(partner_id, -1)` and `COALESCE(opp2_id, -1)`, with the same NULL handling.
- `rune_ctx(champion_id, my_role, rank_bucket, context_key, context_level, perks_hash, perks_json, wins_w, games_w, games_w2, players)` (`context_key` = D-021 back-off level, SPECS §8.1; `context_level` = back-off hierarchy: lane contexts increment as slots drop (3-slot=1, 2-slot=2, 1-slot=3), damage mix=4, global=5; `rank_bucket` = user rank bucket, weighted by `expertWeight` (games below the bucket excluded, above boosted up to `wMax`, migration 011); experts = in-window `champion_games >= minChampGames` or `mastery_points >= minMasteryPoints`)
- `item_build(champion_id, my_role, slot_idx, time_bucket, state_bucket, profile_key, lane_key, item_id, wins_w, games_w, games_w2)` (D-022; `slot_idx` = `item_events.item_slot`, 0 = starting items; `time_bucket` = 5-min purchase bucket `"<start>-<end>"` minutes; `state_bucket` = `ahead|even|behind` from the per-purchase team gold/kill diff (`ItemContextConfig` thresholds, D-082); `profile_key` = threat-weighted enemy damage mix `AD|AP|mixed`; `lane_key` = `lane:` + influence-sorted lane-context slots joined by `|`, empty string outside the `lane` phase — `''` maps to an absent `laneKey` in exports)

Adding a role means data only: no schema or code change. Migration 004 (T-011.b) creates these tables.

## Exported JSON (`data/public/<patch>/`) — role-keyed from day one

Validated by one zod schema family parameterized by role (`packages/shared`, T-002.b). The role is carried by the file path, not by a column in the rows (the SQLite tables keep `my_role`). The web app loads only the roles listed in `manifest.json`. Keep each file < 5 MB gzip.

```
manifest.json          // { patch, generatedAt, region, rankBuckets: [the 8 §3 buckets, not 10 tiers], roles: ["SUPPORT"], files[], schemaVersion }
champions.json         // id, name, icon, roles
items.json             // item catalog (from Data Dragon)
runes.json             // rune tree catalog (from Data Dragon)
role-prob.json         // Global across roles, independent of manifest.roles: { [championId]: { SUPPORT: 0.92, ... } }. Sparse roles with games only; absent roles are 0. Probabilities sum to 1 (tolerance 1e-6). Gated-in rows use stored `role_prob.prob` and are renormalized per champion; an unknown exported role fails the export with a role-prob.json error.
pick-rate.json         // Global across roles, independent of manifest.roles (B-026, D-052): { [role]: { [championId]: share } }, share of that role's picks. Computed from `role_prob.games_w` per (champion, role), gated per cell by `n_eff >= exportMinGames`, renormalized per role to sum 1 (tolerance 1e-6, largest share absorbs the residual). Optional for consumers: exports without it keep the roleProb approximation in `blindSafety`.
roles/<ROLE>/baseline.json    // [championId, bucket, wins_w, games_w, games_w2, games] (games = raw match count)
roles/<ROLE>/ally-pairs.json  // [championId, allyId, otherRole, bucket, wins_w, games_w, games_w2]
roles/<ROLE>/enemy-pairs.json // [championId, enemyId, otherRole, bucket, wins_w, games_w, games_w2]
roles/<ROLE>/lane-vs.json     // [championId, opp1Id, opp2Id, bucket, wins_w, games_w, games_w2]
roles/<ROLE>/lane-full.json   // [championId, partnerId, opp1Id, opp2Id, bucket, wins_w, games_w, games_w2]
roles/<ROLE>/runes/<championId>.json  // contexts (rankBucket, contextKey, contextLevel) -> top pages
roles/<ROLE>/builds/<championId>.json // item build stats
patch-meta.json          // patch-catalog state of the last aggregate run (D-055): { patch, patchIndex, currentPatchIndex, patchesMaxIndex, aggregatedAt }; absent until `aggregate` records it
```

Every exported row carries `games_w2` so the engine can compute `n_eff` (SPECS §3). Rows, including rune global-context rows, are exported only when `n_eff >= exportMinGames` (default 10), and `exportMinGames <= minGames`. Rune and build `pickShare` values use each context's raw `games_w` total before this gate and are rounded once. Size budget: `lane-*` and `*-pairs` files are the largest; size is `zlib.gzipSync(content).length` vs `MAX_FILE_BYTES` (5 MB gzip); oversize files are returned in `ExportResult.warnings`.

Pair tuple roles are the paired champion's `other_role`, not the row owner's `my_role`. Rune contexts remain separate by `rank_bucket`; each exported context includes that bucket so rank-weighted rune statistics are not combined. Manifest schema version 3 adds `rankBucket` to rune contexts.

When present, `champions.json`, `items.json`, and `runes.json` are retained in the export and included in `manifest.files` with hashes; missing catalogs produce a warning. The `champions.bootstrap.json` and `champions.derived.json` role-derivation snapshots are preserved across exports but are internal state and are not listed in the manifest. The `static` and `derive-roles` commands invalidate an existing manifest before changing catalog data; run `export` afterward to publish fresh catalog hashes.

The exporter builds in a unique dot-prefixed temp directory, renames any previous patch directory to a dot-prefixed backup, then renames the new directory into place; if publish fails it attempts to restore the previous directory. A failure to remove the superseded backup after a successful publish is returned as a warning (the backup is left for stale cleanup), not as an export failure. It only removes matching temp/backup directories older than 24 hours, and preserves backups while the patch directory is missing. Temporary and backup directories under `data/public` are internal and must not be served as static assets. Builds with no context passing the gate produce no file. Rounded role probabilities assign the residual to the largest surviving role and `role-prob.json` is validated against `championRoleProbabilitiesSchema` before writing. Aggregate tables are not patch- or platform-scoped: exporting a patch other than the latest in the database warns, and a multi-platform database always warns (even with `--region`) that aggregates combine all platforms.

Manual files (committed, hand-written, zod-validated): `data/manual/champion-tags.json`, `data/manual/item-tags.json`, `data/manual/gameplans/*.md`.

`schemaVersion` is bumped once for this role-keyed layout, and again whenever a JSON format changes; the web app checks it and shows a clear error on mismatch. The exporter warns if an explicit patch differs from the latest stored patch or if data spans multiple platforms; `region` labels the manifest and does not filter aggregate data.

Core scoring and engine contracts are unchanged (SPECS §14, D-045). The exported JSON format changes described above do not alter `n_eff` thresholds or D-021..D-027 semantics.

## Configured profiles (T-090/T-091, D-068/D-069)

Profiles are declared in the committed `data/profiles.config.json` (no secrets):

```json
{
  "schemaVersion": 1,
  "profiles": [
    {
      "id": "kiritoctoc-euw1",
      "riotId": { "gameName": "KiriToc", "tagLine": "Toc" },
      "platform": "EUW1",
      "label": "KiriToc's picks",
      "options": {}
    }
  ]
}
```

Only configured profiles are ever synced (visitors cannot add any; adding another person's profile requires their consent). Synced by `pnpm etl profile-sync` (locally or inside `etl.yml`, D-070); stored in `profiles`/`profile_games`/`profile_mastery` above and exported as anonymized JSON under `data/public/profiles/`. `data/public` is gitignored and local-only (D-079): exports are packed into the `public-exports.tar.gz` asset of the newest `state-*` release in the private state repo (D-078) and reach the app via `pnpm etl pull`.

### Exported JSON (`data/public/profiles/`)

```
profiles/index.json                  // { schemaVersion, profiles: [{ id, riotId, platform, label, syncedAt, gameCount, file }] }
profiles/<id>.json                   // one file per configured profile
```

`profiles/<id>.json` example (anonymized — D-069):

```json
{
  "schemaVersion": 1,
  "id": "kiritoctoc-euw1",
  "riotId": { "gameName": "KiriToc", "tagLine": "Toc", "platform": "EUW1" },
  "label": "KiriToc's picks",
  "syncedAt": 1730000000,
  "gameCount": 412,
  "favorites": {
    "combined": [23, 143],
    "recency": [23, 143],
    "mastery": [999]
  },
  "games": [
    {
      "createdAtDay": 19877,
      "championId": 23,
      "role": "SUPPORT",
      "win": true,
      "allyAdcId": 67,
      "enemySupportId": 143,
      "enemyAdcId": 202,
      "enemyChampionIds": [143, 202, 35, 121, 7],
      "runes": {
        "keystoneId": 8112,
        "primaryStyleId": 7200,
        "subStyleId": 7300,
        "perkIds": [9111, 9104, 8005],
        "statShardIds": [5008, 5008, 5007]
      },
      "items": [2055, 3865],
      "itemsOrdered": [3858, 2055, 3865],
      "summonerSpells": [4, 7]
    }
  ],
  "mastery": [{ "championId": 23, "points": 152345, "level": 7 }]
}
```

Anonymization rules (D-069, enforced by the exporter and covered by tests): export ONLY champion ids, role, ally ADC and enemy ADC/support champion ids, enemy team champion ids, rune page ids, summoner spell ids, item ids in build order, win/loss and the game day (`createdAtDay` = unix days). NEVER export other players' names, Riot IDs or puuids, and no match ids. The profile owner's own Riot ID appears only in the `riotId`/`label` block — the owner's explicit, documented choice.

Caps: at most the last 180 days and at most `profileMaxGames` (default 500, ETL config) games per profile; `favorites` and all statistics are computed over the exported set. All files are validated by shared zod schemas before writing; the web app validates again on load. `favorites` follows D-074 (top 15 by recency-weighted Support games in the last 90 days union top 5 by mastery). `itemsOrdered` is `null` when the match timeline was not fetched.

Personalized entries produced by `personalize` (engine output, not stored) may carry an optional baseline win rate and rank bucket used by the badge delta (D-080) — additive optional fields; whether they bump the result schema version is decided by the implementing ticket, as in D-054.

## Browser storage (apps/web, not exported, D-024)

| Key                | Content                                                       | Notes                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `draftorb.pool.v1` | `{ "version": 1, "pools": { "SUPPORT": [championId, ...] } }` | Per-role champion pool. Unique ids, at most `poolMaxSize` (default 40) per role. Validated with the shared zod `championPoolSchema` (T-002.b) on every read and on import. |

Every storage access is wrapped in try/catch; unavailable, full or corrupted storage means an empty in-memory pool plus a visible notice. Ids not present in the current `champions.json` are dropped on load. Bumping the key suffix (`v2`) requires a migration function; never reuse a key with a different shape.
