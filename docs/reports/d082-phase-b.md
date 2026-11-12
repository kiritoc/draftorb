# D-082 Phase B implementation report

Branch: `feat/d082-item-contexts-fix`. Scope: first prompt's Phase B
(taxonomy, raw events, starter bundles, state scale, lane hierarchy,
backfill). Prompt-2 work NOT started.

## What changed

- Migrations `017_raw_timeline_events.sql`, `018_item_build_phase_b.sql`:
  item_events rebuilt as raw events (participant_id, seq, event_type,
  before/after_id); new kill_events, match_participant_ids,
  extractor_runs, participant_starters, item_state_scale; item_build gains
  decision_kind ('item'|'path'), existing rows preserved as 'item'.
  Verified on a copy of the real DB (`/tmp/dorb-test.sqlite`): 18
  migrations applied cleanly.
- `timeline-events.ts` / `timeline-extractors.ts` / `timeline.ts`:
  registry-based extraction; `etl timeline` + `etl backfill-timelines
[--limit] [--call-budget]`; per-(match,extractor) resumability;
  participantId-0 purchases attributed to supports.
- `item-classes.ts` + `classify-items` command +
  `data/item-classes.generated.json` (859 items, patch 16.22) +
  `data/manual/item-classes.json` override slot.
- `aggregate-items.ts` rewritten: net replay (undo/sold/destroyed),
  class-driven slots (completed from 1, starters slot 0, path rows),
  participant_starters, item_state_scale, at-purchase threat profile
  ('unknown' without kill_events), stateBucket timeNormalized default.
- Engine `item-context.ts`/`config.ts`: netPurchasedItems, ownedItemsAt,
  starterBundleKey, laneArchKey, stateBucket(mode), starterWindowSeconds
  45, stateZAhead 1, minStateMatches 30.
- Old `item-events.ts` removed (superseded).

## Tests

104 files / 1186 tests pass; lint 0 errors; typecheck+format green.
New/updated: timeline.test.ts (registry, resume, budget, pid-0),
aggregate-items.test.ts (path rows, netting, starters, idempotency),
item-context.test.ts (helpers), migrate.test.ts/prune.test.ts (new
schema).

## Numbers (real data, state release 20261111T2325Z)

DB pulled via `pnpm etl pull --db` (24,325 euw1 matches). Backfilled the
300 newest matches: 157,043 raw events (68,837 purchase / 2,665 sold /
2,142 undo / 65,325 destroyed — destroyed is mostly consumable/quest-item
consumption plus granted internals), 0 failures.

`pnpm etl aggregate` -> item_build: 2,718 rows / 108 champions.

- decision_kind: 2,660 item / 58 path (jungle pets + support quest
  rewards only ever appear as path rows; slot-0/item slots stay clean).
- state_bucket: ahead 921 / behind 630 / even 1167 (was severely
  time-biased under fixed ±2000g/±3k thresholds).
- profile_key: AD 316 / AP 2276 / mixed 126; no 'unknown' rows because
  kill_events exist for all 300 matches.
- item_state_scale (16.22): gold-diff sd grows 565 (0-5min) -> ~4,900
  (40-45min), confirming the time bias the normalization fixes.
- participant_starters: 2,996 rows (~10/match, all participants); top
  bundles are Doran+potions+refiller and Atlas support lines as expected.
- Bug found by real run: pendingMatches bound platform before extractor
  placeholders (0 candidates); fixed. Starter bundles initially covered
  experts only; now all participants.

## ADRs (all PROPOSED)

- D-083 taxonomy/path decisions (D-082 .1 amended, .2/.5/.7 kept)
- D-084 raw events + at-purchase threat (D-082 .3 superseded)
- D-085 time-normalized state buckets + scale (D-082 .4 superseded)
- D-086 starter bundles + lane archetype (D-082 .6 amended)
- D-087 rank dimension deferred after measurement rationale

## D1-D7 verdicts

- D1 quest rewards invisible/polluting: FIXED via quest_line/quest_reward
  classes + path rows.
- D2 Lane tag / jungle pets: FIXED via generated taxonomy (pets ->
  jungle_path).
- D3 final-state leakage: FIXED via kill_events + ownedItemsAt at ts.
- D4 fixed state thresholds: FIXED via item_state_scale z-buckets.
- D5 sparse lane keys: PARTIAL — laneArchKey helper exists; export-level
  archetype backoff not yet wired (Prompt-2 export work).
- D6 sparsity: unchanged structurally; path rows add signal; rank
  dimension deferred (D-087).
- D7 starter bundles/undo semantics: FIXED via participant_starters +
  net replay.

## Risks / unverified

- pid-0 attribution assumes SUPPORT role and one Atlas per support;
  verified on audit sample only.
- Kill assists are not expanded from assist_mask into KDA assists
  (killer kills + victim deaths only) — documented approximation.
- item-classes.generated.json is patch-16.22; older patches reuse it.
- 1104-classified 'excluded' pets and similar edge items need owner
  review of overrides.
- Export sections DONE: `item-classes.json` (859 items) and
  `state-scale.json` (10 buckets) exported; MANIFEST_SCHEMA_VERSION 3->4;
  shared zod schemas added; `profileKey` enum gains 'unknown'; lane
  contexts carry `laneArch`; path rows export to `build-paths/`.
  Verified: real export = 66 files, public tarball ~1.5 MB gz.
  builds/*.json absent because max games_w=6 < exportMinGames=10 with
  only 300 matches backfilled (honest sparsity).

## Owner questions

1. Accept pid-0 -> first eligible SUPPORT attribution rule?
2. starterWindowSeconds = 45 s (audit suggestion) OK?
3. Should assists be reconstructed from assist_mask for threat KDA?
4. Where should item-classes live long-term (tracked data/ vs public)?
