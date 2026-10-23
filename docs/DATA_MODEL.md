# DATA MODEL

## SQLite (local, `data/DraftOrb.sqlite`, gitignored)
```sql
CREATE TABLE players (
  puuid TEXT PRIMARY KEY, platform TEXT, tier TEXT, division TEXT, lp INTEGER,
  rank_score REAL,            -- tier + division score from D-016; not an exact rank or SPECS §3 bucket
  updated_at INTEGER
);
CREATE TABLE matches (
  match_id TEXT PRIMARY KEY, platform TEXT, patch TEXT, queue_id INTEGER,
  duration INTEGER, created_at INTEGER, avg_rank_score REAL, fetched_timeline INTEGER DEFAULT 0
);
CREATE TABLE participants (
  match_id TEXT, puuid TEXT, team_id INTEGER, champion_id INTEGER,
  role TEXT,                  -- TOP|JUNGLE|MID|ADC|SUPPORT (from teamPosition)
  win INTEGER, rank_score REAL, champion_games INTEGER,
  keystone INTEGER, primary_style INTEGER, sub_style INTEGER,
  perks_json TEXT,            -- full rune selection + shards
  items_json TEXT,            -- final items
  kills INTEGER, deaths INTEGER, assists INTEGER,
  PRIMARY KEY (match_id, puuid)
);
CREATE TABLE item_events (    -- from timelines (epic E5)
  match_id TEXT, puuid TEXT, ts INTEGER, item_id INTEGER, type TEXT,
  team_gold_diff INTEGER, kills_diff INTEGER
);
CREATE TABLE ingest_state (key TEXT PRIMARY KEY, value TEXT);  -- cursors for resumability
CREATE INDEX idx_part_champ_role ON participants(champion_id, role);
```
Notes: `rank_score` = coarse tier/division score at collection time (approximation, documented in RIOT_API.md). Exact rank ordering uses the stored `tier`, `division`, and `lp` fields separately. The score uses the D-016 tier base and division bonus formula; it excludes LP and is distinct from the SPECS §3 weighting buckets. Store only needed fields.

## Aggregated tables (SQLite) — recomputed per patch
- `role_prob(champion_id, role, games, prob)`
- `baseline(champion_id, role, rank_bucket, wins_w, games_w)` (weighted)
- `pair_ally(support_id, ally_id, ally_role, rank_bucket, wins_w, games_w)`
- `pair_enemy(support_id, enemy_id, enemy_role, rank_bucket, wins_w, games_w)`
- `rune_ctx(champion_id, context_key, perks_hash, perks_json, wins_w, games_w, players)`
- `item_build(champion_id, context_key, item_id, order_idx, wins_w, games_w)`

## Exported JSON (`data/public/<patch>/`)
Validated by zod schemas in `packages/shared`. Keep each file < 5 MB gzip.
| File | Content |
|---|---|
| `manifest.json` | `{ patch, generatedAt, region, rankBuckets, files[], schemaVersion }` |
| `champions.json` | id, name, icon, roles |
| `role-prob.json` | `{ [championId]: { SUPPORT: 0.92, ... } }` |
| `support-baseline.json` | per support + bucket: wins_w, games_w |
| `support-ally-pairs.json` | compact arrays `[supportId, allyId, role, bucket, wins_w, games_w]` |
| `support-enemy-pairs.json` | same layout |
| `runes/<championId>.json` | contexts -> top pages |
| `items.json` | item catalog (from Data Dragon) |
| `builds/<championId>.json` | item build stats |

Manual files (committed, hand-written, zod-validated): `data/manual/champion-tags.json`, `data/manual/item-tags.json`, `data/manual/gameplans/*.md`.

`schemaVersion` must be bumped when a JSON format changes; the web app checks it and shows a clear error on mismatch.
