# PROGRESS

## Current status

- Phase: 1 (Support / Diamond)
- Current milestone: M3 Web MVP implementation complete (T-030..T-035 DONE). All REVIEW tickets accepted DONE on 2026-11-11: T-019.b (patch index, incl. D-055), T-019.c (retention prune), T-019.e (breakpoints/change-scores DDL + CLI), T-026 (golden suite, 23 scenarios), T-027.a (draft backtest — report still `unvalidated` until the D-023 paired-bootstrap gate is implemented), T-040 (engine rune recommender, D-059), T-041 (runes UI), T-052 (GameState), T-053 (threat score), T-106/T-108/T-111 (state-release migration). T-019.d..f and T-027.b remain TODO. T-097 engine half DONE (`recommendProfileRunes`/`recommendProfileSpells`); its UI half is now unblocked (T-040/T-041 DONE — `RunesPanel` exists). T-098 stays TODO (T-054/T-056 missing). Decisions D-052..D-080 are ACCEPTED as of 2026-11-08 (D-061..D-066 SUPERSEDED by D-067..D-077; parts of D-057/D-067/D-069/D-070/D-073 superseded by D-076..D-080); earlier per-user plan cancelled (T-080..T-086 CANCELLED). Docs updated 2026-11-08 for the accepted decisions. Migration to the private state repo + local-only app merged on `main` (PR #53, T-106..T-112 done; T-113 proposal-only; T-099..T-105 remain owner actions). `feat/game-state-threat-score` (PR #54: T-052, T-019.e, T-053, T-041) and `fix/state-tag-seconds` (PR #55) also merged; all merged tickets accepted DONE by the owner on 2026-11-11.
- Last updated: 2026-11-12 by Devin (Prompt-2 model upgrade: Phase 0 audit + Phase 1 engine flags on `feat/joint-model-and-items-engine`, draft PR #60)

## Epic status

| Epic               | Status      | Notes                                                                                                                                                                                                                                                     |
| ------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E0 Foundations     | IN PROGRESS | T-001..T-005 DONE; T-002.b DONE                                                                                                                                                                                                                           |
| E1 ETL             | IN PROGRESS | T-010..T-013, T-011.b, T-011.c, T-013.b, T-013.c, T-013.d, T-013.e, T-014, T-015, T-015.b, T-016, T-017, T-018, T-019, T-019.b, T-019.c, T-019.e DONE; T-019.d, T-019.f TODO                                                                              |
| E2 Engine          | IN PROGRESS | T-020..T-025, T-026, T-027.a DONE; T-027.b TODO                                                                                                                                                                                                           |
| E3 Web MVP         | DONE        | T-030..T-035 complete; recommendation flow, Support pool, regression coverage, deploy assets and visible unvalidated-model state                                                                                                                          |
| E4 Runes           | IN PROGRESS | T-040, T-041 DONE; T-042 TODO                                                                                                                                                                                                                             |
| E5 Items           | IN PROGRESS | T-050, T-051 (REVIEW)                                                                                                                                                                                                                                     |
| E6 Live            | NOT STARTED |                                                                                                                                                                                                                                                           |
| E7 Vision          | NOT STARTED |                                                                                                                                                                                                                                                           |
| E8 Personalization | IN PROGRESS | Replanned 2026-11-06: pipeline-fed configured profile, static-only (D-067..D-080 ACCEPTED 2026-11-08; app local-only per D-079); T-090..T-096 DONE, T-097 engine done + UI unblocked (T-041 merged), T-098 blocked on T-054/T-056, T-080..T-086 CANCELLED |

## Data collection status

- Riot key: personal key obtained 2026-11-06 (no expiry; limits verified: 20 req/s, 100 req/2 min — same envelope as dev). Stored locally in `.env` and as GitHub Actions secret `RIOT_API_KEY` for the scheduled ETL workflow (D-057 PROPOSED).
- Scheduled refresh: `.github/workflows/etl.yml` runs every 12h on `main` — it restores the newest `state-*` release (DB asset) from the private state repo (default `draftorb-state`, `STATE_REPO` var override, `STATE_REPO_TOKEN` secret), runs check-key → static → `matches --refresh` → `matches --limit 100` → profile-sync → prune → aggregate → derive-roles → export → status, then `wal_checkpoint(TRUNCATE)` + `integrity_check` (must be `ok`) + `VACUUM` + gzip and publishes a new `state-<UTC yyyymmddThhmm[ss]Z>` release: `DraftOrb.sqlite.gz` always (`if: always()`), `public-exports.tar.gz` only on success, keeping the newest 7 releases. The state-repo flow is live on `main` (releases `state-20261109T0910Z`..`state-20261111T0957Z` observed). Local app gets exports via `pnpm etl pull` (`data/public` gitignored, `deploy.yml` deleted).
- Games collected: 3,597 matches, ~36k participants (euw1, patches 16.19–16.22; top-250 players by rank_score — Challenger/Grandmaster/Master — ingested via `matches --limit=250`, refreshed 2026-11-06 via the new `matches --refresh` flag: +286 matches, all in patch 16.22). 2,994 players discovered (2,648 still pending ingestion). Patch catalogs imported for 16.21 and 16.22. `data/public/latest.json` (D-051, T-029) points at patch 16.22, written by `pnpm etl export` after a successful publish.
- Match rank distribution: all stored matches sit in the top buckets — MASTER_PLUS plus a few DIAMOND (rank_score >= 7 dominates; lower buckets receive only kernel-decayed weight). Participant `rank_score`: 7/8/9 dominate; ~7k NULL (rank unknown).
- Last aggregation: 2026-11-06 — role_prob (553 rows/173 champions), baseline (4,464 rows), pair tables (pair_ally 357,184; pair_enemy 449,408; lane_vs 146,648; lane_full 109,152 rows), rune_ctx (175,006 rows/114 champions) aggregated from the full 3,597-match database; `derive-roles` re-run and `pnpm etl export` re-published patch 16.22 (37 files). Data sufficiency per rank bucket is near-identical across buckets (kernel weights are per-game scalars). Below `minGames` (n_eff 25) per bucket: ~99.4% of pair rows, ALL lane_full rows (n_eff < 10 -> `lane-full.json` exports empty), 324/558 baseline rows, ~99.8% rune_ctx rows. Rows passing n_eff >= 25 per bucket: pair_ally ~284, pair_enemy ~372, lane_vs ~21, lane_full 0.
- Refresh estimate: ~1.5–3 h incremental for the same 250 players (cursors fetch only new matches); first run on a fresh DB ~4–6 h. Scheduled GitHub Action now live (D-057): every 12h, bounded to `matches --refresh` + `matches --limit 100` per run so it stays well under the 6 h job limit at the personal key's 100 req/2 min.

## Next recommended ticket

T-023 is **DONE** (Role-generic recommendation engine with explanations, layered shrinkage scoring, pool contract D-024, composition needs, golden test runner and golden fixtures including non-support TOP 1v1 lane group). The Web MVP implementation is complete; its model remains visibly unvalidated until D-023's paired-bootstrap gate is implemented and passed.
Next ETL ticket: **T-019.d** (CommunityDragon change scores + real-JSON fixtures — SPECS §15/D-046); deps T-019.b/T-019.e now DONE, remaining gate is the owner patch-note verification (PROGRESS open questions). Next web ticket: **T-042** (gameplan notes) or the **T-097 UI half** (unblocked: `RunesPanel` merged). E5 kickoff: **T-050** (item tags) then **T-051** (timeline + item builds — unblocks T-027.b/T-056). Next validation work: complete D-023 and revisit T-027.a before claiming model validation.

Session entries before 2026-10-29 live in [PROGRESS_ARCHIVE.md](./PROGRESS_ARCHIVE.md).

## Open questions for the owner

Owner decisions 2026-11-04: D-034, D-035, D-043, D-045, D-047, D-048, D-049, D-050 and D-051 ACCEPTED; D-044 ACCEPTED with 20 patches; D-046 ACCEPTED with CommunityDragon as the source. Owner decisions 2026-11-05: D-053 and D-054 ACCEPTED. Owner decisions 2026-11-07/08: **D-052..D-080 are all ACCEPTED** (2026-11-08), except the SUPERSEDED ones — D-061..D-066 (by D-067..D-077) and the superseded parts of D-057, D-067, D-069, D-070 and D-073 (by D-076..D-080). Key accepted changes: state moves from the public `etl-db` orphan branch to `state-*` releases of a private repo (default `draftorb-state`, D-078); the app is local-only — no hosting, no deploy workflow, `data/public` gitignored, `pnpm etl pull` distributes exports (D-079); personalized-list badge compares against the rank-bucket baseline, not `score(c)` (D-080); personalize fallback levels are champion-scoped (D-076); "Profile's best" runes/spells semantics fixed (D-077).

Open questions that remain after the 2026-11-08 acceptance:

- D-071: does Riot require a **production key** for the pipeline's use? The app is local-only now (D-079), but the personal-key terms are still **to verify** with the Riot dev portal — marked "to verify" in RIOT_API.md.
- D-071: profile puuids are encrypted per API key like match puuids (B-062/D-060); `etl rekey` covers `participants`/`players` — resolved by T-111 analysis: `profile_games`/`profile_mastery` store no puuid (keyed by `profile_id`) and `profiles.puuid` is re-resolved from the configured Riot ID on every `profile-sync` run, so no profile-table re-key is needed (documenting test in `rekey.test.ts`).
- D-078/D-079 GitHub limits marked "to verify": per-asset release size limit (2 GB from memory), absence of a total cap, ~2,000 free Actions minutes/month for private repos (moot while the main repo stays public — its scheduled runs are free), `gh` CLI preinstalled on GitHub-hosted runners, the ~60-day scheduled-workflow inactivity rule, and whether GitHub keeps serving deleted-branch commits by SHA.
- D-073: personalization constants (`HALF_LIFE_DAYS` 60, `K_SHRINK` 15, `MIN_GAMES` 3, `K_TRUST` 20, `levelFactor`) are priors; there is no backtest for personalization yet — acceptable until one exists?
- D-069: size cap `profileMaxGames` = 500 / last 180 days — confirm acceptable JSON size once real data exists.
- Resolved by implementation (kept for the record): D-068 timeline fetch per synced game — implemented (`items_ordered_json` from match-v5 timeline); queue 420 only for profile stats — implemented.
- T-098: personal items need the item recommender chain (T-054/T-056; GameState T-052 is DONE) and enough per-context profile games; exact open questions are in SPECS §18.6.

- T-019.d verification: please compare the champion and item lists in the 2026-11-04 "T-019.d verification step" entry below with the official 16.21 and 16.22 patch notes (misses and false positives).

## Session log (newest first)

### 2026-11-12 — Devin — Owner decisions: Riot registration verified + local-first ETL (D-091)

- Phase 2 extractor: `lane-snapshots` (migration 019) records per-participant level/gold/XP/CS/position at minutes 5/10/15/20/25 from timeline participantFrames; resumable via `extractor_runs` like the other extractors.
- `pnpm etl publish` implemented (T-128): pure-Node tar.gz writer + gh release publisher with `--db`/`--vacuum`/`--keep`; exports every run, DB backup periodic.
- Owner confirmed DraftOrb is registered on the Riot Developer Portal as a personal product (Phase 0 UNVERIFIED item resolved; docs updated).
- `etl.yml` cron DISABLED — `workflow_dispatch` only; ingestion/aggregate/export now run locally. Publish model: small `public-exports.tar.gz` every run + `DraftOrb.sqlite.gz` periodic backups only (~475 MiB vs 512 MiB cap). Actions usage ~0 min/month. Runbook: `docs/proposed-etl-schedule.md`; local publisher ticketed T-128. Phase 2 partial: `matches --call-budget/--time-budget` shipped; tune-priors SUPPORT best k0=40/k=160 (0.6951 vs 0.6981, in-sample caveat).

### 2026-11-12 — Devin — Prompt-2 model upgrade, Phase 0 + Phase 1 (branch `feat/joint-model-and-items-engine`, draft PR #60)

- Phase 0 audit done: D-082 prerequisites verified on `main`; measured app rate limit 100/120s + 20/1s (0.833 req/s, shared with CI); cell n_eff distributions far sparser than assumed (pair median 2.3, lane ~1.0); backtest baseline log-loss 0.6967 vs baseline-only 0.6946; real payload checks confirm challenges lane fields + timeline frames; DB gzip ~475 MiB vs 512 MiB asset cap; repo confirmed PRIVATE. Full evidence: `docs/reports/model-review-baseline.md`; limits in `docs/RIOT_API.md`.
- Phase 1 implemented behind flags (all default OFF): `pairMainEffectAdjust` (D-088, pair main-effect subtraction in `recommend`/`recommend-terms`), `PersonalizeConfig.blendMode='logit'` (D-089, log-odds personalization blend), `pnpm etl tune-priors` (D-090, k0/k/kLane grid on the holdout) and `backtest draft --pair-adjust` for the A/B gate. ADRs D-088..D-090 PROPOSED. Engine tests: 532 pass incl. golden suite (flag-off output unchanged).
- Pending: pair-adjust backtest + SUPPORT tune-priors running; Phases 2–7 per TICKETS T-122..T-127.

### 2026-11-12 — Devin — T-051 Timeline ingestion + item builds (REVIEW)

- Done:
  - `pnpm etl timeline [platform] [--limit=N]` (`timeline.ts` + `commands/timeline.ts`): fetches match-v5 timelines for stored matches with `fetched_timeline = 0`, writes `item_events` (purchases with `item_slot`, sales, per-event team gold/kill diff) in one transaction per match and only then flips `fetched_timeline`. Resumable; stops early after 3 consecutive transient failures (non-zero exit, same policy as `matches`). Wired into `etl.yml` as a bounded non-fatal step (`--limit 200`) so the initial backlog drains across scheduled runs.
  - `item-events.ts` (pure): item classification, `ITEM_UNDO`/`ITEM_SOLD`/`ITEM_DESTROYED` replay, slot assignment, team gold diff from `participantFrames.currentGold`, kills diff from `CHAMPION_KILL` victim teams, participantId→puuid mapping via `info.participants` + stored `participants.team_id`.
  - `aggregate-items.ts`: rebuilds `item_build` from purchase rows with the D-022 context (slot, 5-min time bucket, state bucket, threat-weighted enemy profile, lane_key in lane phase), expert gate + mastery fallback, recency/reliability weighting, `games_w2`; wired into `pnpm etl aggregate`.
  - `engine/item-context.ts` + `ItemContextConfig` in `config.ts`: `itemTimeBucket`, `itemStateBucket`, `itemPhase`, `threatWeightedDamageProfile` — shared by ETL now and T-054/T-056 later.
  - Real-payload verification on a live EUW1 timeline: undo semantics (`beforeId` = undone item, `afterId` = 0, `goldGain` = refund), `ITEM_DESTROYED` frequency, `info.participants` id→puuid map, `participantFrames` gold fields.
- Files touched: `packages/etl/src/{item-events,item-catalog,timeline,aggregate-items}.ts` (+3 test files), `packages/etl/src/{cli.ts,commands/timeline.ts,commands/aggregate.ts,riot/schemas.ts}`, `packages/engine/src/{item-context.ts,config.ts,index.ts}` (+test), `.github/workflows/etl.yml`, `docs/{DECISIONS,DATA_MODEL,SETUP,TICKETS,PROGRESS}.md`.
- Tests: `pnpm check` — green (105 files / 1195 tests; +45 new). Fixture-based tests cover every ticket rule: slot 0/k>=1/NULL classification, boots, Lane-tagged starters/quest line, undo (purchase + sale), destroyed ignored, gold/kills diff, unmapped participants, lane/mid boundary at 840 s, state buckets, profile keys, expert/mastery filtering, weighting + `games_w2`, idempotent rerun, CLI transient/catalog-missing paths.
- State left: REVIEW — awaiting owner. Key interpretation logged as **D-082 (PROPOSED)**: `Lane`-tagged items never count as completed (else slot 0 would be dead); profile threat uses final KDA/items approximation; state bucket = OR-rule with ahead priority (2000 g / 3 kills priors); `item_build` weight has no rank buckets.
- Next step: owner reviews D-082; then T-027.b (items backtest) once enough timelines accumulate, or T-054 (item recommender v1) which can start on rules.
- Pitfalls / notes for next AI: timeline `participantId`s are NOT puuids — map via `info.participants` then stored `participants.team_id`; `item_events.ts` is milliseconds (aggregate divides by 1000); `matches.fetched_timeline` flips only inside the write transaction; `item_build.lane_key` stores `''` outside lane phase (export maps to absent); the scheduled `etl.yml` timeline step is capped at 200/run — the backlog (~3.6k matches) takes ~18 runs to drain.

### 2026-11-11 — Devin — Post-merge repo check + `etl pull` fixes (B-065, B-066)

- Done:
  - Verified the merged state on `main`: PRs #53 (state-release migration T-106..T-112), #54 (`feat/game-state-threat-score`: T-052, T-019.e, T-053, T-041) and #55 (`fix/state-tag-seconds`) are all in; working tree clean; `pnpm check` green (101 files / 1150 tests).
  - `data/public` was empty after the migration (now gitignored, D-079): `pnpm etl pull` initially failed twice — B-065 (`gh release list --json` has no `assets` field → switched `listStateReleases` to `gh api repos/<repo>/releases --method GET -f per_page=N`, drafts filtered) and B-066 (tar directory entries ending in `/` rejected as unsafe → `resolveEntryTarget` strips trailing slashes; regression test added). Pull then succeeded: 68 files extracted from `state-20261111T0957Z` into `data/public` (incl. `latest.json` → patch 16.22 and `profiles/`).
- Files touched: `packages/etl/src/{state-release.ts,tar-extract.ts,pull.test.ts}`, `docs/{BUGS,PROGRESS}.md`.
- Tests: `pnpm vitest run packages/etl/src/pull.test.ts` 26/26 pass; full `pnpm check` re-run pending commit.
- State left: fixes committed on branch `fix/etl-pull-state-release` (`df40cc8`), pending PR/merge.
- Next step: owner merges the pull-fix branch; T-019.d unblocked (deps DONE) pending the owner patch-note verification.
- Pitfalls / notes for next AI: `gh api` defaults to POST when `-f`/`-F` is passed — always pass `--method GET` for reads. `gh release list --json` fields are limited (no `assets`); use `gh release view --json assets` or the REST API. Real `tar -czf` archives emit directory entries with trailing `/` — the extractor must tolerate them.

### 2026-11-11 — Devin — Owner acceptance: all REVIEW tickets marked DONE

- Done: owner confirmed the merged branches; all 12 REVIEW tickets flipped to DONE in `docs/TICKETS.md` — T-019.b, T-019.c, T-019.e, T-026, T-027.a, T-040, T-041, T-052, T-053, T-106, T-108, T-111. PROGRESS epic table, current status, next-ticket section and open questions updated to match.
- Newly unblocked TODO tickets: T-019.d (still gated on the owner patch-note verification for SPECS §15 step 1), T-042, T-050, T-051, T-054 (needs T-050), T-097 UI half (T-040/T-041 DONE), T-113 (owner decision on the 60-day rule).
- Still blocked: T-019.f (D-023 paired-bootstrap gate on T-027.a), T-027.b (needs T-051), T-056 (needs T-027.b+T-054), T-098 (needs T-054+T-056).
- State left: docs-only change on branch `fix/etl-pull-state-release`.

### 2026-11-08 — Devin — Accept `state-*` tags with seconds (seeded release fix)

- Done:
  - The seeded first state release is tagged `state-20261108T112306Z` (seconds included) but both `etl.yml` jq selectors and `STATE_RELEASE_TAG_PATTERN` in `packages/etl/src/state-release.ts` required exactly 4 time digits, so the first scheduled run failed with "No state-* release found" and `pnpm etl pull` could not see the release either.
  - `.github/workflows/etl.yml`: regex widened to `^state-[0-9]{8}T[0-9]{4,6}Z$` in "Fetch database state" and "Prune old state releases"; plain `sort` replaced by `sort_by` on a normalized key (`date` + `HHMMSS` with missing seconds padded to `00`) because lexicographic order misorders mixed widths ("T112306Z" sorts before "T1123Z" though 11:23:06 > 11:23:00).
  - `packages/etl/src/state-release.ts`: same regex widening; `pickNewestStateTag`/`pickNewestStateTagWithAssets` now sort via `stateTagSortKey`/`compareStateTags` for the same reason; `pull.ts` usage string and module docs updated to `thhmm[ss]`.
  - `pull.test.ts`: new test covering seconds tags and mixed-width chronological order.
  - `docs/SETUP.md`: seeding instructions note the workflow also accepts tags with seconds (the `gh release create` example already used `%H%MZ`).
- Files touched: `.github/workflows/etl.yml`, `packages/etl/src/{state-release.ts,commands/pull.ts,pull.test.ts}`, `docs/{SETUP,PROGRESS}.md`.
- Tests: `pnpm typecheck` clean; `pnpm lint` 0 errors (77 pre-existing warnings); `pnpm format:check` clean; `pnpm test` 95 files / 1107 tests pass; actionlint (docker `rhysd/actionlint`) 0 errors on `etl.yml` + `ci.yml`; jq selection logic verified locally against a mixed valid/invalid tag list.
- State left: branch `fix/state-tag-seconds` ready for PR. Owner action unchanged: the seeded release keeps its tag; next `workflow_dispatch` should now find it.
- Next step: owner merges, then runs T-103 (two verified dispatches).
- Pitfalls / notes for next AI: tag format is now `state-YYYYMMDDTHHMMZ` or `state-YYYYMMDDTHHMMSSZ`; anything else (e.g. missing trailing `Z`, 5-digit time) is ignored by both the workflow and `etl pull`. The draftorb-state repo README still documents `%H%M%S` seeding — out of scope here, flagged to the owner.

### 2026-11-08 — Devin — T-052, T-019.e, T-053, T-041 (branch `feat/game-state-threat-score`)

- Done:
  - **T-052** (`368fca7`): GameState model — `playerStateSchema`/`gameStateSchema` already shipped in T-002.b and match SPECS §8.2 field-for-field; added the missing D-011 parity coverage in `packages/shared/test/parity.test.ts` (full/optional parse, 4-ally/5-enemy caps, strict rejection). Status REVIEW.
  - **T-019.e** (`14b3c5d`): migration `016_breakpoints_change_scores` creates `entity_change_scores` + `data_breakpoints` verbatim from DATA_MODEL §5.4 (all CHECKs, `idx_data_breakpoints_unique` with `COALESCE(scope_id,-1)`). New `packages/etl/src/breakpoints.ts` (list/add/validate/reject, `breakpointAppliesToPatch`, `combineBreakpointWeight` — reset dominates, factors multiply floored at `ETL_CONFIG.minWeight`), `ETL_CONFIG` gained `changeWeightEnabled:false` + `minWeight:0.05` (D-045 names, unused until T-019.f), CLI `pnpm etl breakpoint list|add|validate|reject`, `pnpm etl status` prints "Breakpoints pending review: N". Tests: one failing insert per CHECK on both tables, NULL scope_id uniqueness, lifecycle transitions, combination rule, patch applicability, CLI usage errors. Caveat: aggregation does not read breakpoints yet (T-019.f); `entity_change_scores` stays empty until T-019.d.
  - **T-053** (`ce96b4a`): `packages/engine/src/threat.ts` — `computeThreatScores(enemies, timeSeconds, items, tags, config?)` returns order-aligned `{ threats, shares }` per SPECS §8.2.2; `avgItemGold`/`scalingFactor` helpers; `ThreatConfig`/`DEFAULT_THREAT_CONFIG` in config.ts; exported from index. Underspecified terms fixed as **D-081 (PROPOSED)**: itemGold = catalog `goldTotal` sum; avgItemGold = piecewise-linear prior anchors; scalingFactor = max true `scaling` tag flag else neutral 0.6. 9 tests: fed/not-fed, KDA damping, time-normalized item gold, late>early, untagged neutral, zero shares, determinism.
  - **T-041** (stretch): `apps/web/src/data/runes.ts` (`loadRuneExport` per-champion lazy fetch with 404->null, `loadRuneCatalog` for the static `runes.json`, `buildRuneIconIndex`, `runeIconUrl` on the Data Dragon CDN), `RunesPanel.tsx` on DraftScreen after the champion pick — top pages with style/keystone/perk icons (letter placeholder on CDN failure), shrunk win rate always paired with n_eff, low-data badge, `statShardsVsDamageMix` hint; strings centralized; stat shards aren't in `runesReforged` so they render text-only (D-081 assumption). No "Profile's best" column (T-097).
- Files touched: `packages/shared/test/parity.test.ts`, `packages/etl/migrations/016_*.sql`, `packages/etl/src/{breakpoints*,cli.ts,status*,config/etl-config.ts,commands/breakpoint*,db/migrate.test.ts}`, `packages/engine/src/{threat.ts,config.ts,index.ts}`, `packages/engine/test/threat.test.ts`, `apps/web/src/{data/runes*,components/RunesPanel*,components/DraftScreen.tsx,strings.ts}`, `docs/{TICKETS,PROGRESS,SPECS,DATA_MODEL,DECISIONS,SETUP}.md`.
- Tests: `pnpm check` green — 101 files / 1149 tests, 0 lint errors.
- State left: branch `feat/game-state-threat-score`, 4 commits, all tickets REVIEW (awaiting owner). Next tickets: T-019.d (needs T-019.e accepted), T-019.f (change-weight integration, gated on T-027.a/D-023), T-054 (item recommender v1, needs T-050+T-053), T-097 UI half (now unblocked by T-041).
- Pitfalls / notes for next AI: `seedPatches` numbers patch_index contiguously from 1 (fixture labels `16.20..16.22` -> indices 1..3, NOT 20..22). `pnpm check` enforces prettier — run `pnpm prettier --write` on new files before the gate. Breakpoint transitions are `suggested`-only per SPECS §16 lifecycle; manual `add` rows are `active` and cannot be validated/rejected (no delete command exists — spec has none).

### 2026-11-08 — Devin — State-release migration implemented (T-106..T-112, branch `feat/state-release-migration`)

- Done:
  - **T-106** `.github/workflows/etl.yml` rewritten: restores the newest `state-*` release's `DraftOrb.sqlite.gz` from the private state repo (`STATE_REPO` var, default `draftorb-state`, resolved under `github.repository_owner` when bare; `STATE_REPO_TOKEN` PAT), fails clearly on missing token/repo/no release; same pipeline steps as before (migrate → check-key → static → matches --refresh → matches --limit 100 → profile-sync → prune → aggregate → derive-roles → export → status); `if: always()` compact step does `wal_checkpoint(TRUNCATE)` → `integrity_check` (must be `ok`, else nothing uploads) → `VACUUM` → gzip → uploads `DraftOrb.sqlite.gz` as `state-<UTC yyyymmddThhmmZ>`; `public-exports.tar.gz` (tar of `data/public`) scans for secrets first and uploads only on full success; prune keeps newest 7 `state-*` releases only after a fully successful run. `concurrency.group: etl-refresh`, `cancel-in-progress: false`, main-only guard kept; `actions: write` and the deploy dispatch removed (`contents: read` only).
  - **T-107** `deploy.yml` deleted; `data/public/` (incl. `profiles/`) gitignored and untracked; `copy-public-data.mjs` warns and skips when exports are absent so clean checkouts still build.
  - **T-108** `pnpm etl pull [--repo] [--tag] [--db] [--dir]`: gh-CLI based, picks the newest `state-*` release that actually carries `public-exports.tar.gz` (skips DB-only releases from failed runs), extracts via a strict in-house tar.gz reader (`tar-extract.ts`, no new deps, path-escape safe), optional `--db` restores the SQLite file; clear errors for missing gh/auth/releases.
  - **T-109** log hygiene: ETL progress logs no longer print puuid prefixes, match IDs or profile game rows (`matches.ts`, `matches-process.ts`, `matches-reprocess.ts`, `enrichment.ts`, `profile-sync.ts`, `rekey.ts`); `riot/types.ts` redaction now also strips `PLATFORM_gameId` match IDs from API error text/URLs.
  - **T-110** `scripts/check-secrets.mjs` now walks gitignored `data/public/` in addition to tracked files and `dist`; planted-key test added.
  - **T-111** rekey: analysis + test show profile tables need no re-key — `profile_games`/`profile_mastery` hold no puuid and `profiles.puuid` self-heals via `profile-sync`'s per-run Riot-ID resolution; `rekey.test.ts` documents this.
  - **T-112** D-080 badge: `PersonalizedEntry` gained `deltaVsBaselinePp`/`baselineWinRate`/`baselineBucket` (replacing `deltaVsMetaPp`), computed vs the selected bucket's baseline `w0` and omitted when the row has no weighted evidence or fails the baseline gate; new shared zod `personalizedResultSchema`/`personalizedEntrySchema`, `PERSONAL_RESULT_SCHEMA_VERSION` bumped to 2; UI badge reads "+N pp vs Diamond avg"; golden tests pin the arithmetic.
- Files touched: `.github/workflows/{etl.yml,deploy.yml}`, `.gitignore`, `apps/web/scripts/copy-public-data.mjs`, `apps/web/src/{strings.ts,components/PersonalizedList.tsx,components/personalized-list.test.ts}`, `packages/shared/src/{index.ts,schemas/core.ts,schemas/personalized.ts}`, `packages/engine/src/personalize.ts`, `packages/engine/test/{personalize,profile-setup}.test.ts`, `packages/etl/src/**` (cli, commands/pull, state-release, tar-extract, log-hygiene files, tests), `scripts/check-secrets.{mjs,test.ts}`, `data/public/**` (untracked), `docs/{TICKETS,PROGRESS}.md`.
- Tests: `pnpm install` clean; `pnpm typecheck` clean; `pnpm lint` 0 errors (77 pre-existing warnings); `pnpm test` 95 files / 1098 tests pass. actionlint/gh not installed locally — etl.yml reviewed statically (action versions match ci.yml).
- State left: branch `feat/state-release-migration` ready for PR. Owner actions T-099..T-105 still required before the new flow can run (state repo, token, seed release, two verified dispatches, then `etl-db` deletion).
- Next step: owner merges after review, performs T-099..T-103, then T-104.
- Pitfalls / notes for next AI: until merge + seed, main still runs the OLD `etl-db` flow — the new `etl.yml` fails fast without `STATE_REPO_TOKEN`/a `state-*` release by design. `pnpm etl pull` needs `gh auth login` with read access to the private state repo. Keepalive for the ~60-day scheduled-workflow rule is proposal-only (T-113) — see PR description.

### 2026-11-08 — Devin — Docs reconciled with accepted decisions D-052..D-080 + migration tickets (DOCS ONLY)

- Done:
  - Owner accepted D-052..D-080 (2026-11-08); docs updated to match. No code, package files, `.gitignore` or `.github/` touched.
  - `SPECS.md`: §18 retitled (D-067..D-080); §18.1 notes `data/public` is gitignored/local-only, exports reach the app via the `public-exports.tar.gz` release asset + `pnpm etl pull` (D-078/D-079); §18.2 fallback hierarchy is champion-scoped at every level (D-076); badge delta is vs the rank-bucket baseline `w0`, omitted without weighted evidence or when the baseline gate fails, label names the bucket (D-080); §18.5 records D-077 page identity / spell-pair normalization / per-setup shrinkage prior / 5-game minimum; §10 hosting wording updated for local-only.
  - `SETUP.md`: rewritten around the state repo — private `draftorb-state` (default), `state-<UTC yyyymmddThhmmZ>` releases with `DraftOrb.sqlite.gz` + `public-exports.tar.gz`, fine-grained `STATE_REPO_TOKEN` (contents read/write, one repo, expiry placeholder recorded), first-release seeding via `gh` CLI (wal_checkpoint, integrity_check, VACUUM, gzip, `gh release create`), `pnpm etl pull`, `etl-db` deletion after two successful runs, public-log hygiene rules, ~60-day scheduled-workflow reminder (to verify), Riot key rotation procedure (D-071), local-only workflow marked clearly.
  - `ARCHITECTURE.md`: overview + personalization pipeline redrawn — local-only app, no hosting/deploy, ETL state in private-repo release assets, exports distributed via `pnpm etl pull`.
  - `DATA_MODEL.md`: profile export delivery updated (gitignored `data/public`, release asset, `pnpm etl pull`); noted the optional baseline win rate + bucket fields on personalized entries (D-080).
  - `RIOT_API.md`: profile-sync endpoints were already listed; personal-key/production-key notes updated for local-only (D-071, "to verify" kept).
  - `TICKETS.md`: new epic **E9 State repo & local-only migration** — owner actions T-099..T-105 (secrets audit, backup, state repo + token, seed release, two verified runs, `etl-db` deletion, reminders) and implementation tickets T-106..T-113 (etl.yml rewrite, deploy.yml removal + gitignore, `etl pull`, log hygiene, key-leak scan of `data/public`, rekey for state release/profile tables, D-080 badge baseline, optional keepalive).
  - `GLOSSARY.md`: pipeline definition updated (was still describing `etl-db` + `deploy.yml` + Pages).
- Files touched: `docs/{SPECS,SETUP,ARCHITECTURE,DATA_MODEL,RIOT_API,PROGRESS,TICKETS,GLOSSARY}.md` only.
- Tests: docs-only session; no code changed.
- State left: docs match the accepted decisions; the migration itself is NOT implemented — `etl.yml` still uses `etl-db`, `deploy.yml` still exists, `data/public` is still committed. Next step is the owner actions (T-099..T-105) interleaved with the implementation tickets (T-106..T-113).
- Next step: owner reviews this docs pass; then T-099/T-100 (secrets audit + backup) can start, and T-106 (etl.yml rewrite) can be implemented in parallel.
- Pitfalls / notes for next AI: until T-106..T-113 land, the repo still runs the OLD flow — do not "fix" docs back to match the code; the decisions win. `data/public` remains committed until T-107; profile exports are not yet in `data/public/profiles/` until the first state release is seeded and pulled. Workflow logs of the PUBLIC repo are public — never log other players' identifiers (D-078 point 9).

### 2026-11-07 — Devin — Personalization epic T-090..T-097 implemented

- Done:
  - **T-090** (`269d48b`): `data/profiles.config.json` (KiriToc#Toc EUW1), shared zod schemas for config/export/index, schema-version constants, `data/users/` gitignore (B-064 FIXED), `.env.example` notes.
  - **T-091** (`30362bd`): migration `015_profiles.sql`; account-v1/match-v5/timeline/mastery-top Riot client + schema additions; pure `profile-games.ts` extraction; `profile-export.ts` (anonymized whitelist export, favorites per D-074, atomic-ish per-file write); `profile-sync.ts` resumable cursor sync (180-day/500-game caps, failure keeps previous export + rows); `pnpm etl profile-sync [id] [--publish]`.
  - **T-092** (`6f28889`): `etl.yml` scheduled `profile-sync --publish` step (non-fatal, previous exports kept); `scripts/check-secrets.mjs` RGAPI-/key-value scan wired into CI + deploy.
  - **T-093** (`a011a6b`): `apps/web/src/data/profile.ts` loader + profile label in the draft screen.
  - **T-094** (`5bea98c`): `pool/favorites.ts` import + `include`/`only`/`hide` mode applied to all lists (display-only).
  - **T-095** (`a71544a`): pure `personalize()` — recency weights, shrinkage, L1..L5 fallback, trust blend, insufficient-data entries (D-076 PROPOSED for level scoping).
  - **T-096** (`fe3ab01`): `PersonalizedList` UI (profile label title, WR/n_eff/level/+d badges, 5-by-5 pagination).
  - **T-097 engine** (`c8897c4`): `recommendProfileRunes`/`recommendProfileSpells` (D-077 PROPOSED). UI half blocked on T-041 — no runes screen exists.
- Review findings fixed in place (second commit): secret-check test file tripped its own RGAPI- scan (split the planted literal); personalized list missed the user-pick exclusion (new `computePersonalizedEntries` + regression test); `profiles.synced_at` was stamped before Riot fetches so a failed sync re-exported stale rows under a fresh timestamp (now stamped on success only + regression test); auth errors abort without writing exports (test added); index `file` constrained to a plain filename.
- Files touched: see commits `269d48b..HEAD` + review-fix commit; docs: TICKETS (T-090..T-096 DONE), BUGS (B-064 FIXED), DECISIONS (D-076, D-077 PROPOSED), SETUP, .env.example, workflows.
- Tests: `pnpm check` green — 94 files / 1071 tests; `pnpm --filter @draftorb/web build` green; `node scripts/check-secrets.mjs` passes on the real tree and dist.
- State left: DONE for T-090..T-096; T-097 partially (engine only, UI needs T-041); T-098 TODO (blocked by T-052/T-054/T-056).
- Next step: owner review of D-067..D-077; T-041 (runes UI) unblocks the T-097 UI half; real `profile-sync --publish` run needs `RIOT_API_KEY` (first export lands in the next scheduled ETL run).
- Pitfalls / notes for next AI: profile exports are NOT yet in `data/public/profiles/` — the web personalization UI stays dormant until the scheduled workflow publishes the first export. `profile-games` stores `match_id` internally only; never export it. `recommendProfileRunes/Spells` reuse `PersonalizeContext` — build it via `personalizeContext(draftInput, data)`.

### 2026-11-06 — Devin — Personalized profile feature replanned for static GitHub Pages (DOCS ONLY)

- Done:
  - Planning session for the owner's "pipeline-fed personalized profile" feature. No code written; only `docs/` touched.
  - Reconciliation: the earlier personalization plan (per-user `user-sync`, gitignored exports with `--publish`, "For you" list) assumed per-visitor profiles. The deployment target is GitHub Pages (static only), so the model changed to a pipeline-synced **configured** profile. D-061..D-066 marked SUPERSEDED; T-080..T-086 marked CANCELLED.
  - `DECISIONS.md`: D-067..D-075 PROPOSED — static-only delivery, no login/server/sessions (rejected alternatives recorded: login page, Riot key as password, server-side sessions, encrypted data + password gate); declarative `data/profiles.config.json` + `pnpm etl profile-sync`; anonymized public export with caps and a build-time `RGAPI-` leak check; sync folded into `etl.yml` reusing the `etl-db` state branch; Riot key handling/expiry (personal key today, production key "to verify"); profile-labeled list never "For you"; statistical method carried over (half-life 60d, `K_SHRINK` 15, `MIN_GAMES` 3, fallback L1..L5, `K_TRUST` 20, rank-normalized meta); favorites top-15-recency ∪ top-5-mastery with `include`/`only`/`hide`; minimum sample sizes.
  - `TICKETS.md`: T-080..T-086 CANCELLED; new T-090..T-098 TODO in dependency order (config+schemas -> profile-sync ETL -> workflow+secret check -> web loader -> favorites UI -> engine personalize -> personalized list UI -> runes/spells -> items last). Status legend gained `CANCELLED`.
  - `SPECS.md`: §7.1 and §18 rewritten for the configured-profile model; `score(c)` unchanged (D-024/D-072).
  - `DATA_MODEL.md`: `profiles`/`profile_games`/`profile_mastery` tables (renamed from the cancelled `user_*` plan) + `data/public/profiles/` export format with anonymization rules and caps.
  - `ARCHITECTURE.md`: pipeline flow diagram (Secrets -> Action -> ETL -> SQLite -> JSON -> Pages -> browser; browser-local pool). `TESTING.md`: golden cases updated + anonymization/secret-scan cases. `RIOT_API.md`: profile endpoints under `profile-sync`, scheduled-run budget, key-expiry/production-key notes. `SETUP.md`: profile sync section (config, secrets, Pages). `GLOSSARY.md`: profile/pipeline terms updated. `BUGS.md`: B-064 OPEN — `.gitignore` never covered the legacy `data/users/` path (fixed by T-090); audit found no real secrets committed.
- Files touched: `docs/{DECISIONS,TICKETS,SPECS,DATA_MODEL,ARCHITECTURE,TESTING,RIOT_API,SETUP,GLOSSARY,BUGS,PROGRESS}.md` only.
- Tests: docs-only session; `pnpm check` formatting verified for the edited markdown.
- State left: planning complete, awaiting owner review of D-067..D-075. Next ticket when approved: **T-090** (profile config + shared schemas).
- Next step: owner reviews D-067..D-075 and answers the open questions in PROGRESS.md; then T-090 can start. T-040 (runes) still needs review before T-097 can build on it.
- Pitfalls / notes for next AI: personalization NEVER changes `score(c)` — it is a separate `personalize(...)` output (D-072, D-024 invariant); the personalized list is labeled with the profile label, never "For you"; only configured profiles in `data/profiles.config.json` are synced — visitors cannot add any; profile exports are anonymized (no foreign names/Riot IDs/puuids/match ids, D-069); engine stays pure — `personalize` receives the profile as a plain object and the reference time as an argument (no `Date.now()`).

### 2026-11-06 — Devin — Personalized recommendations feature planned (DOCS ONLY, SUPERSEDED)

- Done:
  - Planning session for the owner's personalized-recommendations request (Riot ID profile, favorites, personal win rates for champions/runes/summoner spells/items). No code written; only `docs/` touched.
  - `DECISIONS.md`: D-061..D-066 PROPOSED — "For you" third list with `score(c)` unchanged (D-024 invariant); profiles via `etl user-sync` exported to JSON (web never calls Riot); gitignored-by-default storage with explicit `--publish`; statistical method (half-life 60d, `K_SHRINK` 15, fallback hierarchy L1..L5, `K_TRUST` 20, rank-normalized meta blend); favorites definition (top 15 recency + top 5 mastery, `include`/`only`/`hide`); minimum sample sizes / insufficient-data rules. No new dependencies.
  - `TICKETS.md`: new epic **E8 Personalization**, T-080..T-086 TODO in dependency order (user-sync ETL -> profile loader/selector -> favorites -> engine `personalize` -> "For you" UI -> personal runes/spells -> personal items last).
  - `SPECS.md`: §7.1 updated for the third list; new §18 (profile, personal WR algorithm, "For you" UI, favorites, runes/spells, items open questions).
  - `DATA_MODEL.md`: `user_profiles`/`user_games`/`user_mastery` tables + `data/users/<puuid>.json` export format and published `index.json`.
  - `TESTING.md`: personalization golden cases + `user-sync` idempotence/schema tests. `RIOT_API.md`: account-v1/match-v5/champion-mastery-v4 endpoints, routing, rate-limit notes. `GLOSSARY.md`: profile, personal win rate, shrinkage, trust, favorites, "For you".
- Files touched: `docs/{DECISIONS,TICKETS,SPECS,DATA_MODEL,TESTING,RIOT_API,GLOSSARY,PROGRESS}.md` only.
- Tests: docs-only session; `pnpm check` formatting verified for the edited markdown.
- State left: planning complete, awaiting owner review of D-061..D-066. Next ticket when approved: **T-080** (`user-sync` ETL).
- Next step: owner reviews D-061..D-066 and answers the open questions in PROGRESS.md; then T-080 can start. T-040 (runes) still needs review before T-085 can build on it.
- Pitfalls / notes for next AI: personalization NEVER changes `score(c)` — it is a separate `personalize(...)` output (D-061); user exports are gitignored unless `--publish` (D-063); engine stays pure — `personalize` receives the profile as a plain object and the "now" timestamp as an argument (no `Date.now()`).

### 2026-11-06 — Devin — B-063 merged rune pages overstated `n_eff` (FIXED)

- Done:
  - `aggregateContextPages` (`packages/engine/src/runes-context.ts`) merged duplicate displayed pages by summing each row's `toEquivalentCounts` output, inflating `n_eff`/`gamesE`/`winsE` and the context totals (`totalGamesE`/`totalWinsE`, the prior in `recommendRunes`) whenever duplicate rows had different game weights. Now accumulates `winsW`/`gamesW`/`gamesW2` per page key and converts once per merged page.
  - Regression test in `runes.test.ts`: duplicate page rows with unequal weights (ten weight-1 + ten weight-0.1 games) assert merged `n_eff ≈ 11.98` (not 20) and `lowData` true.
- Files touched: `packages/engine/src/runes-context.ts`, `packages/engine/test/runes.test.ts`, `docs/{BUGS,PROGRESS}.md`.
- Tests: `pnpm check` green (83 files, 1001 tests).
- State left: DONE.
- Next step: none — feeds T-041 (runes UI) once T-040 is accepted.
- Pitfalls / notes for next AI: `n_eff` is nonlinear — never sum per-row equivalent counts across a merge; accumulate raw `winsW`/`gamesW`/`gamesW2` and call `toEquivalentCounts` once.

### 2026-11-06 — Devin — B-062 `400 Exception decrypting` on refresh; `etl rekey` command (FIXED pending owner run, D-060 PROPOSED)

- Done:
  - Diagnosed the failed `matches euw1 --refresh` (CI + local): not a code bug — Riot encrypts PUUIDs per API key, so every puuid stored under the previous `RIOT_API_KEY` returns `400 Exception decrypting` under the current one. Verified: league entries by rank work, fresh puuids work, all ~3k stored puuids fail; a re-fetched match returns entirely different participant puuids for the same players. Match IDs are unaffected.
  - New `pnpm etl rekey [platform] [--dry-run] [--limit=N]` (`packages/etl/src/rekey.ts` + `commands/rekey.ts`): re-fetches every stored match by ID, pairs stored participants with fresh ones via a team/champion/KDA fingerprint, and rewrites `participants`, `item_events`, `players` and `match-ingest:` cursors in one transaction. Conflicting mappings abort; failed matches are reported and re-runnable (idempotent); stale unmapped players/cursors are dropped (`etl players` re-creates pending players). 7 tests in `rekey.test.ts`.
  - Docs: BUGS.md B-062, DECISIONS.md D-060 PROPOSED, RIOT_API.md (per-key puuid note), SETUP.md (key-change step + command + troubleshooting).
- Files touched: `packages/etl/src/{rekey.ts,rekey.test.ts,cli.ts,commands/rekey.ts}`, `docs/{BUGS,DECISIONS,RIOT_API,SETUP,PROGRESS}.md`.
- Tests: `pnpm check` green (83 files, 1000 tests).
- State left: DONE — rekey executed on the local DB 2026-11-06 (~70 min, 3,597 matches, 0 failures): 35,970 participant rows + 2,492 players + 250 cursors rewritten, 502 stale players dropped; `etl players euw1 --reset` rediscovered 850 players under the new key (3,016 players total); `etl-db` reseeded twice (rekeyed DB, then post-rediscovery DB — 42 MB gz). Verified a stored puuid resolves via league-v4. Next scheduled `etl.yml` run should pass `matches --refresh` again.
- Next step: owner reviews D-060; optionally trigger `etl.yml` manually to confirm end-to-end.
- Pitfalls / notes for next AI: never assume stored puuids survive an API key change — `400 Exception decrypting` always means key/puuid mismatch, not a malformed URL. `etl rekey` costs ~1 match-detail call per stored match (~3.6k calls).

### 2026-11-06 — Devin — T-040 rune recommender in engine (REVIEW, D-059 PROPOSED)

- Done:
  - Shared: `RUNE_RESULT_SCHEMA_VERSION` = 1 (core.ts); new schemas in `schemas/runes.ts` — `runeRecommendDataSchema` (`roleProb` + `tags`), `enemyDamageMixSchema`, `runePagePickSchema` (page ids + `winRate`/`nEff`/`players`/`pickShare`/`lowData`/scoring `contextKey`+`contextLevel`), `runeAdaptationHintSchema` (`statShardsVsDamageMix`), `runeRecommendationResultSchema` (`pages`, `adaptationHints`, `damageMix`, `dataAvailable`).
  - Engine: `recommendRunes(input, championId, runeExport, data, config?, runeConfig?)` in `src/runes.ts` + context helpers in `src/runes-context.ts`; `RuneConfig` (`kRune` = 40 eq. games prior, `topPages` = 3, `laneGroups`) in `config.ts`. Reproduces the aggregator's `lane:`/`damagemix:`/`global` keys from the draft via §4 role inference + lane-phase influence ordering (prefix back-off); pages scored by recursive shrinkage toward the same page's estimate in the next broader context (pooled-context prior when the page is absent everywhere broader, 0.5 at the broadest level); top pages ranked by shrunk win rate, tie-break `pickShare`, then page key; `lowData` = scoring-context `n_eff < minGames`.
  - Interpretation details (partial-draft key matching, page identity, shrinkage priors, damage mix over all enemy board champions, shard hint = most-picked `statShardIds` in the matching `damagemix:` context) logged as D-059 PROPOSED.
  - Tests: `packages/engine/test/runes.test.ts`, 16 cases — lane/damagemix/global chain, exact shrinkage arithmetic, partial lane knowledge prefix matching, TOP 1v1 key, missing export/bucket, topPages + pickShare tie-break, lowData, shard hint, duplicate-page merge, determinism, custom page count, shared-schema validation.
- Files touched: `packages/shared/src/{index.ts,schemas/core.ts,schemas/runes.ts}`, `packages/engine/src/{config.ts,index.ts,runes.ts,runes-context.ts}`, `packages/engine/test/runes.test.ts`, `docs/{DECISIONS,TICKETS,PROGRESS}.md`.
- Tests: `pnpm check` green (baseline was green before starting).
- State left: REVIEW pending owner review (D-059 PROPOSED). Web wiring is T-041.
- Next step: owner reviews T-040/D-059; then T-041 (runes UI) or T-019.d once T-019.b/T-019.c are accepted.
- Pitfalls / notes for next AI: `recommendRunes` takes the already-picked `championId` and the parsed per-champion `RuneExport` — the engine never reads files; the caller (web, T-041) loads `roles/<userRole>/runes/<championId>.json`. Page `contextKey`/`contextLevel` report the most specific context the page was scored in. `dataAvailable: false` means show a no-data state, not an error.

### 2026-11-06 — Devin — PR #49 review fixes (matches ingestion, D-058 PROPOSED)

- Done: addressed the Devin Review comments on PR #49 (`improvements-bugs`), two rounds:
  - Round 1 (`matches.ts`, `matches-store.ts`, `matches-process.ts`): `--reset`/`--reset-tombstones` state clears moved AFTER `--since-patch` validation; done cursors relist in full on `--reset-tombstones`; `findRejection` (now async, takes the run's patch resolver) drops `invalid` rejects whose patch label has since resolved so lag-rejected matches self-heal.
  - Round 2 (`matches.ts`, `commands/matches.ts`, `.github/workflows/etl.yml`): `--reset-tombstones` relists are now UNCAPPED (`relistLimit = MAX_SAFE_INTEGER` on the widened/done branches; new players keep `perPlayer`) so pruned matches beyond the newest-N ids are reachable; `MatchIngestionResult.stoppedEarly` flags the 3-consecutive-failure breaker and `etl matches` exits non-zero on it (CliError) so etl.yml never publishes a partial refresh — the `always()` state-upload steps still save cursors; etl.yml gained a guard step refusing non-`main` refs (a manual dispatch on a branch would publish exports there while deploy.yml builds main).
  - Tests: 4 new/extended cases in `matches.test.ts` (tombstones/cursors survive failed `--since-patch` validation; invalid reject recovered after catalog refresh; done cursor full relist; uncapped relist beyond `perPlayer` via a paginated mock; `stoppedEarly` assertions).
- Files touched: `packages/etl/src/{matches,matches-store,matches-process,matches.test}.ts`, `packages/etl/src/commands/matches.ts`, `.github/workflows/etl.yml`, `docs/{DECISIONS,PROGRESS}.md`
- Tests: `pnpm check` — green.
- State left: DONE pending owner review; fixes are on `improvements-bugs` (PR #49 branch).
- Next step: owner reviews PR #49; D-058 awaits owner accept/reject.
- Pitfalls / notes for next AI: `findRejection` is internal (not exported via `index.ts`); its resolver param triggers the shared one-per-run `versions.json` fetch on a miss, and a failed refresh surfaces as a transient player failure (same as `evaluateMatch`). Partial (non-done) cursors do NOT rewind `processed` on `--reset-tombstones`: snapshot ids already processed stay skipped — use `--reset` for a full re-evaluation. `etl matches` now exits 1 when ingestion stops early; isolated transient player failures still exit 0.

### 2026-11-06 — Devin — Scheduled ETL refresh in CI + `etl-db` state branch (ops, D-057 PROPOSED)

- Done:
  - Owner obtained a Riot **personal key** (validated by Riot; no expiry). Rate limits verified by owner in the dev portal: 20 req/s, 100 req/2 min — same envelope as the dev key (recorded in RIOT_API.md).
  - DB persistence design (owner chose 12h cadence, refresh + bounded pending ingest + prune, auto-commit exports): orphan branch `etl-db` holds `DraftOrb.sqlite.gz` (~58 MB gzipped / ~248 MB after VACUUM). Seeded from the local DB and pushed. Alternatives rejected in D-057: actions/cache and artifacts (cannot be seeded outside a workflow + quota/eviction risk), R2/B2 (external account, deferred), committing to main (>100 MB/file limit).
  - New `.github/workflows/etl.yml`: every 12h (`37 */12 * * *`) + `workflow_dispatch`; restores DB from `etl-db` (refuses to run if the branch is missing), then migrate → check-key → static → `matches euw1 --refresh` → `matches euw1 --limit 100` → prune → aggregate → derive-roles → export → status; WAL checkpoint + VACUUM + gzip; force-pushes the amended single-commit state branch; commits changed `data/public/**` to main and dispatches `deploy.yml` explicitly (GITHUB_TOKEN pushes don't trigger push-event workflows). Compact/upload steps use `if: always()` so partial progress survives step failures. Review fixes: added the missing `migrate` step, `actions: write` permission, non-fatal publish step, `gzip -n`.
  - Docs: SETUP.md (CI section + reseed procedure + tuning), RIOT_API.md (personal key + verified limits), DECISIONS.md D-057 PROPOSED, .env.example.
- Files touched: `.github/workflows/etl.yml` (new), `docs/{SETUP,RIOT_API,DECISIONS,PROGRESS}.md`, `.env.example`; orphan branch `etl-db` created on origin (not part of main).
- Tests: none (CI YAML + docs; the compact script was exercised on a scratch DB copy — checkpoint + VACUUM verified).
- State left: DONE pending owner review (D-057 PROPOSED). Owner must add the `RIOT_API_KEY` secret in repo Settings → Secrets and variables → Actions before the first scheduled run; can also trigger manually via _Actions → ETL refresh → Run workflow_.
- Next step: owner adds the secret and runs the workflow once manually to validate end-to-end; review D-057.
- Pitfalls / notes for next AI: the state branch is force-pushed (amended single commit) — never merge or build on it; `git clone --depth 1` of it yields only the .gz. If `DraftOrb.sqlite.gz` approaches 100 MB, reduce `--per-player`/retention or move state to R2/B2 (D-057). Pending ingest advances ~100 players/run (~26 days to cover the ~2,648 pending at 12h cadence).

### 2026-11-06 — Devin — T-026 golden test suite completed (REVIEW)

- Done:
  - Golden runner (`packages/engine/test/golden.test.ts`) extended: expected reasons accept `with` (exact champion-id list, distinguishes pair slots and `lane_vs` vs `lane_full`) and `deltaPp`; new `allReasons: true` pins the complete reason list index-by-index; `poolRecommendations`/`poolUnavailable: null` asserts the fields are absent (empty pool); a new per-fixture invariant asserts canonical layer order (pairs -> lane -> comp -> blind) on every recommendation of every fixture.
  - 5 new fixtures (23 total, was 18): `pool_empty` (explicit empty pool emits no pool fields), `pool_three_mixed` (pool of 3: one scored, one low-data -> `poolUnavailable`/`insufficientData`, one off-role -> `offRole` warning), `pool_contains_top_pick` (pool holds the overall #1: `poolRank` 1 / `rank` 1), `full_draft_support` (all 10 slots known; pins the full reason order — pairs by descending influence/ties by championId, then `lane_vs` `with` [200,201], `lane_full` `with` [10,200,201], comp — plus three `counteredBy` warnings), `lane_reason_correction` (lane `deltaPp` pinned as corrections to the pair estimate: a +35.95pp synergy is corrected by -35.89pp `lane_vs` and -49.98pp `lane_full`).
  - Fixed pre-existing `pnpm format:check` failure: `docs/PROMPTS.md` (committed unformatted in 7c592c9 on this branch) reformatted with prettier, separate `style` commit.
- Files touched: `packages/engine/test/golden.test.ts`, `packages/engine/test/golden/{pool_empty,pool_three_mixed,pool_contains_top_pick,full_draft_support,lane_reason_correction}.json` (new), `docs/{TICKETS,PROGRESS,BUGS}.md`, `docs/PROMPTS.md` (format only).
- Tests: `pnpm check` green (81 files, 973 tests; golden suite now 139 tests across 23 fixtures).
- State left: REVIEW. Interpretation note: the acceptance's "lane reason phrasing" was pinned engine-side as the correction semantics (lane `deltaPp` measured against the pair-running prediction, SPECS §5); the web card has no lane-specific UI string — the literal "in this exact lane..." phrasing would be a web ticket if the owner wants it.
- Next step: owner review; then T-027.b or the D-023 paired-bootstrap gate work for T-027.a.
- Pitfalls / notes for next AI: expected `reasons` remain an ordered subsequence unless `allReasons: true`; `with` is matched exactly when specified. `poolRecommendations: null`/`poolUnavailable: null` assert field absence — an empty array asserts a defined-but-empty list. `deltaPp` pins the rounded (2-decimal) reported value.

### 2026-11-06 — Devin — `matches --refresh` flag (D-056 PROPOSED) + existing-set refresh run (ops)

- Done:
  - New `--refresh` flag on `pnpm etl matches` (owner request: refresh only the already-ingested players instead of walking all 2,994 discovered ones): player selection is restricted to puuids with an existing ingest cursor (partial or done); `--limit`/ordering apply within that subset; done cursors keep the D-018 incremental `startTime` listing. `--refresh --reset` is a usage error. D-056 logged PROPOSED.
  - `pnpm check` green (81 files, 925 tests); new regression test: refresh skips cursor-less players entirely (no list call) and incrementally refreshes the done player.
  - Ran `pnpm etl matches euw1 --refresh` on the real DB: 250/250 cursor players processed in ~15 min, 286 new matches stored (all patch 16.22), 877 duplicates, 20 filtered, 0 invalid/failed. Matches total 3,311 -> 3,597; players table grew 2,898 -> 2,994 (enrichment upserts discovered participants).
  - Re-ran `aggregate` (pair tables now 357k/449k/147k/109k rows; rune_ctx 175,006 rows/114 champs), `derive-roles 16.22`, `export` (37 files, `latest.json` still 16.22).
- Files touched: `packages/etl/src/{matches.ts,matches.test.ts,commands/matches.ts}`, `docs/{SETUP,DECISIONS,PROGRESS}.md`, `data/public/16.22/*`, `data/DraftOrb.sqlite` (gitignored).
- Tests: `pnpm check` green (925 tests).
- State left: DONE pending owner review (D-056 PROPOSED). lane_full still exports empty (no row reaches exportMinGames). 2,648 discovered players remain pending — ingest them with plain `pnpm etl matches euw1` (many hours on a dev key; key expires every 24 h).
- Next step: owner review of D-056; decide whether to ingest the pending players; T-019.d once T-019.b/T-019.c are accepted.
- Pitfalls / notes for next AI: `--refresh` selects on cursor presence, not stored matches; a `--reset` run must not be combined with it (usage error). Refresh cost is ~1 match-list call per done player plus new games — orders of magnitude cheaper than a full walk.

### 2026-11-06 — Devin — ETL refresh attempt (ops, no ticket); `matches` blocked on expired key

- Done:
  - `pnpm etl migrate` (applied pending `014_patches_drop_released_at`; 14/14 now).
  - `pnpm etl check-key euw1` -> 401 "Unknown apikey": the dev key in `.env` is expired (dev keys last 24 h). `matches` could not run; owner must paste a fresh key.
  - `pnpm etl static` -> re-imported patch 16.22 (Data Dragon 16.22.1 still latest): 173 champions, 859 items, 5 rune trees.
  - `pnpm etl aggregate` -> role_prob 553 rows/173 champs, baseline 4,424 rows, pair tables 342,992 ally / 430,560 enemy / 138,440 lane_vs / 100,864 lane_full, rune_ctx 159,790 rows (one expected warning: 98 unparseable `versions.json` entries skipped, D-055).
  - `pnpm etl derive-roles 16.22` + `pnpm etl export` -> patch 16.22 re-published (36 files, `patch-meta.json` included), `latest.json` still points at 16.22.
  - Data sufficiency audit (n_eff = games_w^2/games_w2 vs `minGames` 25 / `exportMinGames` 10): counts per rank bucket are near-identical across all 8 buckets because the rank kernel weights every game into every bucket; stored games themselves are 3,308 MASTER_PLUS + 3 DIAMOND. Below minGames: ~99.5% of pair rows, 100% of lane_full rows (all n_eff < 10, so `lane-full.json` exports as an empty array — pre-existing, see 2026-11-05 B-053 note), 325/553 baseline rows per bucket, ~99.9% rune_ctx rows.
- Files touched: `docs/PROGRESS.md`, `data/public/16.22/*` (re-export), `data/DraftOrb.sqlite` (gitignored; migration 014 only).
- Tests: none (ops run; all touched paths already covered).
- State left: DONE except `matches` resume — BLOCKED on a fresh Riot dev key in `.env`. After the key is refreshed: `pnpm etl matches euw1` (resumes via cursors, ~45 s/player), then re-run `aggregate` + `derive-roles` + `export`.
- Next step: owner pastes a new dev key; then resume ingestion. T-019.d still next ticket once T-019.b/T-019.c are accepted.
- Pitfalls / notes for next AI: pair/lane/rune tables have no raw `games` column — only `wins_w`/`games_w`/`games_w2`; compute n_eff in SQL as `games_w*games_w/games_w2`. `baseline` is the only aggregate table with a raw `games` column.

### 2026-11-06 — Devin — D-055 patch-index implementation details (T-019.b stays REVIEW)

- Done:
  - `patches.ts` reworked per D-055: `parsePatchLabels` now sorts NUMERICALLY by (major, minor) (never string/source order), dedupes hotfixes, and skips unparseable `versions.json` entries with a single warning; `comparePatchLabels` is the shared numeric comparator (`matches-store.comparePatches` re-exports it). `refreshPatches` is append-only AND verified: it refuses to run on a non gap-free/misordered table or when a missing label does not sort after the newest stored one.
  - `ensurePatchesFresh` renamed to `ensurePatchCoverage` and now reports `unresolvedLabels`, `orphanLabels`, `orphanMatches` (stored `matches.patch` labels absent from `patches`). Read commands fetch `versions.json` only on a miss, at most once per run; graceful degradation per D-055 (warning when only stored labels are missing, error naming the label when the explicit snapshot cannot be resolved).
  - `loadPatchWindow` returns `orphanLabels`/`orphanMatches`; `aggregate`/`derive-roles` log the excluded count and labels. `matches` routes its empty-table refresh through `patchResolver.refresh()` so a run still fetches at most once.
  - Migration `014_patches_drop_released_at.sql`: `released_at` removed (nothing populated it; column was permanently NULL).
  - Snapshot metadata: `aggregate` records `{ patch, patchIndex, currentPatchIndex, patchesMaxIndex, aggregatedAt }` in `ingest_state` key `aggregate:snapshot` (only when a table was rewritten); `export` publishes it as `patch-meta.json` (hashed in `manifest.files`; manifest schema unchanged, existing snapshots stay valid).
  - `backtest` copies `patches` without `released_at`, so it also works against pre-014 source databases.
  - Docs: D-055 marked ACCEPTED with the reviewed decisions, DATA_MODEL (DDL, orphan rules, `aggregate:snapshot`, `patch-meta.json`), SPECS §12.
- Files touched: `packages/etl/src/{patches.ts,aggregate-meta.ts(new),aggregate-shared.ts,matches-store.ts,matches.ts,commands/{aggregate,derive-roles,backtest}.ts,export/index.ts,index.ts}`, `packages/etl/migrations/014_patches_drop_released_at.sql` (new), tests (`patches.test.ts`, `aggregate-shared.test.ts`, `commands/{aggregate,derive-roles,backtest}.test.ts`, `matches.test.ts`, `db/migrate.test.ts`), `docs/{DECISIONS,DATA_MODEL,SPECS,PROGRESS}.md`.
- Tests: `pnpm check` green (typecheck + lint + format + 924 tests). New coverage: numeric ordering (14.9 < 14.10, season change, unsorted input), hotfix dedupe, malformed-entry warning, stable indices after append, consistency refusals (gap, misorder, non-newer missing label), refresh-on-miss (no fetch when covered, one fetch on miss) for `aggregate`/`derive-roles`, all three degradation scenarios, orphan count/label reporting, `gameVersion`->label equivalence, no-orphan-after-ingestion, backtest `patches` isolation, migration 014.
- State left: REVIEW (T-019.b). Behavioral notes: `aggregate`/`derive-roles` now warn-and-proceed when stored labels are orphaned instead of only excluding them silently; `patch-meta.json` appears in exports after the next `aggregate`+`export`; `pnpm etl aggregate` on the real DB will fetch `versions.json` once if any stored label is missing from `patches`.
- Next step: owner review of D-055 implementation; then T-019.d once T-019.b/T-019.c are accepted.
- Pitfalls / notes for next AI: `seedPatches` renumbers contiguously via `comparePatchLabels` — it cannot create gap/misorder fixtures; insert `patches` rows manually for those (and `refreshPatches` will refuse them). `ensurePatchCoverage`/`createPatchResolver`/`refreshPatches` accept `fetchFn`; commands use the global `fetch` (tests `vi.stubGlobal('fetch', ...)`). `patches` must still be populated before aggregates produce rows. BUGS.md: no new bugs found.

### 2026-11-06 — Devin — T-019.c retention prune + `pruned` tombstones + default ingestion window (REVIEW)

- Done:
  - Migration `013_match_rejects_pruned.sql`: rebuilt `match_rejects` so its CHECK accepts `reason='pruned'` (the CHECK from 002 cannot be altered); existing reject rows preserved.
  - New `pnpm etl prune [--keep-patches N] [--dry-run]` (`commands/prune.ts` + `prune.ts`): N defaults to `ETL_CONFIG.retentionPatches` = 20 (new `config/etl-config.ts`, the ETL config home for D-044/D-045/D-047 camelCase names). One transaction upserts a `pruned` tombstone (actual `patch` label, `checked_at`) and deletes each match with `patch_index <= latest - N` (cascade removes `participants`/`item_events`). Idempotent; `--dry-run` counts only; matches whose patch label is absent from `patches` are kept and reported as skipped.
  - `matches-store.ts`: `RejectReason` gains `'pruned'`; `findRejection` returns `pruned` rows unconditionally (never deleted/re-evaluated, whatever `--since-patch`); `clearIngestState` (`--reset`) now keeps `pruned`; new `clearPrunedTombstones` (`--reset-tombstones`).
  - `matches` command: new `--reset-tombstones` flag (help warns pruned matches become fetchable again). Default ingestion window `patch_index >= latest - retentionPatches + 1` applied when `--since-patch` is absent; the `patches` table is refreshed once when still empty so the bound is real (failure -> warn + unbounded, same as before). Explicit `--since-patch` below the bound is a `UsageError` unless `--reset-tombstones`.
  - Docs: SPECS §13 marked live, SETUP command list, DATA_MODEL `match_rejects` reason list/DDL.
- Files touched: `packages/etl/migrations/013_match_rejects_pruned.sql` (new), `packages/etl/src/config/etl-config.ts` (new), `packages/etl/src/{prune.ts,prune.test.ts}` (new), `packages/etl/src/commands/{prune.ts,matches.ts}`, `packages/etl/src/{matches.ts,matches.test.ts,matches-store.ts,patches.ts,cli.ts,index.ts,db/migrate.test.ts}`, `docs/{SETUP,DATA_MODEL,SPECS,TICKETS,PROGRESS,BUGS}.md`.
- Tests: `pnpm check` green (81 files, 904 tests). New coverage: prune cutoff/cascade/tombstone, idempotence, dry-run, manual smaller `--keep-patches`, empty `patches` table, `--reset` keeps `pruned`, `--reset-tombstones` resurrects, widened `--since-patch` does not resurrect, below-bound `--since-patch` usage error, migration 013 preserves rejects and accepts `pruned`.
- State left: REVIEW. Behavioral changes to verify: (1) `matches` without `--since-patch` now applies the retention bound (with the current ~4-patch test fixtures the bound clamps to 1 = no-op; on the real DB it binds once `patches` is populated); (2) `--reset` no longer clears `pruned` tombstones; (3) `pnpm etl prune` deletes data — run `--dry-run` first. The real `data/DraftOrb.sqlite` has an empty `patches` table until the next `matches`/`aggregate` run refreshes it, so `prune` currently reports "nothing to prune".
- Next step: owner review; then T-019.d (blocked on T-019.b + T-019.c acceptance per ticket deps).
- Pitfalls / notes for next AI: `seedPatches` renumbers contiguously from 1, so retention tests need >`retentionPatches` labels to get a real bound (25 labels -> bound `patch_index >= 6`). `pruneMatches` resolves `matches.patch` through `patches`; unresolvable labels are kept, never guessed. `ingestMatches` refreshes `patches` eagerly only when the table is completely empty. BUGS.md: no new bugs found.

### 2026-11-05 — Devin — T-019.b patch index table + `patch_index` switch (REVIEW)

- Done:
  - Migration `012_patches.sql`: `patches(patch_index INTEGER PK, version_label TEXT UNIQUE, released_at INTEGER)` per D-043/SPECS §12. `matches.patch` stays a TEXT label resolved through the table (no new columns).
  - New `packages/etl/src/patches.ts`: `parsePatchLabel`/`parsePatchLabels` (versions.json newest-first -> oldest-first, hotfix collapse, `lolpatch_*` ignored), `refreshPatches` (append-only, existing indices never renumbered), `createPatchIndexLookup`/`lookupPatchIndex`, `ensurePatchesFresh`, `createPatchResolver` (lazy one-fetch-per-run refresh; failed refresh = transient, not `invalid`).
  - Ingestion: `--since-patch` label resolves to `patch_index` (unknown after refresh -> `UsageError`); match labels resolve per match — unknown after refresh -> `invalid` reject (stores the label in `match_rejects.patch`); `patch`-reject re-evaluation and cursor `windowWidened` compare indices (cursor gains `sincePatchIndex`, legacy cursors resolve their label once).
  - Aggregation: `loadPatchWindow` reads `patches` instead of building a dense stored-patch index — recency now follows real patch distance (gaps count); snapshot resolves via the table (unknown -> error); `latestPatch` prefers `patch_index` ordering with numeric fallback; rune `futureGames` compares indices. `aggregate`/`derive-roles` refresh the catalog once when a stored label is missing; `backtest` copies `patches` into its in-memory DB.
  - Docs: D-033 SUPERSEDED by D-043, numeric-compare part of D-017 noted superseded, D-055 PROPOSED (implementation details: label resolution, `currentPatchIndex` = snapshot index else max stored index, lazy refresh, `released_at` NULL), SPECS §3/§12 banner, DATA_MODEL.
- Files touched: `packages/etl/migrations/012_patches.sql` (new), `packages/etl/src/{patches.ts,patches.test.ts,patches.test-helpers.ts}` (new), `aggregate-shared.ts(.test)`, `aggregate.ts`, `aggregate-runes.ts`, `aggregate-baseline-patch.test.ts`, `aggregate-baseline(-helpers).ts(.test)`, `aggregate-pairs-helpers.ts`, `aggregate.test.ts`, `aggregate-runes.test.ts`, `matches-store.ts`, `matches-process.ts`, `matches.ts`, `matches.test.ts`, `matches.test-helpers.ts`, `participants-ingestion.test.ts`, `commands/{aggregate,derive-roles,backtest}.ts`, `commands/{aggregate,derive-roles,backtest}.test.ts`, `db/migrate.test.ts`, `index.ts`, `docs/{DATA_MODEL,DECISIONS,SPECS,TICKETS,PROGRESS}.md`.
- Tests: `pnpm check` green (80 files, 894 tests). New coverage: season-change ordering, hotfix collapse, legacy ignore, append-only refresh, unknown match label -> refresh -> stored / still-unknown -> `invalid`, failed refresh -> transient, unknown `--since-patch` -> usage error, real-distance recency across a collection gap, snapshot filtering by index.
- State left: REVIEW. Recency weights change for the existing 3,311-match DB (patches 16.19-16.22 are contiguous in `versions.json`, so distances are unchanged there; gaps only appear for never-collected patches). `pnpm etl aggregate`/`derive-roles`/`matches` will fetch `versions.json` once on first run to populate `patches`.
- Next step: owner review (D-055 + behavioral change); then T-019.c.
- Pitfalls / notes for next AI: `patches` must be populated before aggregates produce rows — tests seed it via `seedPatches(db, labels)` (contiguous indices; insert rows manually for gap fixtures). `ensurePatchesFresh`/`createPatchResolver` accept `fetchFn` for tests; commands use real `fetch`. `latestPatch` falls back to numeric compare only when NO stored label resolves. BUGS.md: no new bugs found.

### 2026-11-05 — Devin — D-054 accepted + B-060 champion tags fix

- Done:
  - Marked D-054 ACCEPTED in `docs/DECISIONS.md` (insufficient-data pool champions render as list cards with baseline win rate).
  - Fixed B-060: added manual tag entries for Ekko (245) and Sylas (517) in `data/manual/champion-tags.json` so every champion with SUPPORT in `champions.json.roles` is tagged.
  - Updated `packages/etl/src/tags.test.ts` to assert full SUPPORT coverage dynamically (`taggedSupportCount === totalSupportCount`, 100%) instead of hard-coded counts that went stale as `derive-roles` expanded SUPPORT membership.
- Files touched: `docs/DECISIONS.md`, `data/manual/champion-tags.json`, `packages/etl/src/tags.test.ts`, `docs/{BUGS,PROGRESS}.md`.
- Tests: `pnpm validate:tags` PASSED (72 tagged champions, 52/52 SUPPORT coverage, 100%); `pnpm vitest run packages/etl/src/tags.test.ts` green (6 tests); `pnpm check` green (79 files, 873 tests).
- State left: DONE. No open bugs in `docs/BUGS.md`; T-027.a remains REVIEW and D-052 remains PROPOSED.
- Next step: owner review; then T-019.b or D-023 paired-bootstrap validation work.
- Pitfalls / notes for next AI: `validateChampionTagsFile` treats every champion whose `roles` include SUPPORT as required; Ekko/Sylas are SUPPORT-capable flex picks, so they need tag entries even though they are not dedicated supports.

### 2026-11-05 — Devin — Pool unavailable champions as list cards with win rate (owner request, D-054 PROPOSED)

- Done:
  - Replaced the amber "Pool champions not recommended" warning line with in-list cards: `poolUnavailable` entries are joined to `insufficientData` samples and rendered after the ranked "From your pool" recommendations by `RecommendationsList` (pagination counts recommendations + unavailable entries).
  - New `UnavailableChampionCard` shows a "Not recommended" badge plus the reason: insufficient data with formatted `n_eff`/raw games, already picked, or not in the champion catalogue. For insufficient data it also shows the baseline win rate when available (`Win rate —` when the baseline has no weighted evidence).
  - Engine/shared: `InsufficientDataEntry` gains optional `winRate` = baseline `p0` fraction for the user's rank bucket, emitted only when `games_e > 0` (no prior-only 50%). `DRAFT_RESULT_SCHEMA_VERSION` stays 1 (additive optional field; D-054 PROPOSED).
  - Docs: SPECS §7/§7.1, DECISIONS D-054, BUGS B-060 (pre-existing tags validation failure).
- Files touched: `packages/shared/src/schemas/draft.ts`, `packages/shared/test/index.test.ts`, `packages/engine/src/recommend.ts`, `packages/engine/test/recommend-ranking.test.ts`, `apps/web/src/{strings.ts,pool/unavailable.ts,pool/unavailable.test.ts,components/{DraftScreen,RecommendationsList,UnavailableChampionCard}.tsx,components/{unavailable-champion-card.test.ts,recommendations-list.test.ts}}`, `docs/{SPECS,DECISIONS,BUGS,PROGRESS}.md`.
- Tests: `pnpm check` typecheck/lint/format green; targeted vitest green (49 tests); `pnpm test` still has the pre-existing B-060 failure (`champion-tags.json` missing Ekko/Sylas SUPPORT), unrelated to this change.
- State left: DONE pending owner review. D-054 is PROPOSED (winRate = shrunk baseline `p0`, schemaVersion unchanged).
- Next step: owner review; decide D-054 and fix B-060 (tag Ekko/Sylas or adjust role derivation) before the next `pnpm check` can be green. Then T-019.b.
- Pitfalls / notes for next AI: unavailable pool cards are filtered out when the champion is the user's own pick (`user.championId`), matching `excludePick`; `winRate` is omitted for missing/empty baseline rows so a 50% prior is never shown as data.

### 2026-11-05 — Devin — First real match-data collection (ops, no ticket)

- Done:
  - Verified the refreshed Riot dev key (`check-key euw1`), ran `migrate` (11 migrations), `players euw1` (850 players: 250 Emerald / 250 Diamond / 150 Master / 100 Grandmaster / 100 Challenger).
  - `matches euw1 --limit=250` (top rank_score first: Challenger + Grandmaster + top Master), ~3 h: 250/250 players, 3,311 matches stored, 1,597 duplicates, 91 filtered, 1 invalid, 0 failures.
  - `aggregate` + `derive-roles` + `export` (16.22 published, `latest.json` moved forward; 16.21 re-exported). Exports now carry real aggregates, `pick-rate.json` and SUPPORT rune files.
  - OTP prototype (owner idea, not ticketed): champion+role concentration query over `participants` confirmed many true one-tricks (e.g. Senna/Sona SUPPORT at 100%, Thresh 97%, Bard 91%); all are Master+ rank, so an OTP weighting feature would need an ADR against the rank kernel. Possible follow-up: `pnpm etl otp` report, then optional aggregation weight.
- Files touched: `data/DraftOrb.sqlite` (gitignored), `data/public/{latest.json,16.21/*,16.22/*}`, `docs/PROGRESS.md`.
- Tests: none (ops run; export/aggregate paths already covered).
- State left: DONE. `data/public` exports reflect the full match set; remaining 600 discovered players not yet ingested.
- Next step: owner review; then T-019.b. Re-run `matches` (no `--limit`) later to ingest Emerald/Diamond players if wanted.
- Pitfalls / notes for next AI: `matches` has no tier filter — `--limit` slices by `rank_score` DESC after done-cursor sorting, so it picks the highest ranks, not a chosen tier. Dev-key pace ≈ 45 s/player for 20 matches + enrichment.

### 2026-11-05 — Devin — Pool editor champion browser with avatars (owner request, D-053)

- Done:
  - Replaced the pool editor's ChampionPicker dropdown + chip list with `ChampionGrid`: the whole champion catalogue as an avatar grid, filterable by name, click-to-toggle membership, selected champions pinned first and highlighted, off-role picks marked amber. Pool stays Support-only (Phase 1, D-024); max size and working-copy/save semantics unchanged.
  - Avatars come from the Data Dragon CDN (D-053): `data/champion-icons.ts` maps the export patch label to the newest full version via `api/versions.json` (cached per session) and builds `cdn/<version>/img/champion/<icon>` URLs; all failures degrade to a letter placeholder.
  - `DraftScreen` resolves the icon version alongside the data load and passes it to `PoolEditor`; unused picker strings removed; modal widened to `max-w-3xl`.
- Files touched: `apps/web/src/data/{champion-icons.ts,champion-icons.test.ts}` (new), `apps/web/src/components/{ChampionGrid.tsx,champion-grid.test.ts}` (new), `apps/web/src/components/{PoolEditor,DraftScreen}.tsx`, `apps/web/src/strings.ts`, `docs/{DECISIONS,PROGRESS}.md`.
- Tests: `pnpm check` green (77 files, 864 tests); new coverage for version resolution, icon URLs and grid rendering/order/placeholder fallback.
- State left: DONE pending owner review. Dev server verified serving; visual check of the grid in the browser preview is on the owner.
- Next step: owner review; then T-019.b.
- Pitfalls / notes for next AI: `api/versions.json` is newest-first, so `resolveIconVersion` takes the first `major.minor.*` match; Data Dragon `img/champion/square/` returns AccessDenied — only `img/champion/<Icon>.png` (128x128) works.

### 2026-11-05 — Devin — PR #47 follow-up review fix (unscored report counts)

- Done:
  - B-059: the all-unscored backtest branch now preserves the evaluated fallback sample size instead of reusing the early-exit `insufficient()` counts; `predictions`/`unscored` equal `points.length` and `perRole` carries the same counts while loss metrics stay null.
- Files touched: `packages/etl/src/{backtest/draft.ts,backtest/draft.test.ts}`, `docs/{BUGS,PROGRESS}.md`.
- Tests: `pnpm check` green (75 files, 855 tests); all-unscored regression now asserts 24 predictions / 24 unscored with TOP and SUPPORT at 12 each.
- State left: DONE pending review/commit (branch `bugs`). T-027.a stays REVIEW; the report remains `unvalidated` until the D-023 paired-bootstrap gate and remaining validation metrics exist.
- Next step: owner review; then T-019.b or D-023 gate work.
- Pitfalls / notes for next AI: `unscored <= predictions` must hold even when `insufficientData` is true; early exits before evaluation still report zero counts.

### 2026-11-05 — Devin — PR #47 review fixes (backtest rank + unscored gate)

- Done:
  - B-057: the draft backtest now evaluates holdout players at `matches.avg_rank_score` (`DraftRow.matchRankScore`) for both `userRank` and the champion-baseline lookup, matching the rank context used by every aggregate table; NULL `participants.rank_score` no longer becomes IRON through `gameBucketIndex`.
  - B-058: `runBacktestDraft` returns the insufficient-data report when every holdout point is an unscored baseline fallback, instead of publishing metrics equal to the fallback baseline; mixed scored/unscored reports keep the paired fallback points and `unscored` count.
  - Added the missing public-function JSDoc to `pickRateFile` and aligned `roleProbFile` (CONVENTIONS.md).
- Files touched: `packages/etl/src/{commands/backtest.ts,commands/backtest.test.ts,backtest/draft.ts,backtest/draft.test.ts,export/pick-rate.ts,export/role-prob.ts}`, `docs/{BUGS,PROGRESS}.md`.
- Tests: `pnpm check` green (75 files, 855 tests). New regressions: all-unscored holdout report, match-rank evaluation with NULL participant ranks, and a 30-match command seed (the old 5-match seed was itself all-unscored under `minGames = 25`).
- State left: DONE pending review/commit (branch `bugs`). T-027.a stays REVIEW: masked drafts, rolling validation, fixed-Diamond report, layer/slot ablation and the D-023 paired-bootstrap gate remain outstanding; report stays `unvalidated`.
- Next step: owner review; then T-019.b or D-023 gate work.
- Pitfalls / notes for next AI: scored backtest recommendations need `n_eff >= minGames` (25), stricter than `exportMinGames` (10); tiny training windows now correctly report insufficient data. `data/public/16.21` and `16.22` intentionally share aggregate evidence because aggregate tables are not patch-scoped, and `lane-full.json` is empty because no SUPPORT lane_full row reaches `exportMinGames` in the current sample.

### 2026-11-05 — Devin — Bug fix B-052 (real aggregate sample export)

- Done:
  - Reproduced B-052: the committed `data/public/16.21` export held a single baseline row (`[412,"IRON",6,10,10,3]`, n_eff 10 < `minGames` 25) and a one-champion `role-prob.json`; `recommend` returned 0 recommendations for every draft.
  - Wrote failing regression test `packages/etl/src/export/sample-export.test.ts`: loads the published export (`latest.json` -> manifest -> listed files) through the web loader's schemas and asserts `recommend` returns a non-empty "Best overall" list per exported role at Diamond. Failed before the fix (0 recommendations), passes after.
  - Fix is data, not code: ran `pnpm etl aggregate` on `data/DraftOrb.sqlite` (now populated: 883 matches, euw1, patches 16.19–16.22) then `pnpm etl export` -> patch 16.22 (latest.json moved 16.21 -> 16.22 via the D-051 pointer rule) and `pnpm etl export 16.21` so the previously degenerate committed dir also carries real aggregates. Both exports now include `pick-rate.json` and SUPPORT rune files.
- Files touched: `packages/etl/src/export/sample-export.test.ts` (new), `data/public/{latest.json,16.21/*,16.22/*}`, `docs/{BUGS,PROGRESS}.md`.
- Tests: `pnpm check` green (75 files, 853 tests).
- State left: DONE pending review/commit (branch `bugs`). `data/public/backtest-draft.json` and `data/public/16.22/` were already untracked before this session; the backtest report is still the empty placeholder (T-027.a stays REVIEW) — left untracked, regenerate with `pnpm etl backtest draft` when needed.
- Next step: owner review; then T-019.b. Re-run `pnpm etl aggregate && pnpm etl export` after ingestion finishes to refresh the sample with the final match set.
- Pitfalls / notes for next AI: aggregate tables are not patch-scoped — exporting an older patch (`pnpm etl export 16.21`) warns and labels current aggregates with that patch; `latest.json` only moves forward. The DB was being written during this session (match counts grew between queries), so exported numbers are a snapshot.

### 2026-11-05 — Devin — Bug fix B-026 (pick-rate export for `blindSafety`)

- Done:
  - Reproduced B-026: `blindSafety` approximated `pickShare(e)` with `roleProb[e][role]` (share of the champion's own games in that role), so real popular picks with low role share were filtered out by `blindOpponentMinShare`.
  - New global `pick-rate.json` export (`packages/etl/src/export/pick-rate.ts`): per-role shares from `role_prob.games_w`, gated per cell by `n_eff >= exportMinGames`, renormalized per role to sum 1; written by `exportJson` next to `role-prob.json` and listed in the manifest (no schemaVersion bump — additive file).
  - Shared: `pickRateSchema`/`PickRate` (role -> championId -> share, per-role sum 1); `RecommendData.pickRate` optional so pre-existing exports keep the roleProb fallback.
  - Engine: `blindOpponents`/`computeBlindSafety` accept an optional `pickRate` (trailing param); `recommend` passes `data.pickRate`. Web `createRecommendData` loads `pick-rate.json` when present; the backtest's `RecommendData` always carries real pick rates.
  - Docs: SPECS §5, DATA_MODEL export layout, DECISIONS D-052 (PROPOSED: pick-share source/scope/threshold/fallback assumptions), BUGS B-026 FIXED.
- Files touched: `packages/shared/src/schemas/{champions,recommend-data}.ts`, `packages/shared/src/index.ts`, `packages/shared/test/recommend-data.test.ts`, `packages/engine/src/{recommend-terms,recommend,config,recommend-test-utils}.ts`, `packages/engine/test/{recommend-terms,recommend-blind-comp}.test.ts`, `packages/etl/src/export/{pick-rate,pick-rate.test,index,manifest.test,atomic.test}.ts`, `packages/etl/src/backtest/recommend-data.ts`, `apps/web/src/data/{recommend-data,recommend-data.test}.ts`, `docs/{SPECS,DATA_MODEL,DECISIONS,BUGS,PROGRESS}.md`.
- Tests: `pnpm check` green (74 files, 851 tests); new regression tests failed before the fix.
- State left: DONE pending review/commit (branch `bugs`). Note: `data/DraftOrb.sqlite` was not touched (parallel work); published `data/public/<patch>/` exports gain `pick-rate.json` on the next `pnpm etl export` — until then the web keeps the roleProb fallback.
- Next step: owner review; then T-019.b. Re-run `pnpm etl aggregate && pnpm etl export` once the DB is free to populate pick-rate.json; D-052 needs owner acceptance.
- Pitfalls / notes for next AI: pick shares are global across rank buckets/platforms (role_prob has no split); `blindOpponentMinShare` (0.05) now applies to pick-share values, which are much smaller than roleProb values — retune via T-027.a if needed. `pickRate: {}` (export with no gated rows) disables blind safety rather than falling back — deliberate, the export is authoritative when present.

### 2026-11-05 — Devin — Bug fix B-053 (draft backtest evaluates the deployed engine)

- Done:
  - Reproduced B-053: `runBacktestDraft` trained a private per-champion win-rate model on raw `DraftRow`s and predicted blue-team win probability — its log-loss never touched `recommend`.
  - `runBacktestDraft(rows, engine)` now runs `recommend` once per holdout participant on the full draft (nine known picks with fixed roles, `blindPick: false`) and scores the champion actually picked; unscored picks fall back to the champion's baseline-only prior so the comparison stays paired. Metrics are per-player log-loss/Brier/calibration vs the champion baseline; report gains `predictions`/`unscored` and per-role metrics (old `perRole` matchup effects were win-rate-model specific).
  - New `backtest/recommend-data.ts` rebuilds per-role `RecommendData` from aggregates computed in a throwaway in-memory DB holding only pre-holdout matches (same aggregators, `exportMinGames` gate, role-prob renormalization as the JSON export); `commands/backtest.ts` wires it via ATTACH + migrate + aggregate, so the real aggregate tables are never touched.
- Files touched: `packages/etl/src/backtest/{draft,draft.test,recommend-data,recommend-data.test}.ts`, `packages/etl/src/commands/backtest.ts`, `packages/etl/src/export/role-tables.ts` (exported `WeightedRow`), `docs/{BUGS,TICKETS,PROGRESS}.md`.
- Tests: `pnpm check` green (73 files, 836 tests); new regression coverage fails on the old win-rate model.
- State left: DONE pending review/commit (branch `bugs`). T-027.a stays REVIEW: masked drafts, rolling validation, fixed-Diamond report, layer/slot ablation and the D-023 paired-bootstrap gate remain outstanding; report stays `unvalidated`.
- Next step: owner review; then T-019.b or D-023 gate work.
- Pitfalls / notes for next AI: the backtest command needs `data/manual/champion-tags.json` (fails loudly without it) and never writes to the source DB — aggregates run on an in-memory copy minus the holdout patch. `runBacktestDraft` requires the second `BacktestEngineData` argument; holdout = latest patch, training snapshot = last training patch.

### 2026-11-05 — Devin — Bug fix B-056 / T-036 (web production build ordering + CI gate)

- Done:
  - Reproduced B-056 from a clean state (all `dist/` and `*.tsbuildinfo` removed): `pnpm --filter @draftorb/web build` failed with TS6305 (`packages/{shared,engine}/dist/index.d.ts has not been built from source`) plus cascading type errors, while PR CI stayed green because it never ran the production build.
  - Root cause: `apps/web/tsconfig.json` project-references the composite `packages/shared`/`packages/engine`, so `tsc` redirects their `src/index.ts` entry points to `dist/*.d.ts`; `tsc --noEmit` (non-build mode) requires those outputs. Root `pnpm typecheck` (`tsc --build`) builds them, masking the gap locally.
  - Fix: `apps/web` `build` and `typecheck` scripts now run `tsc -b .` — build mode emits the referenced projects' declarations, then type-checks the app (`noEmit` preserved, `composite: false` untouched). No type-safety weakening, no stale-file reliance.
  - CI gate: `.github/workflows/ci.yml` lint job now runs `pnpm --filter @draftorb/web build` on PRs and pushes to main.
  - Regression test `apps/web/src/build-script.test.ts` pins the build-mode ordering in the package scripts.
- Files touched: `apps/web/package.json`, `apps/web/src/build-script.test.ts` (new), `.github/workflows/ci.yml`, `docs/{TICKETS,BUGS,PROGRESS}.md`.
- Tests: `pnpm check` green (72 files, 830 tests); `pnpm --filter @draftorb/web build` verified green from a clean state.
- State left: DONE pending review/commit (branch `bugs`).
- Next step: owner review; then T-019.b.
- Pitfalls / notes for next AI: any `tsc` invocation inside `apps/web` must use build mode (`tsc -b .`) or the referenced `dist/*.d.ts` must already exist — plain `tsc --noEmit`/`tsc -p` fails on a clean checkout. `tsc -b` writes `dist/` + `*.tsbuildinfo` for shared/engine (both gitignored). The deploy workflow still runs on push to main in parallel with CI; it is not gated on the CI build job.

### 2026-11-05 — Devin — Bug fix B-021 (engine/shared type-check isolation)

- Done:
  - Reproduced B-021: `export const probe = process.cwd()` in `packages/engine/src/` passed `pnpm typecheck` because test files in `src/` import vitest, whose types pull `@types/node` globals into the production program.
  - Moved all engine/shared unit tests out of `src/` into `packages/engine/test/` and `packages/shared/test/` (vitest types transitively require Node types, so every vitest test is "Node-dependent" per CONVENTIONS.md); rewrote relative imports to `../src/...`; added `packages/shared/test/tsconfig.json`; `pnpm typecheck` now also runs `tsc -p packages/shared/test`.
  - Kept `"exclude": ["src/**/*.test.ts"]` in both production tsconfigs as a guard; `process` in engine sources now fails with TS2591.
  - New regression test `packages/engine/test/typecheck-isolation.test.ts` builds both production programs via the TypeScript API and asserts no `@types/node` file is loaded (failed before the move, passes now).
  - Updated CONVENTIONS.md test-location rule and BUGS.md (B-021 FIXED).
- Files touched: `packages/engine/test/*.test.ts` (moved from `src/`, imports rewritten), `packages/shared/test/*` (moved + new `tsconfig.json`), `packages/{engine,shared}/tsconfig.json`, `package.json`, `packages/engine/test/typecheck-isolation.test.ts` (new), `docs/{BUGS,CONVENTIONS,PROGRESS}.md`.
- Tests: `pnpm check` green (71 files, 828 tests).
- State left: DONE pending review/commit.
- Next step: owner review; then T-019.b.
- Pitfalls / notes for next AI: engine/shared tests must never live in `src/` again — vitest's type declarations import `node:*` and reintroduce `@types/node` globals; the `typecheck-isolation` test and the tsconfig `exclude` guard both catch it. ETL and web tests still live next to source (their tsconfigs allow Node/DOM types).

### 2026-11-05 — Devin — PR #46 review fixes (third pass)

- Done:
  - `exportJson` `latest.json` guard now also reads the published pointer in `publicDir`: a newer existing `latest.json` is preserved (with a warning) even when the database is empty or its latest match patch is older than the pointer — but only while the pointer is intact (its manifest exists, validates, and names the same patch); a dangling pointer does not block an eligible export (B-055, S3).
  - `ChampionPicker` returns focus to its trigger button on Escape so keyboard navigation does not restart from the document (B-055, S4).
- Files touched: `packages/etl/src/export/index.ts`, `packages/etl/src/export/atomic.test.ts`, `apps/web/src/components/ChampionPicker.tsx`, `docs/BUGS.md`, `docs/PROGRESS.md`.
- Tests: `pnpm check` green (70 files, 824 tests); three new export pointer tests in `atomic.test.ts`.
- State left: DONE pending review/commit (branch `feature/t-029-to-t-034`).
- Next step: owner review of PR #46; then T-019.b.

### 2026-11-04 — Devin — T-019.d verification step (CommunityDragon change-score prototype)

- Done: scratch prototype (outside the repo) of the SPECS §15 algorithm run on CommunityDragon 16.20 -> 16.21 and 16.21 -> 16.22 for the 173 Data Dragon catalog champions, catalog items and perks.
  - Champions 16.20 -> 16.21: raw files changed for 145, allowlisted changes for 21. Scores: Varus 1, Locke 1, Caitlyn 0.4154, MonkeyKing 0.4107, MissFortune 0.3543, Viktor 0.2682, Sion 0.2662, Taliyah 0.2419, Nunu 0.2104, Ryze 0.2027, Nidalee 0.1665, XinZhao 0.1625, Rammus 0.1412, Azir 0.125, Velkoz 0.1111, Tristana 0.0918, Qiyana 0.0914, Orianna 0.0767, Jinx 0.0543, LeeSin 0.0527, Yone 0.0227.
  - Champions 16.21 -> 16.22: raw files changed for 53, allowlisted changes for 15. Scores: Orianna 1 (internal refactor, see below), Mel 1, Varus 0.9442, AurelionSol 0.4497, Thresh 0.3333, Aurora 0.3, Smolder 0.2216, Naafiri 0.1943, Locke 0.1611, Viktor 0.125, Maokai 0.0949, Corki 0.0804, Rumble 0.0714, Shen 0.0551, Yasuo 0.0238.
  - Items: 15 (16.21) and 2 (16.22) changed catalog items before the Summoner's Rift filter (e.g. 3008 price 700 -> 800; 1086 AD 8 -> 7; 2501 AD 30 -> 40). Runes: no value change in either pair.
  - False positives found and fixed in the spec: `Jade_*` game-mode champions (now limited to the catalog); hashed names resolved between patches (now compared in FNV-1a form, algorithm confirmed on `DamageType` = `{72c5c2a8}`); item `mDataValues` keyed by position (now by `mName`); one value repeated in sub-spells (Qiyana Q 0.37 -> 0.09, Caitlyn 1 -> 0.42; now counted once); child missile spells added/renamed (Veigar, Lux 0.6 -> 0; root spells only).
  - Remaining false-positive class: internal data refactors with the same in-game effect (16.22 Orianna `ReducedDamagePercent` 30 -> 0.7 with recalculated formulas). Handled by rejecting the suggested breakpoint (D-047).
  - Folder lifetime: 16.20 files last changed 2026-10-19 (folder created 10-07), none after the 16.21 release (10-21); 16.21 files changed again on 10-31 (`Jade_Amumu`, `champion-summary.json`). Rule added: scores for the live patch are provisional.
  - Docs: SPECS §15 rewritten with the refinements and results, D-046 verification update, RIOT_API.md VERIFY items resolved (`maps["11"]` confirmed on Data Dragon 16.21.1; the published `items.json` does not keep `maps`), T-019.d step 1 updated.
- Files touched: `docs/SPECS.md`, `docs/DECISIONS.md`, `docs/RIOT_API.md`, `docs/TICKETS.md`, `docs/PROGRESS.md`.
- Tests: none (docs and a scratch prototype only); `pnpm format:check`.
- State left: T-019.d step 1 done except the comparison with the official patch notes (owner).
- Next step: owner checks the two lists above against the 16.21 and 16.22 patch notes; then T-019.b -> T-019.e -> T-019.d.
- Pitfalls / notes for next AI: CommunityDragon arrays hold 7 entries (rank 0..6), so a per-rank change is averaged over 7; `items.cdtb.bin.json` is about 16 MB per patch.

### 2026-11-04 — Devin — D-046 rewritten for CommunityDragon and accepted

- Done: D-046 ACCEPTED (owner). Change scoring now reads CommunityDragon game data (Data Dragon champion files have no ability values; verified on 16.22.1) with an allowlist of balance fields, float32 rounding, name-keyed data values and no text comparison. Manual breakpoints ship first: T-019.e now depends on T-019.b, T-019.d on T-019.e and starts with a patch-notes verification step; T-019.f works with manual breakpoints alone. Updated DECISIONS D-046/D-047, SPECS §15/§17, RIOT_API.md, TICKETS T-019.d/e/f.
- Files touched: `docs/DECISIONS.md`, `docs/SPECS.md`, `docs/RIOT_API.md`, `docs/TICKETS.md`, `docs/PROGRESS.md`.
- Tests: `pnpm format:check`.
- State left: DONE.
- Next step: T-029 (small) or T-019.b; for change weighting the order is T-019.b -> T-019.e -> T-019.d -> T-019.f.
- Pitfalls / notes for next AI: CommunityDragon is community-run; numeric rune values were not located yet (VERIFY in T-019.d). `items.cdtb.bin.json` is about 16 MB.

### 2026-11-04 — Devin — D-044 accepted with 20-patch retention

- Done: D-044 ACCEPTED (owner): `retentionPatches` default 8 -> 20, `prune --keep-patches` defaults to it, manual smaller cut documented (tombstones block re-ingestion; global reset breakpoint is the reversible alternative). Updated DECISIONS D-044, SPECS §13, T-019.c.
- Files touched: `docs/DECISIONS.md`, `docs/SPECS.md`, `docs/TICKETS.md`, `docs/PROGRESS.md`.
- Tests: `pnpm format:check`.
- State left: DONE.
- Next step: owner decision on D-046 data source.

### 2026-11-04 — Devin — Owner decisions on PROPOSED ADRs

- Done:
  - DECISIONS.md: D-034, D-035, D-043, D-045, D-047, D-048, D-049, D-050 (with the owner rationale) and D-051 marked ACCEPTED (owner decision 2026-11-04); D-031 header simplified to SUPERSEDED by D-035; D-043 gained an implementation note (ignore legacy `lolpatch_*` entries in `versions.json`); D-047 notes that manual breakpoints do not depend on D-046.
  - D-044 and D-046 kept PROPOSED with review notes: D-044 default retention prunes ≈ 27% of the recency weight mass; D-046 relies on Data Dragon champion files whose ability values are empty (checked on 16.22.1 `Ahri.json`).
  - TICKETS/DATA_MODEL/ARCHITECTURE: dropped the PROPOSED tags for the accepted decisions.
- Files touched: `docs/DECISIONS.md`, `docs/TICKETS.md`, `docs/DATA_MODEL.md`, `docs/ARCHITECTURE.md`, `docs/PROGRESS.md`.
- Tests: `pnpm format:check`.
- State left: DONE.
- Next step: owner answers on D-044/D-046; then T-029 or T-019.b.

### 2026-11-04 — Devin — Docs audit cleanup (audit batch 4)

- Done:
  - TICKETS.md: T-015.b cross-reference fixed (D-032 -> D-034); T-024 and T-025 marked DONE (acceptance met by existing engine tests and golden fixtures); T-026 kept TODO with a partial-implementation note; new T-029 (export latest-patch pointer, D-051).
  - DECISIONS.md: entries reordered by number; D-031/D-033 headers corrected to reflect real status; status notes added to D-035/D-049/D-050; D-037..D-042 gap documented; new D-051 PROPOSED (latest.json pointer).
  - BUGS.md: B-027 moved from the Open table to Fixed (documented duplicate); duplicate-ID section rewritten without line numbers and extended with B-035; review-history paragraphs moved to a new end-of-file section.
  - PROGRESS.md: misplaced session entries moved into the session log; the two T-019 review follow-up entries merged (same work pre/post rebase); entries before 2026-10-29 archived to PROGRESS_ARCHIVE.md; open questions now list the PROPOSED decisions.
  - ARCHITECTURE.md: status line rewritten to current state; data flow updated to the D-051 latest.json flow (marked not-yet-implemented).
  - DATA_MODEL.md: planned tables/columns marked inline (patches, entity_change_scores, data_breakpoints, pruned reason); `is_expert` comment corrected (never written).
  - SPECS.md: duplicated §12-17 intro paragraphs merged.
- Files touched: `docs/*.md` only (no code).
- Tests: `pnpm format:check` clean; `git diff --stat` limited to docs.
- State left: DONE pending review/commit (branch `docs/audit-cleanup`).
- Next step: T-019.b (retention model migration) or T-029.

### 2026-11-04 — Devin — T-028 aggregation helpers refactor (audit batch 3)

- Done:
  - New `aggregate-shared.ts` (PATCH_PATTERN home, `assertPatchFormat`, `loadPatchWindow`, `gameBucketIndex`, `accumulateWeighted`, `groupRowsByMatch`, `partitionByTeam`) used by all four aggregators; stale "D-033" references fixed to D-035.
  - File-size splits (every touched file now at or under 300 lines): `aggregate-runes-context.ts`, `aggregate-pairs-write.ts`, `influence-config.ts` (engine), `matches-reprocess.ts`, `players-tiers.ts`, `ddragon-transform.ts`, `riot/client-options.ts`.
  - Lint: 0 warnings — `aggregate.test.ts` non-null assertions replaced by `requireRow`/`requireAt` helpers.
  - Package `exports["."]` gained a `default` condition in shared/engine/etl.
- Files touched: new modules + tests above; `aggregate{,-baseline,-pairs,-runes}.ts`, `matches.ts`, `players.ts`, `ddragon.ts`, `riot/client.ts`, `config.ts`, `aggregate.test.ts`, 3 package.json; docs TICKETS/PROGRESS.
- Tests: `pnpm check` green (see report); new `aggregate-shared.test.ts` (12 tests).
- State left: DONE pending review/commit (branch `refactor/etl-aggregation-helpers`).
- Next step: T-019.b (retention model migration).

### 2026-11-03 — Devin — Bugs B-044..B-049

- Done:
  - B-044: `ingestMatches` now awaits the unenriched-match reprocess pass; `minChampGames` defaults unified on `DEFAULT_CONFIG.minChampGames`.
  - B-045: `formatHelp` two-line layout; `PLANNED_COMMANDS` lists only `backtest`; `cli.ts` env comment fixed.
  - B-046: `deriveChampionRoles`/`applyDerivedRoles` keep roles with `prob >= roleProbThreshold` with a highest-role fallback.
  - B-047: rune aggregation validates `champion-tags.json` via `championTagsMapSchema` and throws `Cannot load champion tags from <path>` on any failure (`tagsPath` option added).
  - B-048: shared `dbPathFromEnv`/`DB_ENV_VAR`/`DEFAULT_DB_FILENAME` in `config/paths.ts`; `aggregate` uses `openDb`, `derive-roles` opens read-only, both refuse pending migrations; aggregate prints a single role_prob summary line.
  - B-049: `exportRoleProbabilities` (renamed) assigns the rounding residual to the largest surviving role; duplicate validation removed.
  - Docs: BUGS.md B-044..B-049 FIXED, SETUP.md command list + pending-migration note, DATA_MODEL.md threshold + residual wording, DECISIONS D-034 consequence.
- Files touched: `packages/etl/src/matches.ts`, `enrichment.ts`, `commands/shared.ts`, `cli.ts`, `derive-roles.ts`, `aggregate-runes.ts`, `config/paths.ts`, `commands/{aggregate,derive-roles,export,status,migrate}.ts`, `export/role-prob.ts`; tests `matches.test.ts`, `derive-roles.test.ts`, `aggregate-runes.test.ts`, `commands/shared.test.ts` (new), `commands/aggregate.test.ts`, `export/region-and-config.test.ts`; docs above.
- Tests: new/updated tests failed before the fixes (16 failures) and pass after.
- State left: DONE pending review/commit (branch `fix/etl-review-findings`).
- Next step: T-019.b (retention model migration).

### 2026-11-03 — Devin — Bug B-043

- Done:
  - Reserved the user's role during ally role inference: `inferRoles` gained `excludedRoles`, `resolveKnownSlots` gained `reservedRoles`, and `recommend` passes `[userRole]` for the ally team (D-050, PROPOSED).
  - Allies fixed to `userRole` are dropped from role-dependent layers (pairs, lane) but still count for comp and stay excluded from candidates; unfixed allies that can only play the reserved role are dropped by the existing viable-subset fallback.
  - Documented the behavior in SPECS §4 and recorded the fix in BUGS.md (B-043, FIXED).
- Files touched: `packages/engine/src/roles.ts`, `recommend-role-conflicts.ts`, `recommend-slots.ts`, `recommend.ts`; tests `roles.test.ts`, `recommend-slots.test.ts`, `recommend-pairs.test.ts`, new golden `test/golden/support_ally_flex_reserved_role.json`; docs `SPECS.md`, `DECISIONS.md`, `BUGS.md`, `PROGRESS.md`.
- Tests: new B-043 tests failed before the fix (8 failures) and pass after; engine suite green.
- State left: DONE pending review/commit (branch `fix/b-043-ally-role-reservation`).
- Next step: T-019.b (retention model migration).

### 2026-11-04 — Devin — T-035 review follow-ups

- Done:
  - Dev data server: path resolution extracted to `apps/web/src/dev/data-path.ts`; serves only `.json` files inside `data/public` (plus manual champion tags), GET/HEAD only; traversal regression tests.
  - Export: `latest.json` is written atomically (temp file + rename, `writeFileAtomic`) so a failed write keeps the previous pointer; regression test.
  - Backtest: rank buckets use the persisted D-016 scale via `gameBucketIndex` (was collapsing every match into IRON); fixtures use real rank scores.
  - Web: "From your pool" renders engine `poolRecommendations` (keeps `poolRank`); the user's own pick is excluded from both lists; the champion picker clears its search after selection.
  - T-029 marked DONE (implemented in T-035).
- Open: B-052 (sample export below `minGames`, needs real aggregates) and B-053 (backtest does not evaluate `recommend`).
- Validation: not run in this session; run `pnpm check`.

### 2026-11-04 — Copilot — T-035 review fixes

- Done:
  - Fixed manifest/patched export URLs, validated and connected recommendation data, and published manual champion tags in dev/build/deploy.
  - Persisted and restricted the Phase 1 Support pool, surfaced storage and engine failures, reset pagination on draft changes, and centralized UI text.
  - Corrected backtest baseline leakage and match counts; reports now remain explicitly unvalidated until the D-023 paired-bootstrap gate exists.
  - Added regression tests for data loading, recommendation inputs, pool storage, draft rendering, pagination reset, report gating and backtest behavior.
  - Updated T-035 and related status/decision/bug documentation.
- Validation: `pnpm check` passed (65 test files, 754 tests); lint has existing non-null assertion warnings. Production build and public-data asset verification also passed.

### 2026-11-03 — Copilot — T-019 review follow-up rebase

- Done:
  - Fixed paired aggregate exports to serialize `other_role`.
  - Kept rune pages grouped and exported by rank bucket; bumped the manifest contract to schema v3 (D-049 is PROPOSED).
  - Adjusted role-probability rounding residuals deterministically and validate the final sparse maps against the shared schema.
  - Warned when explicit patch labels differ from the latest stored patch and when aggregates span multiple platforms, including with an explicit region label.
  - Kept successful publication successful when backup cleanup fails; preserve the backup and return a warning.
  - Retained catalog files and role snapshots across exports, and invalidated manifests before static catalog writes.
- Files touched: export orchestration/builders/IO and tests, shared rune/manifest schemas and tests, catalog-writing commands and tests, `DATA_MODEL.md`, `DECISIONS.md`, `TICKETS.md`, `BUGS.md`, and this log.
- Tests: focused export/shared tests pass (12 files, 95 tests); `pnpm check` passes (55 files, 710 tests); lint reports 0 errors and 15 pre-existing warnings.
- State left: DONE (T-019 review follow-up implemented; D-049 awaits owner decision).
- Next step: T-019.b (patches table, label mapping, patch_index switch, --since-patch).
- Pitfalls / notes: (merged with the 2026-11-02 Copilot "T-019 review follow-up" entry, which described the same work before the rebase; test counts above are post-rebase) manifest schema v2 is no longer accepted; rune consumers must read `rankBucket` on each context.

---

### 2026-11-01 — PR #42 redesign: storage/weighting/change-detection made coherent (docs only)

- Done:
  - **`docs/DECISIONS.md`** (edited): Replaced old D-043..D-049 (ACCEPTED) with new D-043..D-048 (PROPOSED): patches table (D-043), retention/prune (D-044), single weight formula (D-045), automatic change score (D-046), breakpoints (D-047), no separate smoothing (D-048). D-049 removed (content folded into Alternatives). No fabricated owner decisions or dates.
  - **`docs/SPECS.md`** (edited): §3 recency references `patches` table (D-043); removed §14 DECAY/p0 note; replaced sections 12-18 with target-model sections 12-17 (patch index, retention/prune, weights, change score, breakpoints, edge cases) preceded by a target-model banner.
  - **`docs/TICKETS.md`** (edited): Replaced single T-019.b with session-sized chain T-019.b..f; T-019 (export) unblocked.
  - **`docs/DATA_MODEL.md`** (edited): Added `patches`, `entity_change_scores`, `data_breakpoints` DDL with CHECKs and unique index; aggregated tables recomputed each run with weights baked in; exports unchanged note.
  - **`docs/TESTING.md`** (edited): Added section 6 (retention, weights, change scoring, breakpoints) with property checks and real-JSON fixture rule.
  - **`docs/RIOT_API.md`** (edited): Expanded Data Dragon static data row; added VERIFY markers.
- Tests: `pnpm check` green (typecheck, lint 0 errors, format 0 errors). No code changed.
- State left: **Docs-only redesign complete**. `BUGS.md` unchanged (no bugs found).
- Next: Owner review of PROPOSED ADRs; then schedule T-019.b.

### 2026-11-01 — PR #42 docs completion: T-019.b ticket, downweight precedence, loose ends

- Done:
  - **`docs/TICKETS.md`** (edited): Replaced "Future work" paragraph with `T-019.b | Retention model migration (L)` in E1 ETL; deps `T-019, T-015..T-018, T-002.b`; acceptance mirrors `docs/TESTING.md` expected tests.
  - **`docs/SPECS.md`** (edited): §18 documents overlapping `downweight` precedence (multiply `weight_factor`s floored at `MIN_WEIGHT`; `reset` dominates; same rule regardless of `from_patch_index`); §18 hotfix line reworded (weights never stored, nothing "kept"); §14 note confirms `DECAY` 0.7 vs `decay` 0.85 and data-driven `p0` vs fixed 0.5 prior are intentional.
  - **`docs/DECISIONS.md`** (edited): D-047 adds overlapping `downweight` precedence line.
  - **`docs/TESTING.md`** (edited): Added overlapping `downweight` precedence test expectation.
  - **`docs/PROGRESS.md`** (edited): Session log corrected to §12-18 / D-043..D-049; removed open follow-ups; T-019.b added as TODO.
- Tests: `pnpm check` green (typecheck, lint 0 errors, format 0 errors); prettier fixed `docs/PROGRESS.md` wrapping.
- State left: **Docs-only PR complete**. No code changed. `BUGS.md` unchanged (no bugs found).
- Next: Owner review; then schedule T-019.b or continue T-019 (export).

## Session log (newest first)

### 2026-11-05 — Devin — Draft flow review fixes (second pass)

- Done:
  - `pnpm etl backtest draft --out=<path>` was unreachable: strict `parseArgs` rejected the flag before the manual scan ran. `--out=` args are now stripped before positional parsing; duplicates and empty values are rejected; regression tests added.
  - `exportJson` wrote `latest.json` for whatever patch was exported, so re-exporting an older patch moved the web pointer backwards. The pointer is now written only when the exported patch is the latest patch in the database (`latestPath` is `null` otherwise).
  - Web draft fixes: rank selector now lists the 10 real `Rank` values from `rankSchema.options` (was emitting the invalid `MASTER_PLUS` bucket); duplicate champion picks across slots are prevented via `championsForSlot`; the dead role select on the user slot is hidden; pool champions in "Best overall" are tagged "In your pool" via a `poolIds` prop (SPECS §7.1); `poolUnavailable` reasons render readable strings; `ChampionPicker` listbox id is unique per instance (`useId`) with Escape/outside-click dismissal; duplicated list titles removed; pool JSON import validation extracted to `parsePoolImport` with unit tests.
  - Removed a duplicated "Copilot — T-035 review fixes" session entry from this file.
- Files touched: `packages/etl/src/commands/backtest.ts`, `packages/etl/src/commands/export.ts`, `packages/etl/src/export/index.ts`, `apps/web/src/**`, `docs/BUGS.md`, `docs/PROGRESS.md`.
- Tests: `pnpm check` green.
- State left: DONE (review fixes committed on `feature/t-029-to-t-034`).
- Next step: owner review; then T-019.b or D-023 gate work (T-027.a stays REVIEW).

### 2026-11-04 — Kilo — Web draft flow + backtest + static deploy (T-029/T-030→T-034, T-027.a)

- Done:
  - T-029 / D-051: export writes `data/public/latest.json` (`{schemaVersion, patch, manifest, generatedAt}`) after a successful publish; zod `Latest` schema in `@draftorb/shared`; test that a failed export leaves the previous `latest.json` untouched.
  - T-030: web scaffold (Vite/React/Tailwind) with a schema-validated data loader resolving the patch through `latest.json`, then the manifest and every export file it lists; sample data under `data/public/16.21`; vite dev middleware mirrors `data/public` at `/`; `apps/web/src/**/*.test.ts` added to vitest include.
  - T-031: draft screen — 10 slots (user, 4 allies, 5 enemies), reusable searchable `ChampionPicker`, optional role per slot, blind-pick toggle, rank selector (Diamond default); engine `recommend` wired to draft input; any subset of inputs valid.
  - T-032: "Best overall" recommendations list with `recommendationPageSize` (5) pagination, "Show N more", `aria-live="polite"` "Showing X of Y", button hidden when exhausted; `RecommendationCard` (reasons, level badges, sample sizes, low-data warnings); pure `paginate` helper unit-tested; overall list always shown.
  - T-033: per-role champion pool in `localStorage` (`draftorb.pool.v1`, `championPoolSchema`, try/catch degradation, catalogue filtering with dropped-id notice); `PoolEditor` (add/remove/clear, `poolMaxSize`, off-role hints, JSON export/import, invalid import leaves stored pool untouched); "From your pool" list above "Best overall", `In your pool` badge, "Hide my pool" toggle, empty-pool CTA, pool-unavailable reasons; two lists paginate independently.
  - T-027.a: `pnpm etl backtest draft` (D-023 baseline) — frozen temporal holdout vs training window, log-loss/Brier/calibration vs 0.5 and baseline-only, per-role matchup effects, JSON report at `data/public/backtest-draft.json`; holdout-exclusion and toy planted-matchup (TOP + SUPPORT) tests.
  - T-034: GitHub Pages deploy workflow (`.github/workflows/deploy.yml`, `VITE_BASE=/draftorb/`, `data/public` copied into site root), legal footer, unvalidated model banner shown when no backtest report beats baseline-only.
- Files touched: `packages/shared/src/schemas/manifest.ts`, `packages/shared/src/index.ts`, `packages/etl/src/export/index.ts`, `packages/etl/src/commands/export.ts`, `packages/etl/src/backtest/draft.ts`, `packages/etl/src/commands/backtest.ts`, `packages/etl/src/cli.ts`, `apps/web/src/**` (loader, config, pagination, components, App, vite config), `.github/workflows/deploy.yml`, `data/public/{latest.json,16.21/{manifest,role-prob,roles/*}}`.
- Tests: `pnpm check` green — 60 test files, 738 tests passed; lint 0 errors (15 pre-existing warnings); format clean.
- State left: DONE (T-027.a baseline, T-029/T-030/T-031/T-032/T-033/T-034).
- Next step: owner review; then T-019.b (patches table) or T-024/T-025/T-026.

### 2026-11-02 — Copilot — T-019 review follow-up

- Done:
  - Preserved `champions.json`, `items.json`, and `runes.json` across exports and included available catalogs in manifest hashes; missing catalogs warn. Role-derivation snapshots also survive directory replacement without being listed as public assets.
  - Invalidated manifests before `static` and `derive-roles` modify catalog files.
  - Corrected pair-role serialization, preserved rune rank buckets (manifest schema v3), and rounded role probabilities so the final surviving role receives the residual; validated the resulting role map against the shared schema.
  - Added warnings for explicit patch mismatches and mixed-platform aggregates, including with an explicit region. Backup cleanup failures after publication now preserve the backup and return a warning. Builds with no gated-in context emit no file.
- Files touched: exporter orchestration/builders/IO and tests, shared rune/manifest schemas and tests, catalog-writing commands and tests, and `DATA_MODEL.md`, `DECISIONS.md`, `TICKETS.md`, `BUGS.md`, and this log.
- Tests: focused export/shared tests pass (12 files, 92 tests); `pnpm check` passes (55 files, 707 tests); lint reports 0 errors and 15 pre-existing warnings.
- State left: DONE (T-019 review follow-up implemented; D-049 awaits owner decision).
- Next step: T-019.b (patches table, label mapping, patch_index switch, --since-patch).
- Pitfalls / notes: aggregate tables are not patch- or platform-scoped; warnings report this limitation. Rune consumers must read `rankBucket` on each context; manifest schema v2 is no longer accepted.

### 2026-11-02 — T-019 Windows test compatibility follow-up

- Done:
  - Normalized recursive `readdirSync` paths in the stale-file regression before comparing them with slash-separated expected paths; the assertion still checks the exact file set.
  - Recorded the Windows-only test portability issue as fixed in `docs/BUGS.md`.
- Files touched: `packages/etl/src/export/atomic.test.ts`, `docs/TICKETS.md`, `docs/BUGS.md`, `docs/PROGRESS.md`.
- Tests: focused atomic exporter test passed (5 tests); `pnpm check` passed (55 test files / 702 tests, lint 0 errors and 15 pre-existing warnings).
- State left: Windows path regression fix verified; commit the follow-up.
- Next step: T-019.b (retention model migration).
- Pitfalls / notes: recursive `readdirSync` paths use platform-native separators; normalize before comparing to repository-format paths.

### 2026-11-02 — Ticket T-019 (second review-fix pass)

- Done:
  - Enforced the `exportMinGames` gate for global rune contexts and centralized rune context levels between aggregation and export.
  - Kept `role-prob.json` global regardless of selected role-keyed files; unknown exported roles now fail with a path-specific error.
  - Calculated rune/build pick shares against raw context totals before gating and rounded only the final value.
  - Hardened publishing with unique dot-prefixed temp/backup directories, age-based stale cleanup, recovery-backup preservation, rollback attempts, and final published file paths.
  - Added typed table queries and path-specific schema errors; returned region, skipped-rune, and gzip-size warnings for the CLI to log once. The CLI now reports only a missing DB as absent and surfaces other open errors.
  - Split exporter tests by topic and extracted typed seed helpers to keep exporter and command modules at or below 300 lines.
  - Updated DATA_MODEL.md and TICKETS.md with the global role-probability scope, gate/share rules, and actual publish behavior.
- Files touched: `packages/shared/src/rune-context.ts`, `packages/shared/src/index.ts`, `packages/etl/src/aggregate-runes.ts`, `packages/etl/src/commands/export.ts`, `packages/etl/src/commands/export.test.ts`, `packages/etl/src/export/{index,io,role-prob,role-tables,runes,builds,export.fixtures,export.seed,export.test-utils}.ts`, exporter topic tests, `docs/DATA_MODEL.md`, `docs/TICKETS.md`, `docs/PROGRESS.md`.
- Tests: `pnpm check` passed (typecheck, formatting, 55 test files / 702 tests; lint had 0 errors and 15 pre-existing warnings). Package suites passed: ETL 31 files / 275 tests, shared 4 / 46, engine 20 / 381. Focused exporter/CLI suite passed: 8 files / 41 tests. Export and command TypeScript files are at or below 300 lines.
- State left: T-019 review findings addressed; final checks passed.
- Next step: T-019.b (retention model migration).
- Pitfalls / notes: SQLite `item_build.lane_key` is `NOT NULL` and stores no-lane as `''`; exporter normalizes it to absent. `role-prob.json` is global. Dot-prefixed temp/backup directories under `data/public` are internal and must not be served; cleanup only removes matching directories older than 24 hours and retains backups when the patch directory is missing. A failed rollback preserves the backup for recovery.

### 2026-11-02 — Nemotron — Ticket T-019 (review-fix pass)

- Done:
  - Split `packages/etl/src/export.ts` into `packages/etl/src/export/{index,io,manifest,role-prob,role-tables,runes,builds}.ts` (all under 300 lines), keeping `exportJson`/`ExportResult` re-exported from `./export`.
  - Replaced `AnyWeightedRow`/if-else chain with a table-driven spec (`TABLE_SPECS`) with typed rows and shared zod schema validation; single `@draftorb/shared` import.
  - D1: role-prob exports the stored `role_prob.prob`, renormalizing surviving roles to sum to 1 per champion.
  - B2: sha256 over the exact bytes written for each file, in every manifest `files[]` entry.
  - B3: compact JSON for data files (`null, 2` only for manifest); gzip size check in `io.ts` vs `MAX_FILE_BYTES`; `maxFileBytes` option; `warnings` and `skippedRunePages` in `ExportResult`.
  - B4: `pickShare` computed per context (`gamesW / context total`, `round6`), never constant 0.
  - B5: builds grouped by a structured `JSON.stringify([...])` key (no `split('|')`); `laneKey` null/absent (never `''`); rune/build files validated against shared schemas before writing.
  - B6: runes/builds grouped by `(championId, myRole)`, written under `roles/<myRole>/`; new `roles` option.
  - C1: explicit `ORDER BY` plus JS sorts; `now` option for byte-identical deterministic output.
  - C3/C4: rune skip logging plus skipped count; atomic temp-dir write + publish, stale-file removal.
  - C5: `region` option plus `--region` CLI flag; multi-platform warning.
  - C6: `exportMinGames <= minGames` invariant assertion.
  - D1-D4: CLI imports `PATCH_PATTERN` from aggregate, opens the DB read-only, prints warnings + skipped count.
  - Rewrote tests: `export/export.fixtures.ts` (generic `insertRows`), `export/export.test.ts` (16 tests), `commands/export.test.ts` (env save/restore, DB-not-modified, `--region`).
- Files touched: `packages/etl/src/export.ts` (deleted), `packages/etl/src/export/{index,io,manifest,role-prob,role-tables,runes,builds}.ts` (new), `packages/etl/src/export/export.fixtures.ts` (new), `packages/etl/src/export/export.test.ts` (new), `packages/etl/src/commands/export.ts`, `packages/etl/src/commands/export.test.ts`, `docs/BUGS.md`, `docs/TICKETS.md`, `docs/PROGRESS.md`.
- Tests: `pnpm check` green — 49 test files, 683 tests passed; `pnpm vitest run packages/etl packages/shared` — 302 tests passed.
- State left: DONE (T-019 review findings addressed).
- Next step: T-019.b (patches table).
- Pitfalls / notes for next AI: `lane_key` is `NOT NULL` in SQLite (stored as `''` sentinel) but exported as absent; `role-prob.json` is global (not role-keyed). Do not add `bytes` to manifest entries — `manifestFileSchema` does not allow it.

---

### 2026-11-01 — Specification update: SPECS §12-18 (retention model, patch index, change scoring)

- Done:
  - **`docs/SPECS.md`** (edited): Added SPEC 1-5 (§12-18) defining a new retention model with bounded storage, patch index from data source versions, read-time weights, deterministic change scoring, and manual override of change weights. Purge threshold corrected from `< latest - N` to `<= latest - N` to retain exactly N patches.
  - **`docs/DECISIONS.md`** (edited): Added D-043 through D-049 accepting the new specifications. D-043 documents the tension with D-033 (patch index definition conflict: dense over data source versions vs dense over distinct stored patches). D-044 documents the tension with DATA_MODEL.md/T-015..T-018 (clear-and-rewrite vs accumulated-with-retention). D-045 notes the DECAY constant difference (0.7 vs 0.85). D-046 documents automatic change scoring from Data Dragon. D-047 documents breakpoints including overlapping `downweight` precedence (multiply `weight_factor`s floored at `MIN_WEIGHT`; `reset` dominates). D-048 documents Bayesian smoothing with data-driven `p0` vs the fixed 0.5 prior in §5. D-049 documents rejected alternatives.
  - **`docs/TESTING.md`** (edited): Added test guidance for the new model (hotfix merging, patch index ordering, first-patch fallback, Bayesian smoothing, overlapping `downweight` precedence).
- State left: **Specification update (no ticket)**. The new retention model (SPEC 2) is orthogonal to the current ETL implementation (T-015..T-018), which clears and rewrites aggregate tables per run. No code changes were made. Owner decision 2026-11-01 (D-043, D-044): keep D-033 and clear-and-rewrite for T-015..T-018; migrate later via the future retention-migration ticket in TICKETS.md. The corrected purge threshold (`<= latest - N`) fixes the off-by-one error that would have retained N+1 patches.
- Next: Continue T-019 (export) on the existing DATA_MODEL.md model and D-033. T-019.b (Retention model migration) is tracked as TODO in TICKETS.md; overlapping `downweight` precedence is documented in SPECS §18 / D-047.

### 2026-11-01 — Ticket T-017 (Aggregate pair tables)

- Done:
  - **`packages/etl/src/aggregate-pairs.ts`** (new): `aggregatePairTables(db, { patch?, config? })` computes `pair_ally`, `pair_enemy`, `lane_vs` and `lane_full` rows per (champion, my_role, rank bucket) using the engine rank kernel (`combinedGameWeight`). Lane keys follow `laneGroup(my_role).enemies` order (SUPPORT: `[SUPPORT, ADC]`, ADC: `[ADC, SUPPORT]`; `opp2_id` NULL for 1v1 TOP/MID/JUNGLE) and `partner_id = laneGroup(my_role).allies[0]` (DATA_MODEL.md). Tables are cleared and rewritten in one transaction (idempotent); left unchanged when nothing contributes. Optional `[patch]` snapshot excludes newer matches.
  - **`packages/etl/src/aggregate-pairs-helpers.ts`** (new): `seedMatches` multi-participant match seeder, `requirePairRow`/`requireLaneVsRow`/`requireLaneFullRow` assertions, `withFreshDb`/`withSeededDb` DB fixtures.
  - **`packages/etl/src/aggregate-pairs.test.ts`** (new, 8 tests): support bot lane pairs + lane_vs + lane_full for both SUPPORT and ADC perspectives (lane id order asserted), TOP 1v1 (`lane_vs` opp2 NULL, `lane_full` empty), recency decay across patches, idempotence, empty DB leaves tables unchanged, snapshot patch excludes newer matches, missing lane champion skips lanes but keeps pairs.
  - **`packages/etl/src/commands/aggregate.ts`** (edited): `pnpm etl aggregate` now also writes pair tables and prints a summary.
  - **`packages/etl/src/index.ts`** (edited): exports `aggregatePairTables`, `PairRow`, `LaneVsRow`, `LaneFullRow`, `PairTableResult`.
- Tests: `pnpm check` green (typecheck, lint: 0 errors, format: 0 errors; 641 tests across 46 files).
- State left: **DONE (T-017)**. Next ETL ticket: T-018 (Aggregate runes by context, depends on T-014,T-011.b,T-020).

### 2026-11-01 — Ticket T-018 (Aggregate runes by context)

- Done:
  - **`packages/etl/src/aggregate-runes.ts`** (new): `aggregateRunesByContext(db, { patch?, config? })` computes `rune_ctx` rows per (champion, my_role, context_key, context_level, perks_hash) using recency × reliability weighting (SPECS §3) and the experts rule (`champion_games >= minChampGames`, D-022). Each expert participant's rune page contributes to the back-off chain (most specific first, SPECS §8.1): `lane:<side.ROLE:champ,...>` keys for the top `contextSlots` lane-context slots in descending lane-phase influence (ties ally-before-enemy then role order), then one key per back-off step dropping the least-influential slot (3 -> 2 -> 1 slots; side/role kept so swapped ally/enemy matchups never merge), then `damagemix:<AD|AP|mixed>` (enemy-team damage mix from `data/manual/champion-tags.json`; untagged champions ignored, `mixed` when none tagged), then `global`. Context levels increase as specificity decreases: 3-slot lane=1, 2-slot lane=2, 1-slot lane=3, damage mix=4, global=5. Rune pages are canonicalized (`canonicalPerksJson`: selected styles/perks/shards only, match-specific `var1..3` dropped) before hashing and storing, so identical pages share one row. Accumulates `wins_w`, `games_w`, `games_w2` and distinct-player count `players`. Idempotent (clear + rewrite in one transaction); left unchanged when nothing contributes. Optional `[patch]` snapshot excludes newer matches and judges experts on in-window games only (games after the snapshot are subtracted from `champion_games`, D-022); malformed patch throws before touching the table.
  - **Migration 010** (new): adds `context_level` column to `rune_ctx` table (schema fix to match DATA_MODEL.md and shared schemas).
  - **Migration 011** (new): rebuilds `rune_ctx` with a `rank_bucket` column (in the primary key). Each game contributes to every user rank bucket with `expertWeight(gameBucket, userBucket, alpha, wMax)` × recency × reliability (0 below the user bucket). Existing rows are dropped and regenerated by the next `pnpm etl aggregate`.
  - Expert rule includes the mastery fallback: in-window `champion_games >= minChampGames` OR `mastery_points >= minMasteryPoints` (mastery is only fetched for the recommended role, D-022). D-036 updated.
  - Review fixes: lane `context_level` derived from slot count only (1-slot = 3 for every role); migration 010 backfills `context_level` from `context_key`.
  - **`packages/etl/src/aggregate-runes.test.ts`** (new, 16 tests): lane-context row for a support game, expertWeight per user rank bucket, mastery fallback, lane levels from slot count, every back-off level present (3/2/1-slot lane, damage mix, global), snapshot expert window excludes future-only experts, canonical pages merge across `var*` stats, untagged champions ignored in damage mix, expert filter excludes below-`minChampGames`, recency decay across patches, unknown-rank down-weight, idempotent reruns, snapshot predating all matches preserves rows, snapshot excludes newer matches, malformed patch preserves rows, empty DB leaves table empty.
  - **`packages/etl/src/commands/aggregate.ts`** (edited): `pnpm etl aggregate` now also writes rune contexts and prints a summary.
  - **`packages/etl/src/commands/aggregate.test.ts`** (edited): rune_ctx rows written and reported when an expert participant exists.
  - **`packages/etl/src/index.ts`** (edited): exports `aggregateRunesByContext` and `RuneCtxRow`.
  - **`docs/DATA_MODEL.md`** (edited): updated `rune_ctx` table definition to include `context_level` column with full hierarchy description.
  - **`docs/DECISIONS.md`** (edited): added D-036 documenting the intentional scope gaps in T-018.
- Tests: `pnpm check` green (typecheck, lint: 0 errors, format: 0 errors; 655 tests across 47 files).
- State left: **DONE (T-018)**. Next ETL ticket: T-019 (Export versioned JSON + manifest).

### 2026-11-01 — Ticket T-015.c (Decay-weighted role_prob evidence)

- Done:
  - **`packages/etl/migrations/009_role_prob_decay_weights.sql`** (new): adds `games_w` and `games_w2` to `role_prob`.
  - **`packages/etl/src/aggregate.ts`** (edited): `aggregateRoleProb(db, { patch?, config? })` accumulates `games`, `games_w`, `games_w2` across patches <= snapshot using the D-033 dense patch index and `recencyFactor * reliabilityFactor`; `prob = games_w / sum_roles games_w`. The table is left untouched when nothing contributes.
  - **`packages/etl/src/commands/aggregate.ts`** (edited): passes the new options object.
  - Tests: `packages/etl/src/aggregate.test.ts`, `packages/etl/src/commands/aggregate.test.ts`, `packages/etl/src/db/migrate.test.ts` updated (decay retention, newer-patch no-wipe, n_eff < raw count, future snapshot).
  - Docs: D-035 (PROPOSED), T-015.c, DATA_MODEL `role_prob` columns, SPECS `reliability.nEff`, BUGS duplicate-ID note.
- Tests: `pnpm check` green; CI test (ubuntu, windows), lint and format pass (45 test files).
- State left: **DONE (T-015.c)**. Next ETL ticket: T-017 (Aggregate pair tables).
- Pitfalls: `role-prob.json` stays a bare sparse map; the `exportMinGames` filter belongs to the exporter (T-019), not `aggregate.ts`.

### 2026-11-01 — Kilo — Documentation: patch / retention / weighting / change-detection redesign (D-043..D-048, SPECS §12-17, T-019.b..f)

- Done:
  - `docs/DECISIONS.md`: appended D-043 (patch index), D-044 (retention/prune), D-045 (weight formula), D-046 (change score), D-047 (breakpoints), D-048 (no separate smoothing); all PROPOSED; D-049 removed; D-031 marked SUPERSEDED by D-035; D-028/D-026/D-025 order and D-031 status addressed per housekeeping (Part I proposed, not applied).
  - `docs/SPECS.md`: §3 recency bullet now references `patches` table (SPECS §12) with T-019.b as the switch point; added target-model banner and replaced sections 12-17 with patch index, retention/prune, weights, change score, breakpoints, edge cases.
  - `docs/TICKETS.md`: replaced T-019.b with T-019.b..f (S/M/L), referencing SPECS sections, correct dependencies, template fields; T-019 (export) not blocked.
  - `docs/DATA_MODEL.md`: `match_rejects.reason` comment extended to `queue|short|patch|invalid|pruned`; `pruned` permanent. Existing `patches`/`entity_change_scores`/`data_breakpoints` DDL already matches required text.
  - `docs/TESTING.md`: deleted old "Expected tests: data retention, change scoring, breakpoints (SPEC 8)" block; single section 6 with retention/weights/change-scoring/breakpoints tests plus real-fixture rule; no `soft`, `grace`, `MIN_GAMES`, `champion_stats`, `smoothing`, `SPEC` remains.
  - `docs/RIOT_API.md`: per-champion files, `versions.json` order, `runesReforged.json`, `gameVersion`->label rule already present with VERIFY markers (no change needed).
- State left: documentation complete; no code changes. Next session: implement T-019.b (patches table).

### 2026-11-01 — Kilo — Ticket T-019: Export versioned JSON + manifest

- Done:
  - `packages/etl/src/export.ts` (new): `exportJson(db, options)` — read-only export of the aggregated tables to the role-keyed DATA_MODEL.md layout plus `manifest.json`; `exportMinGames` (`n_eff`) gate on every row; sparse `role-prob.json` whose probabilities sum to 1 per champion; runes parsed from stored `perks_json`; size-budget warning for files over 5 MB.
  - `packages/etl/src/commands/export.ts` (new): `export [patch]` CLI command; reads latest patch when omitted; "no database" message when the DB is absent.
  - `packages/etl/src/cli.ts`: registered `exportCommand`; `packages/etl/src/index.ts`: re-exported `exportJson`/`ExportResult`.
  - `packages/etl/src/export.test.ts`, `packages/etl/src/commands/export.test.ts` (new): unit + CLI tests (empty DB, malformed patch, sparse role-prob, tuple filtering by n_eff, rune parsing, unparseable rune skip, manifest schema v2/files/roles/rankBuckets).
  - `docs/SETUP.md`: moved `pnpm etl export` from Planned to Implemented.
- Files touched:
  - `packages/etl/src/export.ts`, `packages/etl/src/export.test.ts`
  - `packages/etl/src/commands/export.ts`, `packages/etl/src/commands/export.test.ts`
  - `packages/etl/src/cli.ts`, `packages/etl/src/index.ts`
  - `docs/SETUP.md`, `docs/TICKETS.md`, `docs/PROGRESS.md`
- Tests: `pnpm check` — 0 errors (typecheck + lint green; pre-existing non-null-assertion warnings only; `docs/SPECS.md` prettier warning pre-existing and untouched). `pnpm vitest run packages/etl` — 244 tests pass.
- State left: DONE
- Next step: T-019.b (patches table / patch_index switch) or T-024 (engine blind pick).
- Pitfalls / notes for next AI:
  - Export is read-only; run `pnpm etl aggregate` first to populate tables.
  - `my_role` must be aliased consistently as `myRole` in all export SQL (pair/lane tables previously aliased it as `role` or omitted it).
  - `exportMinGames` defaults to 10 and must be <= `minGames` (engine config invariant).

### 2026-11-01 — PR #42 redesign: storage/weighting/change-detection made coherent (docs only)

- Done:
  - **`docs/DECISIONS.md`** (edited): Replaced old D-043..D-049 (ACCEPTED) with new D-043..D-048 (PROPOSED): patches table (D-043), retention/prune (D-044), single weight formula (D-045), automatic change score (D-046), breakpoints (D-047), no separate smoothing (D-048). D-049 removed (content folded into Alternatives). No fabricated owner decisions or dates.
  - **`docs/SPECS.md`** (edited): §3 recency references `patches` table (D-043); removed §14 DECAY/p0 note; replaced sections 12-18 with target-model sections 12-17 (patch index, retention/prune, weights, change score, breakpoints, edge cases) preceded by a target-model banner.
  - **`docs/TICKETS.md`** (edited): Replaced single T-019.b with session-sized chain T-019.b..f; T-019 (export) unblocked.
  - **`docs/DATA_MODEL.md`** (edited): Added `patches`, `entity_change_scores`, `data_breakpoints` DDL with CHECKs and unique index; aggregated tables recomputed each run with weights baked in; exports unchanged note.
  - **`docs/TESTING.md`** (edited): Added section 6 (retention, weights, change scoring, breakpoints) with property checks and real-JSON fixture rule.
  - **`docs/RIOT_API.md`** (edited): Expanded Data Dragon static data row; added VERIFY markers.
- Tests: `pnpm check` green (typecheck, lint 0 errors, format 0 errors). No code changed.
- State left: **Docs-only redesign complete**. `BUGS.md` unchanged (no bugs found).
- Next: Owner review of PROPOSED ADRs; then schedule T-019.b.

### 2026-11-01 — PR #42 docs completion: T-019.b ticket, downweight precedence, loose ends

- Done:
  - **`docs/TICKETS.md`** (edited): Replaced "Future work" paragraph with `T-019.b | Retention model migration (L)` in E1 ETL; deps `T-019, T-015..T-018, T-002.b`; acceptance mirrors `docs/TESTING.md` expected tests.
  - **`docs/SPECS.md`** (edited): §18 documents overlapping `downweight` precedence (multiply `weight_factor`s floored at `MIN_WEIGHT`; `reset` dominates; same rule regardless of `from_patch_index`); §18 hotfix line reworded (weights never stored, nothing "kept"); §14 note confirms `DECAY` 0.7 vs `decay` 0.85 and data-driven `p0` vs fixed 0.5 prior are intentional.
  - **`docs/DECISIONS.md`** (edited): D-047 adds overlapping `downweight` precedence line.
  - **`docs/TESTING.md`** (edited): Added overlapping `downweight` precedence test expectation.
  - **`docs/PROGRESS.md`** (edited): Session log corrected to §12-18 / D-043..D-049; removed open follow-ups; T-019.b added as TODO.
- Tests: `pnpm check` green (typecheck, lint 0 errors, format 0 errors); prettier fixed `docs/PROGRESS.md` wrapping.
- State left: **Docs-only PR complete**. No code changed. `BUGS.md` unchanged (no bugs found).
- Next: Owner review; then schedule T-019.b or continue T-019 (export).

### 2026-10-31 — Antigravity — Ticket T-015.b (Derive champion roles from role probabilities)

- Done:
  - **`packages/etl/src/derive-roles.ts`** (new): pure `deriveChampionRoles(roleProbabilities)` and `applyDerivedRoles(champions, roleProbabilities)`. Derives each champion's roles from observed role-probability entries (roles with probability > 0, canonical role order), keeping the Data Dragon tag bootstrap for champions without role-prob data (D-032, PROPOSED).
  - **`packages/etl/src/derive-roles.test.ts`** (new, 8 tests): role derivation (single role, flex canonical order, input order independence, zero-prob exclusion, absent champions, empty map) and `applyDerivedRoles` (observed replaced, unobserved kept, empty map keeps bootstrap).
  - **`packages/etl/src/ddragon.ts`** (edited): `transformChampions(rawData, roleProbabilities?)` — derived roles when role-prob data is passed, tag-based bootstrap fallback otherwise (backward compatible).
  - **`packages/etl/src/ddragon.test.ts`** (edited): new test asserting role-prob derived roles override tag roles.
  - **`packages/etl/src/commands/derive-roles.ts`** (new): `pnpm etl derive-roles [patch]` — reads `role_prob` from the local SQLite DB and rewrites `champions.json.roles` for `data/public/<patch>/champions.json` (tag bootstrap kept for unobserved champions); prints "no database at <path>" and exits 0 when the DB is missing; `DRAFTORB_PUBLIC_DIR` overrides the public data dir.
  - **`packages/etl/src/commands/derive-roles.test.ts`** (new, 7 tests): missing DB, malformed patch, too many args, full rewrite + bootstrap fallback, empty `role_prob` leaves roles unchanged, missing `champions.json`, explicit patch argument.
  - **`packages/etl/src/cli.ts`** (edited): registered `deriveRolesCommand`.
  - **`packages/etl/src/index.ts`** (edited): exports `deriveChampionRoles` and `applyDerivedRoles`.
  - **`docs/DECISIONS.md`** (edited): D-032 (PROPOSED) records the decision to keep `champions.json.roles` (required by the shared contract and DATA_MODEL.md) and derive its contents from role-prob where observed data exists.
- Tests: `pnpm check` green (typecheck, lint: 0 errors, format: 0 errors; 618 tests across 44 files). No new bugs identified.
- State left: **DONE (T-015.b)**. Next ETL ticket: T-017 (Aggregate pair tables, depends on T-016,T-011.b).

### 2026-10-31 — Antigravity — Ticket T-016 (Aggregate baselines)

- Done:
  - **`packages/etl/src/aggregate-baseline.ts`** (new): `aggregateBaseline(db)` computes `baseline` rows per (champion, my_role, user rank bucket) using the engine rank kernel (`combinedGameWeight` from `@draftorb/engine`). Each game contributes to every user bucket row weighted by `rankDistanceWeight * recencyFactor * reliabilityFactor`; accumulates `wins_w`, `games_w`, `games_w2`, `games` (raw count); clears and rewrites the table in a transaction (idempotent). Populates the `games` 6th column added by migration 008, resolving B-025/B-033.
  - **`packages/etl/src/aggregate-baseline.test.ts`** (new, 11 tests): weighted counts and `n_eff` verified on toy data (uniform weight → n_eff = raw count; uneven recency weights → n_eff < raw count; out-of-window game contributes 0 weight; window edge kept; reliability down-weight; unknown participant rank uses match rank; bucket clamping; champion/role keying; idempotent reruns; snapshot older than all matches preserves rows; empty DB → empty baseline).
  - **`packages/etl/src/aggregate-baseline-patch.test.ts`** (new, 3 tests): malformed patch throws and preserves rows; matches newer than the snapshot are excluded with numeric patch order; a snapshot patch with no stored games is the current patch for recency.
  - **`packages/etl/src/aggregate-baseline-helpers.ts`** (new): shared toy-data seeding and temp-DB helpers for the baseline tests.
  - **`packages/etl/src/commands/aggregate.test.ts`** (edited, 1 test): baselines are written even when the target patch has no participants (role_prob unchanged).
  - **`packages/etl/src/commands/aggregate.ts`** (edited): `pnpm etl aggregate` now also writes baseline rows; description updated.
  - **`packages/etl/src/index.ts`** (edited): exports `aggregateBaseline` and `BaselineRow`.
  - **`packages/etl/package.json`** (edited): added `@draftorb/engine` workspace dependency to reuse the engine rank kernel.
  - **`packages/etl/tsconfig.json`** (edited): added `../engine` project reference.
  - **`docs/SETUP.md`** (edited): `pnpm etl aggregate` description updated to include baselines.
  - Review fixes: the game rank bucket now comes from `matches.avg_rank_score`, so participants with unknown rank still contribute; an optional `[patch]` argument excludes newer matches and sets recency relative to that patch (`aggregateBaseline(db, { patch })`); a malformed patch throws before the table is touched, so existing baselines are preserved. The ETL dependency on `@draftorb/engine` is recorded as D-032 and the patch-index/bucket assumptions as D-033 (both ACCEPTED). When no game contributes, `baseline` is left unchanged and the CLI says so.
- Tests: 614 tests across 43 files pass, including the 15 baseline tests (11 + 3 + 1 command test).
- State left: **DONE (T-016)**. Resolved B-033 (renumbered from duplicate B-025, now FIXED). Next ETL ticket: T-017 (Aggregate pair tables).

### 2026-10-31 — Antigravity — Ticket T-015 (Aggregate role probabilities)

- Done:
  - **`packages/etl/src/aggregate.ts`** (new): `aggregateRoleProb(db)` computes `role_prob` rows from `participants` — per (champion, role): raw `games` count and `prob = games(champion, role) / sum_roles games(champion, role)`; sparse map (only observed pairs); probs sum to 1 per champion; idempotent (clears + rewrites in a transaction).
  - **`packages/etl/src/commands/aggregate.ts`** (new): `pnpm etl aggregate` CLI command; prints "no database at <path>" and exits 0 when the DB is missing; rewrites `role_prob` in the local DB but never calls the Riot API. Optional `[patch]` argument (`major.minor`, malformed → usage error exit 2; defaults to the highest stored patch, numeric compare as in D-017); only that patch's participants are counted (D-031, PROPOSED). A patch with no participants leaves `role_prob` unchanged.
  - **`packages/etl/src/cli.ts`** (edited): registered `aggregateCommand`; removed `aggregate` from `PLANNED_COMMANDS` in `packages/etl/src/commands/shared.ts`.
  - **`packages/etl/src/index.ts`** (edited): exports `aggregateRoleProb` and `RoleProbRow`.
  - **`packages/etl/src/aggregate.test.ts`** (new, 8 tests): probs sum to 1 per champion (Soraka 10/2 split → 0.833/0.167, Aatrox 4/4 → 1.0), idempotence, target-patch filter, empty patch keeps existing rows, malformed patch rejected, numeric `latestPatch`, old-patch-only champion dropped, empty DB → empty `role_prob`.
  - **`packages/etl/src/commands/aggregate.test.ts`** (new, 4 tests): missing DB message, usage errors (malformed patch, too many args), explicit patch argument.
  - **`docs/DECISIONS.md`** (edited): D-031 (PROPOSED) records the single-patch choice vs SPECS §3 recency decay.
  - **`docs/SETUP.md`** (edited): `pnpm etl aggregate` moved from Planned to Implemented.
- Tests: re-run `pnpm check` after the review fixes (counts above not yet re-measured).
- State left: **DONE (T-015)**. Next: T-016 (Aggregate baselines).

### 2026-10-30 — Antigravity — Ticket T-023 (Recommendation engine, role-generic)

- Done:
  - **`packages/engine/src/recommend.ts`** (new): pure, deterministic recommendation engine implementing SPECS §5-7 for any `myRole`:
    - Candidate enumeration via `roleProb >= rc.roleProbThreshold` (`DEFAULT_RECOMMEND_CONFIG`, default 0.05), plus user pool champions (D-024).
    - Baseline gate: excludes candidates with baseline `n_eff < minGames`, routing them to `insufficientData`.
    - Layer 1 (pairs): allies and enemies sorted by descending role influence with ties broken by ascending champion ID (SPECS §5, TICKETS.md T-026), shrunk toward `p0` with prior strength `k`.
    - Layer 2 (`lane_vs`): bot lane (SUPPORT/ADC) shrinks toward pair predictions `q = sigmoid(x)` once lane enemies are known; 1v1 lane groups (TOP, MID, JUNGLE) score 1v1 matchup.
    - Layer 3 (`lane_full`): evaluates full 2v2 lane context for bot lane; skipped for 1v1 lane groups (TOP, MID, JUNGLE).
    - Layer 4 (composition): comp need bonuses from `computeCompNeed`.
    - Layer 5 (blind safety): `computeBlindSafety` penalty/bonus when blind pick or any lane-group enemy role is unknown (SPECS §5).
    - Reason generation: reasons emitted in canonical order (pairs by descending influence, ties by championId, then `lane_vs`, `lane_full`, `comp`, `blind`), with level mapping and `lowData` flags.
    - Pool contract (D-024): `recommendations` is the complete overall ranking; `poolRecommendations` retains exact global rank and sequential `poolRank`; pool champions never modify candidate scores; missing baseline data maps to `poolUnavailable` (`insufficientData`) and `insufficientData`; unknown champion IDs map to `poolUnavailable` (`unknownChampion`); below-threshold pool picks receive `offRole` warning.
  - **`packages/engine/src/comp.ts`** and **`packages/engine/src/comp.test.ts`** (new): composition needs scoring from champion tags (engage, peel, waveclear, poke, damage balance).
  - **`packages/engine/test/golden.test.ts`** (new): golden test runner loading fixtures from `packages/engine/test/golden/*.json` (`input`/`data` validated with the shared zod schemas, `expected` with a strict hand-rolled checker).
  - **Golden test fixtures** (16 scenarios in `packages/engine/test/golden/`):
    - `support_flex_enemy_bot_lane.json`: unfixed flex enemy (SUPPORT 0.6 / MID 0.4) inferred into the bot lane; `lane_vs` then `lane_full` apply, no blind, below-gate candidate in `insufficientData`.
    - `pool_offrole_blind_pick.json`: blind pick with an off-role pool champion (`offRole`, `poolRank`, empty `poolUnavailable`).
    - `ally_adc_synergy.json`: ally ADC pair synergy dominating recommendation.
    - `blind_pick_safe_supports.json`: blind pick mode with baseline and comp evaluation.
    - `enemy_counter.json`: enemy counter pick penalizing unfavorable matchup.
    - `low_data_flag.json`: low data pair term flagged `lowData: true` (zero contribution is asserted in `packages/engine/src/recommend-pairs.test.ts`).
    - `pool_recommendations_order.json`: personal pool preserves overall recommendation order with `poolRank`.
    - `top_lane_1v1_matchup.json`: non-support role (TOP) consuming influence matrix and `laneGroup(TOP)` (1v1, `lane_full` skipped).
    - `pool_unavailable_and_offrole.json`: pool handling with unknown champions, insufficient data, and `offRole` warnings.
    - `flex_role_inference.json`: enemy flex pick evaluated with role inference confidence weighting.
    - `blind_partial_lane_support_known.json`: enemy SUPPORT known, blind safety scores only the unseen ADC role.
    - `adc_blind_pick.json`: ADC blind pick ranked by matchups against unseen enemy supports.
    - `adc_bot_lane_full.json`: ADC with ally SUPPORT partner, `lane_vs` then `lane_full` in `[ADC, SUPPORT]` key order.
    - `mid_lane_1v1_matchup.json`: MID 1v1 `lane_vs` decides the ranking.
    - `jungle_counter_and_lane.json`: JUNGLE counter pair plus 1v1 `lane_vs`, with a `counteredBy` warning.
    - `support_lane_full_decides.json`: identical `lane_vs`, `lane_full` decides the SUPPORT ranking.
  - **`packages/engine/src/recommend-*.test.ts`** (new, split by feature: ranking, pairs, lanes, role-conflicts, blind-comp, pool-contract): candidate enumeration, baseline gate, score ranking, sequential ranks, tie-breaking by champion ID, pair synergies and counters, bot lane vs and 1v1 lane full skipping, pool contract (score invariance, subsequence order, insufficientData, unknownChampion, offRole, roleProb-set relative order preservation), reason reference validity, reason ordering, determinism, edge cases.
  - **`packages/engine/src/index.ts`** (updated): exported `./comp.js` and `./recommend.js`.
- Files touched:
  - `packages/engine/src/recommend.ts` (new)
  - `packages/engine/src/recommend.ts` split into `recommend-{indexes,slots,terms,reasons,pool,types}.ts`
  - `packages/engine/src/recommend-*.test.ts` (new: ranking, pairs, lanes, role-conflicts, blind-comp, pool, pool-contract, indexes, slots, reasons, terms, types)
  - `packages/engine/src/recommend-test-utils.ts` (new, test-only builders)
  - `packages/engine/src/comp.ts` (new)
  - `packages/engine/src/comp.test.ts` (new)
  - `packages/engine/test/golden.test.ts` (new) and `packages/engine/test/tsconfig.json` (type-checked via `pnpm typecheck`)
  - `packages/engine/src/index.ts` (updated)
  - `packages/engine/src/recommend-role-conflicts.ts`, `packages/engine/src/recommend-role-conflicts.test.ts`, `packages/engine/src/recommend-role-conflicts.unit.test.ts` (new)
  - `packages/engine/src/config.ts`, `packages/engine/src/levels.ts` (updated)
  - `packages/shared/src/schemas/codes.ts`, `packages/shared/src/schemas/recommend-data.ts` (new, with tests)
  - `packages/shared/src/schemas/{tables,draft,reasons}.ts`, `packages/shared/src/index.ts` (updated)
  - `packages/etl/migrations/008_baseline_raw_games.sql` (new) and `packages/etl/src/db/migrate.test.ts` (updated)
  - `vitest.config.ts` and `package.json` (golden tests included in test and typecheck runs)
  - `packages/engine/test/golden/*.json` (16 fixtures)
  - `docs/TICKETS.md` (updated T-023 to DONE)
  - `docs/PROGRESS.md` (updated)
- Tests: `pnpm check` green before the final review pass (25 files, 447 tests). The final pass adds 12 engine tests (5 review-gap tests plus 3 more in the feature-split `packages/engine/src/recommend-*.test.ts` files and 4 in the new `packages/engine/src/recommend-terms.test.ts`) and scales the hard-counter warning by influence.
  - Owner review pass (2026-10-31, D-030 items 10-14): `RecommendData` moved to `@draftorb/shared`; recommendation weights, thresholds and lane groups now come from an injectable `RecommendConfig` (`DEFAULT_RECOMMEND_CONFIG`), the 4th argument of `recommend` (replaces `compConfig`; B-027 fixed); hard-counter warnings reuse the counter reason `deltaPp`; exact score ordering; `reliability.games` renamed `reliability.nEff`; `CompNeedResult.reasons` removed (codes only); duplicate championIds per team deduplicated. New golden fixtures: `adc_bot_lane_full`, `mid_lane_1v1_matchup`, `jungle_counter_and_lane`, `support_lane_full_decides` (12 total at that point). Baseline before this pass: 31 files, 523 tests. Final state: `pnpm check` green in CI (test on ubuntu-latest and windows-latest, lint, format). Follow-up review pass: `blindOpponentMinShare` config, exact pair running log-odds, `toReasonLevel` throws on invalid levels, zod-validated golden fixtures, golden fixtures `blind_partial_lane_support_known` and `adc_blind_pick` (14 total), new tests `packages/engine/src/recommend-role-conflicts.unit.test.ts` and `packages/shared/src/schemas/recommend-data.test.ts`.
- State left: **DONE (T-023)**.
- Next step: T-024 (Blind pick mode) or T-025 (Comp needs) or T-015 (Aggregate role probabilities in ETL).

### 2026-10-29 — Kilo — Ticket T-022 (Shrinkage + level mapping)

- Done:
  - **`packages/engine/src/levels.ts`** (new): pure, deterministic functions implementing SPECS §5 and D-021's layered shrinkage model on equivalent counts:
    - `layerWinRate(winsE, gamesE, k, q)` — shrunk win rate `(winsE + k*q)/(gamesE + k)`, semantic wrapper around T-020's `shrink`.
    - `layerTerm(pL, q, eps)` — log-odds correction `logit(pL) - logit(q)` with eps clamping.
    - `pairTerm(winsE, gamesE, k, p0, eps, minGames)` — `logit((winsE + k*p0)/(gamesE + k)) - logit(p0)`; returns 0 when lowData (`gamesE < minGames`).
    - `laneTerm(winsE, gamesE, kLane, q, eps, minGames)` — same shape, shrunk toward the running prediction `q`; returns 0 when lowData.
    - `isLowData(nEff, minGames)` — `!(nEff > 0 && nEff >= minGames)`, so empty, below-`minGames` and NaN samples are lowData.
    - `deltaPp(x, term)` — `100 * (sigmoid(x + term) - sigmoid(x))`.
    - `mapDeltaPpToLevel(deltaPp, nEff, minGames, highLevelMinGames)` — non-finite inputs map to 0; L1/L2/L3 thresholds (≥1.0/2.5/4.5 pp); any lowData reason (`n_eff < minGames`, default 25) maps to 0 for both signs (SPECS §5); positive L2/L3 require `n_eff >= highLevelMinGames` (config, default 100, validated `>= minGames`) and otherwise fall back to L1; negative levels (counters) are not subject to the `highLevelMinGames` gate.
    - `baselineGate(nEff, minGames)` — candidate passes the baseline gate only when `n_eff >= minGames`.
    - `baselineLogOdds(winsE, gamesE, k0, eps)` — `logit((winsE + k0*0.5)/(gamesE + k0))`, delegates to `shrink` so zero-evidence/zero-prior returns `logit(0.5) = 0` instead of NaN.
    - `scorePair` / `scoreLane` (`{ term, lowData }`) and `levelFromConfig` — config-driven wrappers so callers pass one `RankWeightingConfig` and get the SPECS §5 lowData flag.
    - `clampedLogit` (internal) — logit with clamping to `[eps, 1-eps]`.
  - **`packages/engine/src/levels.test.ts`** (new, 38 tests): `isLowData` (NaN, empty, minGames boundary); `laneTerm` (lowData at `minGames - 1` / `minGames`, shrinks toward q); `scorePair` / `scoreLane` / `levelFromConfig` (lowData flag, config thresholds); `layerWinRate` (shrinks toward q, converges to raw rate, no-data fallback, k-in-raw-game-units toy proof); `layerTerm` (zero/positive/negative, shrinks toward q); `pairTerm` (formula, no-data returns 0, clamping); `deltaPp` (formula, zero-term, positivity); `mapDeltaPpToLevel` (L1/L2/L3 thresholds, `highLevelMinGames` gating for L2/L3 incl. a custom value, negative levels not gated, minGames floor, non-finite inputs); `baselineGate` (pass/fail); `baselineLogOdds` (formula, no-data, no NaN/infinity). Plus a non-support TOP lane-group test proving the full chain (baseline → pair → lane_vs, `lane_full` skipped) produces a finite in-range score.
  - **`packages/engine/src/index.ts`** (updated): barrel re-exports `./levels.js`.
- Files touched: `packages/engine/src/levels.ts` (new), `packages/engine/src/levels.test.ts` (new), `packages/engine/src/index.ts` (updated), `packages/engine/src/config.ts` (updated: `highLevelMinGames`), `packages/engine/src/config.test.ts` (updated), `docs/SPECS.md` (§5 levels: tunable `highLevelMinGames`, L1 fallback, lowData = 0), `docs/TICKETS.md`, `docs/PROGRESS.md`.
- Tests: `pnpm check` — green (22 test files, 333 tests passed after review follow-up; +41 new).
- Bugs: B-031 and B-032 (found in review, fixed — see follow-up below). The `baselineLogOdds(0, 0, 0, eps)` NaN edge case (zero prior strength + zero evidence) was caught by a test and fixed by delegating to `shrink` (which returns the prior q when `gamesE + k <= 0`), consistent with the B-026 fix in T-020.
- Review follow-up: fixed B-031 (pair/lane terms below `minGames` now contribute 0; added `isLowData` and gated `laneTerm`) and B-032 (`mapDeltaPpToLevel` takes `minGames`, gates lowData for both signs, falls back to L1 when `n_eff < highLevelMinGames`, now a validated config field). The k-units test now converts weighted counts via `toEquivalentCounts`; the TOP chain test uses valid counts and asserts the lowData fallback and large-sample dominance. `docs/BUGS.md` updated.
- State left: **DONE (T-022)**.
- Next step: T-023 (Recommendation engine, depends on T-020..T-022).

### 2026-10-29 — Kilo — Ticket T-014 (Participant enrichment)

- Done:
  - Created `packages/etl/src/enrichment.ts` with `enrichParticipants(matchId, participants, options)` and helpers (`enrichBotLaneRanks`, `enrichMasteryForParticipants`, `rankSummary`), plus the `EnrichmentOptions`/`EnrichmentSummary` interfaces. Ranks for the 4 bot-lane participants (ADC + SUPPORT on both teams) are fetched via `league-v4` by puuid and cached in the `players` table; unranked players cached with NULL `rank_score`. `avg_rank_score`/`rank_known_count` recomputed via `updateMatchRankStats` in `matches-store.ts`. `champion_games` computed as a count of games per (puuid, champion) in our data. `mastery_points` filled via champion-mastery-v4 (`client.getChampionMastery`) for `myRole` participants with `champion_games < minChampGames`, at most once per (puuid, champion) pair (reuses mastery from other match rows, stores 0 for never-played, caches to prevent re-fetch on re-run). Added `getChampionMastery` method to `RiotClient` with HTTP error handling and rate limiting (tested in `riot/client.test.ts`). Failure isolation: rank fetch failures and mastery fetch failures are caught per-participant and counted in `summary.failures` without aborting. Wired enrichment into the ingestion pipeline in `matches-process.ts` and `matches.ts` (via `enrichmentOptions` on `MatchProcessContext`). Phase 1 defaults to `myRole = 'SUPPORT'`.
  - Created `packages/etl/src/enrichment.test.ts` (22 tests): 7 HTTP error-handling tests for `getChampionMastery` (404, 429 with Retry-After, 5xx with backoff, 401 no retry, 429 exhaustion, rate limiting, URL correctness); 22 enrichment tests across rank enrichment, champion games + mastery, match rank stats, and failure isolation.
  - Added `RiotChampionMastery` type and `riotChampionMasterySchema` to the Riot schemas module and re-exported from `index.ts`.
  - Added `updateMatchRankStats(db, matchId, avgRankScore, rankKnownCount)` to `matches-store.ts`.
  - Updated `index.ts` to export `enrichParticipants`, `EnrichmentOptions`, `EnrichmentSummary`, `createRankLoader`, `rankSummary`, `updateMatchRankStats`, `riotChampionMasterySchema`, `RiotChampionMastery`.
  - Updated `RIOT_API.md` to mark champion-mastery-v4 as implemented/verified.
- Files touched: `packages/etl/src/enrichment.ts` (new), `packages/etl/src/enrichment.test.ts` (new), `packages/etl/src/matches-store.ts`, `packages/etl/src/matches-process.ts`, `packages/etl/src/matches.ts`, `packages/etl/src/riot/schemas.ts`, `packages/etl/src/riot/client.ts`, `packages/etl/src/riot/client.test.ts`, `packages/etl/src/index.ts`, `docs/RIOT_API.md`, `docs/TICKETS.md`, `docs/PROGRESS.md`.
- Tests: `pnpm check` — green (20 test files, 270 tests passed).
- State left: **DONE (T-014)**.
- Next step: T-015 (Aggregate role probabilities, depends on T-014).
- Pitfalls / notes for next AI: the enrichment runs outside the persistence
  transaction (after `persistAcceptedMatch` returns); `RiotClient.getChampionMastery`
  uses the champion-mastery-v4 endpoint; review fixes B-027 (unranked seed filtering),
  B-028 (enriched flag + reprocess pass on completed cursors), B-029 (champion_games
  refresh on all rows), B-030 (participant rank_score persistence) were applied.

The 2026-10-22 entries had no timestamps; their order was reconstructed from ticket dependencies on 2026-10-26.

### 2026-10-29 — Kilo — Ticket T-020 (Rank weighting module)

- Done:
  - **`packages/engine/src/config.ts`** (new): zod-validated rank-weighting config with the influence matrix `influence[myRole][side][otherRole][phase]` for `draft` and `lane` phases (the `mid` phase is derived at runtime via `getInfluence` using `lambda`). The matrix validation (`.superRefine`) enforces: (a) every cell in `[0, 1]`, (b) ally rows have `null` for the self-role (omitted) and numeric values for the other 4 roles, (c) enemy rows have all 5 cells numeric, and (d) the enemy self-role cell (direct opponent) is the row maximum. All 5 roles are present in every row (zod 4 `z.record(enumSchema, …)` requires every key). Included the SPECS §5 default values for all 5 roles (SUPPORT, ADC, JUNGLE, MID, TOP). Scalar config params: `tau=1.25`, `decay=0.85`, `unknownRankFactor=0.5`, `rankWindowTiers=2`, `minGames=25`, `k0=20`, `k=40`, `kLane=40`, `s=1.0`, `eps=1e-4`, `lambda=0.3`, `contextSlots=3`, `minChampGames=30`, `minMasteryPoints=50000`, `alpha=0.25`, `wMax=2.0`, `exportMinGames=10`. Also exported `Phase`, `Side`, `ROLES`, `SIDES`, `RANK_BUCKET_ORDER`, `rankToBucket()`, `bucketIndex()` helpers.
  - **`packages/engine/src/weighting.ts`** (new): pure functions — `rankDistanceWeight` (rank-distance kernel, `exp(-|Δ|/tau)` with rank-window floor), `expertWeight` (expert-phase weight for runes/items, `min(1 + alpha*Δ, wMax)`), `recencyFactor` (`decay^(patch diff)`), `reliabilityFactor` (`unknownRankFactor` when `rankKnownCount <= 1`), `combinedGameWeight` (kernel × recency × reliability), `nEff` (`(Σw)²/Σw²`), `toEquivalentCounts` (`games_e = n_eff`, `wins_e = wins_w * n_eff / games_w`), `logit` (clamped to `[eps, 1-eps]`), `sigmoid` (numerically stable), `shrink` (toward prior with k equivalent-game strength), and re-exported `getInfluence`/`InfluenceOpts` from config.
  - **`packages/engine/src/config.test.ts`** (new, 23 tests): rank-bucketing helpers, influence matrix validation (accepts default; accepts non-support TOP row; rejects incomplete ally/enemy rows; rejects non-max opponent cell; rejects ally self-role as number; rejects enemy null cell; rejects out-of-`[0,1]` cells; accepts tied opponent), config schema validation (DEFAULT_CONFIG valid; strict mode rejects unknowns; scalar range checks), and `getInfluence` (draft/lane lookup, null self-role returns 0, mid ally = lane, mid enemy derived with `lambda` and threat shares).
  - **`packages/engine/src/weighting.test.ts`** (new, 39 tests): boundary values for `rankDistanceWeight` (same bucket=1, decay by distance, floor cutoff, symmetry), `expertWeight` (below user=0, at user=1, per-tier increase, wMax cap), `recencyFactor` (same patch=1, decay^n, monotonic), `reliabilityFactor` (≤1 known → factor, >1 → 1), `combinedGameWeight` (multiplicative, zero on exclusion, unknownRankFactor), `nEff` (equal weights→n, single game→1, zero games, uneven weights, dominant weight), `toEquivalentCounts` (equal weights → identity, zero, rate ratio invariant, uneven), `logit`/`sigmoid` (logit(0.5)=0, sigmoid(0)=0.5, round-trip, clamping, bounds at extremes), `shrink` (small data shrinks toward q, large data converges, zero games returns q).
  - **`packages/engine/src/index.ts`** (updated): barrel now re-exports `./config.js` and `./weighting.js`.
  - Removed placeholder `packages/engine/src/hello.ts` and `hello.test.ts` (real engine code replaces them).
- Files touched: `packages/engine/src/config.ts` (new), `packages/engine/src/weighting.ts` (new), `packages/engine/src/config.test.ts` (new), `packages/engine/src/weighting.test.ts` (new), `packages/engine/src/index.ts` (rewritten), `packages/engine/src/hello.ts` (deleted), `packages/engine/src/hello.test.ts` (deleted), `docs/TICKETS.md`, `docs/PROGRESS.md`.
- Tests: `pnpm check` — green (19 test files, 244 tests passed, later 248 after adding the exportMinGames and shrink regression tests).
- Bugs: B-026 — `shrink(0, 0, 0, q)` returned NaN for empty contexts with zero prior strength; fixed by returning the prior `q` when `gamesE + k <= 0`. Added regression test. No other bugs found.
- State left: **DONE (T-020)**.
- Next step: **T-021** (Role inference — depends on T-002 which is DONE; builds on T-020's config/kernel foundation).
- Pitfalls / notes for next AI: No new dependencies added (reuses `@draftorb/shared` zod re-export). The influence matrix stores `draft` and `lane` phases only; `mid` is derived by `getInfluence` using `lambda` + runtime `threatShares`/`enemiesKnown`. `rankDistanceWeight` operates on numeric bucket indices (0–7); mapping `DraftInput.userRank` (10-tier `Rank`) to a bucket index goes through `rankToBucket` + `bucketIndex`. The `combinedGameWeight` helper is available for the ETL (T-016) to compute per-game weights during aggregation, but the rank-distance kernel is applied per-bucket at query time since exported data is bucket-indexed.

### 2026-10-29 — Kilo — Review fixes for T-002.b schemas (D-029)

- Done:
  - **reasons.ts**: `Reason.lowData` changed from optional to required (`z.boolean()`). Documented that the engine emits it for every reason: `true` when the supporting term has `n_eff < minGames` (the term contributes 0 to the score), `false` otherwise including non-data-driven reasons (e.g. `comp`).
  - **core.ts**: added `MANIFEST_SCHEMA_VERSION = 1` shared constant and re-exported it from the barrel.
  - **manifest.ts**: `schemaVersion` changed from `z.number().int().positive()` to `z.literal(MANIFEST_SCHEMA_VERSION)`, pinning the role-keyed manifest to the agreed version 1. Updated doc comment.
  - **champions.ts**: `roleProbInnerSchema` value changed from `z.number().finite().min(0).max(1)` to `z.number().finite().gt(0).max(1)`, rejecting zero-valued role entries that violate the sparse-map contract. Sum-to-1 refinement retained.
  - **draft.ts**: `championPoolSchema` now uses a refined `z.array(championIdSchema)` that rejects duplicate champion ids per role. Updated doc comment.
  - **index.test.ts**: made the zero-valued role-map test sparse (removed `TOP: 0, JUNGLE: 0`); added a negative test rejecting zero-valued roles; added a negative test rejecting duplicate pool ids.
  - **parity.test.ts**: changed manifest `schemaVersion` from 2 to 1; added negative assertion that version 2 is rejected; added `MANIFEST_SCHEMA_VERSION` export check.
  - **DECISIONS.md**: added D-029 documenting all four review resolutions.
- Files touched: `packages/shared/src/schemas/core.ts`, `packages/shared/src/schemas/reasons.ts`, `packages/shared/src/schemas/manifest.ts`, `packages/shared/src/schemas/champions.ts`, `packages/shared/src/schemas/draft.ts`, `packages/shared/src/index.ts`, `packages/shared/src/index.test.ts`, `packages/shared/src/schemas/parity.test.ts`, `docs/DECISIONS.md`, `docs/PROGRESS.md`
- Tests: `pnpm check` — green (18 test files, 185 tests passed; +1 new test for zero-prob rejection).
- State left: DONE (review fixes).
- Next step: T-020 (Rank weighting module — first engine module).
- Pitfalls / notes for next AI: no downstream consumers of these schemas yet (T-020/T-019 not started); all changes are pure schema/validation fixes with no logic.

### 2026-10-29 — Kilo — Ticket T-002.b (Shared schema parity for D-020..D-023)

- Done:
  - Split `packages/shared/src/index.ts` (was 312 lines, over the 300-line convention) into domain modules under `packages/shared/src/schemas/`: `core.ts` (SHARED_VERSION, roleSchema, rankSchema, rankBucketSchema, championId/itemId, damageType, championRange), `reasons.ts` (reasonType/reasonLevel/reason, reliability, recommendation), `draft.ts` (slot, draftInput, championPool, insufficientDataEntry, poolUnavailableEntry, draftResult), `game.ts` (playerState, gameState), `champions.ts` (champion, championsMap, championRoleProbabilities), `tags.ts` (tags), `manifest.ts` (manifestFile, manifest), `tables.ts` (support* + role-keyed export tuples), `items.ts` (item + itemBuild export schemas), `runes.ts` (rune trees, runePage, rune export schemas). `index.ts` is now a thin re-export barrel.
  - Added `rankBucketSchema` (8 buckets: IRON, BRONZE, SILVER, GOLD, PLATINUM, EMERALD, DIAMOND, MASTER_PLUS) replacing `rankSchema` in `supportPairEntrySchema`, `supportBaselineEntrySchema`, and `manifestSchema.rankBuckets`. `rankSchema` (10 raw tiers) retained for `draftInputSchema.userRank` and CLI tier parsing.
  - Reason type `lane` added to `reasonTypeSchema`. `Reason.with` changed from single `ChampionId` to `ChampionId[]`. `Reason.lowData` added. `Reason.n` and `Reliability.games` changed from `z.number().int()` to `z.number()` (n_eff is a real number, D-027).
  - `Recommendation.poolRank?` added (D-024). `DraftResult` schema added with `insufficientData` (`{ championId, nEff, rawGames }`), `poolRecommendations?` (Recommendation[]), `poolUnavailable?` (`{ championId, reason: 'insufficientData' | 'unknownChampion' }[]`).
  - `championPoolSchema` added: versioned envelope `{ version: 1, pools: { <ROLE>: ChampionId[] } }` using `z.partialRecord` for sparse role maps.
  - `championRoleProbabilitiesSchema` changed to sparse via `z.partialRecord(roleSchema, ...)` with sum-to-1 refinement (tolerance 1e-6, D-027).
  - Manifest schema: added `roles: z.array(roleSchema)`, changed `rankBuckets` to `z.array(rankBucketSchema)`.
  - Added role-keyed export tuple schemas (DATA_MODEL.md): `baselineEntrySchema` (5-tuple), `allyPairEntrySchema` (7-tuple), `enemyPairEntrySchema` (7-tuple), `laneVsEntrySchema` (7-tuple with nullable opp2Id for 1v1), `laneFullEntrySchema` (8-tuple with nullable partnerId/opp2Id for 1v1). All include `gamesW2`.
  - Added rune export schemas (`runeContextPageSchema`, `runeContextEntrySchema`, `runeExportSchema`) and item build export schemas (`itemBuildEntrySchema`, `itemBuildContextSchema`, `itemBuildExportSchema`) with `gamesW2` on every row. Added `gamesW2` to existing `runePageSchema`.
  - Added `CHAMPIONS_TRIVIAL_VERSION` constant note. Updated `tags.ts` with `ChampionTagsScaling` type export.
  - Updated `index.test.ts`: all existing tests updated for new field shapes; added 10 new test cases covering rankBucketSchema, sparse role-prob, non-array `with` rejection, poolRank, lane reason type, non-integer n_eff, role-keyed export tuples, nullable lane fields, pool envelope, DraftResult, rune/build exports.
  - Added `schemas/parity.test.ts`: 17 D-011 contract parity tests that fail if any required schema or field is missing.
- Files touched: `packages/shared/src/index.ts` (rewritten as barrel), `packages/shared/src/schemas/core.ts` (new), `packages/shared/src/schemas/reasons.ts` (new), `packages/shared/src/schemas/draft.ts` (new), `packages/shared/src/schemas/game.ts` (new), `packages/shared/src/schemas/champions.ts` (new), `packages/shared/src/schemas/tags.ts` (new), `packages/shared/src/schemas/manifest.ts` (new), `packages/shared/src/schemas/tables.ts` (new), `packages/shared/src/schemas/items.ts` (new), `packages/shared/src/schemas/runes.ts` (new), `packages/shared/src/index.test.ts` (updated), `packages/shared/src/schemas/parity.test.ts` (new), `docs/TICKETS.md`, `docs/PROGRESS.md`
- Tests: `pnpm check` — green (18 test files, 184 tests passed). No existing tests modified beyond schema-shape updates; no behavior changed in ETL/engine packages.
- State left: DONE (T-002.b).
- Next step: T-020 (Rank weighting module — first engine module, all purity guardrails in place) or T-014 (Participant enrichment, data-blocked).
- Pitfalls / notes for next AI: `rankSchema` (10 tiers) is still the correct schema for `DraftInput.userRank` and CLI tier parsing; `rankBucketSchema` (8 buckets) is used only for aggregation/export row `bucket` columns and manifest. The `WEIGHTS` const tuple in `tables.ts` uses `as const` — if you need to add a field to all export schemas, update the tuple there.

### 2026-10-29 — Kilo — Ticket T-021 (Role inference)

- Done:
  - **`packages/engine/src/roles.ts`** (new): `inferRoles(slots, roleProb)` implementing SPECS §4 — brute-force over all 120 role permutations (5! = 120) for full 5-slot teams, maximizing the sum of log roleProb subject to "one champion per role." Two validity checks per permutation: `assignmentIsValid` (fixed roles preserved) and `assignmentIsViable` (every slot has non-zero probability for its assigned role — champions missing from the map or with 0 prob for all roles make a permutation non-viable). Confidence = best permutation's probability mass / total probability mass across all viable permutations; 1 when only one viable permutation exists (incl. all-fixed teams and single-role champions with no conflict). Partial teams (< 5 slots) use the same exact solver over distinct role assignments of the present slots; per-slot confidence = marginal probability mass of the chosen role across viable assignments (1 for fixed/forced slots). Fixed roles are user overrides (prob 1, exempt from viability), duplicate fixed roles → null, and positive probabilities are never floored (`ROLE_INFERENCE_EPS` is only a log(0) guard in `assignmentLogProb`). Exported `assignmentConfidence` helper (assignedProb / (assignedProb + alternativeProb)) for downstream use.
  - **`packages/engine/src/roles.test.ts`** (new, 15 tests): fixed-role teams (all-fixed + empty), all-unassigned (peaked preferences, mixed preferences with conflict), flex champions (50/50), partially known teams (one fixed role, conflicting fixed roles → null), peakness vs confidence (peaked > flat, single-role → confidence 1), single-role champion forces its role, missing champion → null, partial teams (< 5 slots, exact joint assignment + fixed in partial), and `assignmentConfidence` edge cases.
  - **`packages/engine/src/index.ts`** (updated): re-exports `./roles.js`.
- Files touched: `packages/engine/src/roles.ts` (new), `packages/engine/src/roles.test.ts` (new), `packages/engine/src/index.ts` (updated), `docs/TICKETS.md`, `docs/PROGRESS.md`.
- Tests: `pnpm check` — green (21 test files, 285 tests passed).
- State left: **DONE (T-021)**.
- Next step: T-022 (Shrinkage + level mapping).

### 2026-10-29 — Antigravity — ADR review: accept D-008, D-011, D-017, D-018, D-020..D-023, D-028

- Done:
  - Read DECISIONS.md, TICKETS.md and cross-referenced code in `packages/` for every PROPOSED decision.
  - Accepted D-008 (rank at collection time — unavoidable API limitation, already baked into all ETL code).
  - Accepted D-011 (contract parity gate — prevents schema drift between packages).
  - Accepted D-017 (`match_rejects` table and lower-bound patch filter — fully implemented and tested; critical for API budget).
  - Accepted D-018 (incremental `startTime` cursors — fully implemented and tested; avoids full re-listing on every run).
  - Accepted D-020 (role-relative influence matrix — role-generic architecture from day one; weights are prior-only and will be calibrated by D-023 backtest).
  - Accepted D-021 (log-odds shrinkage back-off — mathematically bounds win rates; DB tables `lane_vs`/`lane_full`/`games_w2` already migrated in 004/005).
  - Accepted D-022 (like-for-like item/rune comparison + expert definition — removes survival/state bias; schema columns already in migration 004).
  - Accepted D-023 (offline backtest gate — prevents speculative tuning; pure engine ensures same code runs in browser and backtest).
  - Renumbered the original D-025 (type-only `@types/...` devDeps) to D-028 to resolve the ID collision with the existing D-025 correction entry; accepted D-028.
  - Updated D-025 correction entry: its internal reference changed from "D-025 (above)" to "D-028 (formerly D-025)".
  - Removed the "Implements PROPOSED D-020: start after the owner accepts it" note from T-020 in TICKETS.md.
  - Updated PROGRESS.md: E2 epic status, "Next recommended ticket", and "Open questions" (removed the D-008..D-025 acceptance question).
- Files touched: `docs/DECISIONS.md`, `docs/TICKETS.md`, `docs/PROGRESS.md`
- Tests: docs-only change; no code modified. `pnpm check` was green before this session (15 test files, 153 tests passed per last session entry).
- State left: All PROPOSED decisions resolved. SPECS §5/§8 are normative. T-002.b (schema parity) and T-020 (rank weighting module) are now fully unblocked.
- Next step: **T-002.b** (Shared schema parity — D-020..D-023 now accepted, D-027 locked, all spec questions resolved) or **T-020** (Rank weighting module in `packages/engine`).
- Pitfalls / notes for next AI: D-028 was formerly D-025 — any code comment referencing "D-025 (type-only deps)" should be updated to D-028 if encountered. The second D-025 entry (the `@types/node` version correction) stays at D-025. SPECS §5/§8 are normative only once D-020..D-023 are accepted — they are now accepted.

### 2026-10-29 — Antigravity — Ticket T-013.d (ETL status command)

- Done:
  - Implemented `getEtlStatus(db, platform?)` and `formatEtlStatus(status)` in `packages/etl/src/status.ts`. Queries are strictly read-only parameterized SQL returning migration status (`applied`, `pending`, `missingVersions`), players per platform and tier, matches per platform and patch, total participants count, resumable match cursors done vs partial per platform (`match-ingest:<platform>:%`), and rejects per reason.
  - Made schema inspection strictly non-mutating: migration versions are computed by reading migrations from disk and querying `_migrations` only if it exists without invoking write-capable helpers (`ensureMigrationsTable`), leaving unmigrated database files untouched.
  - Handled older schemas before migration 003 dynamically via `PRAGMA table_info(matches)` checking for `rank_known_count`, keeping `getEtlStatus` functional on 001/002 databases and omitting `rankKnownCount1` without SQL column errors.
  - Clarified report scope in `formatEtlStatus`: labeled match cursors explicitly as `Match cursors:` and labeled rejects as `Rejects (global):` to prevent misinterpretation as platform-scoped.
  - Implemented CLI command `status [platform]` in `packages/etl/src/commands/status.ts`, registered in `packages/etl/src/cli.ts`, and removed `status` from `PLANNED_COMMANDS` in `packages/etl/src/commands/shared.ts`. Resolves database path read-only without creating parent directories, prints "no database at <path>" and exits 0 when DB does not exist, and opens existing databases with `{ readonly: true, fileMustExist: true }`.
  - Added unit test suites in `packages/etl/src/status.test.ts` (6 tests: empty DB, 001/002 DB without `rank_known_count`, readonly unmigrated DB, seeded DB, platform filtering, missing migration formatting) and `packages/etl/src/commands/status.test.ts` (6 tests: non-existent DB, non-existent parent directory, unmigrated DB immutability, existing DB formatting, platform positional arg, usage error on invalid platform).
  - Re-exported status types and functions from `packages/etl/src/index.ts`.
  - Moved `pnpm etl status [platform]` to "Implemented" in `docs/SETUP.md`.
- Files touched: `packages/etl/src/status.ts`, `packages/etl/src/status.test.ts`, `packages/etl/src/commands/status.ts`, `packages/etl/src/commands/status.test.ts`, `packages/etl/src/commands/shared.ts`, `packages/etl/src/cli.ts`, `packages/etl/src/index.ts`, `docs/SETUP.md`, `docs/TICKETS.md`, `docs/PROGRESS.md`
- Tests: `pnpm check`
- State left: DONE (T-013.d).
- Next step: T-002.b (shared schema parity) or T-014 (participant enrichment).
- Pitfalls / notes for next AI: none

- Done:
  - `RiotClient.request()` overloads now require a schema for the typed overload and return `unknown` when no schema is passed — `request<T>(url, schema: z.ZodType<T>, methodKey?): Promise<T>` and `request(url, schema?: undefined, methodKey?): Promise<unknown>` — and the unused private `parseJsonBody()` was deleted. Fixed every call site the compiler reported, including the two `client.request<{...}>(url)` tests in `riot/client.test.ts`, which now pass an explicit schema.
  - Added three regression tests in `riot/client.test.ts`: (a) a fetch that only settles when its `AbortSignal` fires (small `timeoutMs`, fake `sleepFn`, `max5xxRetries: 2`) is retried, then throws `RiotApiError` with status 0; (b) a 200 response with body `'not json'` is retried with backoff and throws `RiotApiError` once retries are exhausted (status 200, body `'not json'`); (c) a non-JSON 200 followed by a valid JSON 200 resolves.
  - `tags.ts` now validates the champions file with `championsMapSchema` from `@draftorb/shared` instead of `as ChampionsMap`; schema issues are pushed onto `errors`. As a consequence of the empty-catalog fallback, `evaluateChampionTagsCoverage`/`formatCoverageReport` no longer claim "100% support coverage" / "All required support champions are tagged!" for an empty (rejected) catalog — they report 0% and "No support champions found in catalog." instead.
  - Added a regression test in `tags.test.ts` for a malformed champions catalog (invalid role): `isValid` false, errors include `Champions schema error`, `totalChampions` 0, `supportCoveragePercent`/`overallCoveragePercent` 0, and the report no longer claims all supports are tagged.
  - Added brief JSDoc to the four exported helpers in `commands/shared.ts` (`parsePositionals`, `parsePlatform`, `parseVersion`, `formatHelp`).
  - Split `cli.ts` into a thin entrypoint plus one file per command under `packages/etl/src/commands/` (`shared`, `static`, `validate-tags`, `check-key`, `players`, `matches`, `migrate`); shared helpers (`log`, `parsePositionals`, `parsePlatform`, `parseVersion`, `Command`, `findCommand`, `formatHelp`, `isHelpFlag`, `PLANNED_COMMANDS`, constants) live in `commands/shared.ts`.
  - Split `matches.ts` (449 lines): the per-match processing loop body (with `isTransientMatchError`) now lives in `packages/etl/src/matches-process.ts` (`processMatch`), leaving `matches.ts` as the orchestrator. The resumed/duplicate/404/invalid/repair paths and per-match cursor persistence are unchanged (no behavior change).
- Files touched: `packages/etl/src/riot/client.ts`, `packages/etl/src/riot/client.test.ts`, `packages/etl/src/tags.ts`, `packages/etl/src/tags.test.ts`, `packages/etl/src/cli.ts`, `packages/etl/src/matches.ts`, (new) `packages/etl/src/commands/shared.ts`, (new) `packages/etl/src/commands/static.ts`, (new) `packages/etl/src/commands/validate-tags.ts`, (new) `packages/etl/src/commands/check-key.ts`, (new) `packages/etl/src/commands/players.ts`, (new) `packages/etl/src/commands/matches.ts`, (new) `packages/etl/src/commands/migrate.ts`, (new) `packages/etl/src/matches-process.ts`, `docs/TICKETS.md`, `docs/PROGRESS.md`
- Tests: `pnpm check` — 15 test files, 145 tests passed (141 baseline + 3 client + 1 tags). `pnpm etl help` output diffed identical before/after the CLI split; `pnpm etl matches --help`, `pnpm etl players --help`, and `pnpm etl bogus` (usage exit 2) verified command dispatch.
- State left: DONE (T-013.e).
- Next step: T-013.d (`pnpm etl status`), or T-002.b / T-014.
- Pitfalls / notes for next AI: none

### 2026-10-29 — Kilo — Bug B-016 (duplicate B-007 ID)

- Done:
  - Resolved the B-016 ID collision: kept B-007 for "Seed rank was excluded from rank reliability counts"; renumbered the duplicate "Invalid match responses left the ingestion cursor stuck" to B-025 (the next free ID after B-024) with the title note "(formerly a duplicate B-007)"; removed B-016 from the Open table and Open detailed section and added its detailed entry to `## Fixed` with status FIXED.
  - Verified no code or commit references to B-007 or B-016 exist outside `docs/BUGS.md`.
- Files touched: `docs/BUGS.md`, `docs/PROGRESS.md`
- Tests: none (docs-only change). `pnpm check` was green before this session; this change alters no code.
- State left: FIXED (B-016). All bug IDs are now unique.
- Next step: T-014 (participant enrichment) or T-002.b (schema implementation).
- Pitfalls / notes for next AI: none

### 2026-10-29 — Kilo — Bug B-011 (spec-level: reason/rank-bucket/role-prob divergence)

- Done:
  - Resolved B-011 at the spec level (docs only, no code; T-002.b will implement the schemas later).
  - **SPECS §7**: explicitly stated that `Reason.n` and `Recommendation.reliability.games` carry `n_eff` (a real number, not a raw game count), because every threshold and `lowData` flag is evaluated against `n_eff`; `DraftResult.insufficientData` separately exposes both `nEff` and `rawGames`.
  - **SPECS §3**: defined the 8 rank buckets (IRON=0 .. DIAMOND=6, MASTER_PLUS=7 where MASTER_PLUS merges MASTER/GRANDMASTER/CHALLENGER). Stated that exports and `manifest.rankBuckets` use these 8 buckets, not the 10 raw rank tiers.
  - **DATA_MODEL**: documented that `rank_bucket`/`bucket` columns and `MANIFEST.rankBuckets` use the 8 buckets; stated `role-prob.json` is sparse (only roles with games), added the zod 4 note that `z.record(enumSchema)` requires every key so a sparse map needs `z.partialRecord`, and added the sum-to-1 invariant (tolerance 1e-6).
  - **TICKETS.md T-002.b**: added `Reason.with: ChampionId[]`, `Reason.lowData`, `rankBucketSchema` (8 buckets), the sparse role-prob shape with sum check, and the `n_eff` semantics to both scope and acceptance; removed the "See B-011 ..." sentence.
  - **DECISIONS.md**: added D-027 recording the three owner choices (ACCEPTED).
  - **BUGS.md**: moved B-011 from Open to Fixed.
- Files touched: `docs/SPECS.md`, `docs/DATA_MODEL.md`, `docs/TICKETS.md`, `docs/DECISIONS.md`, `docs/BUGS.md`, `docs/PROGRESS.md`
- Tests: none (docs-only change). `pnpm check` was green before this session; this change alters no code.
- State left: B-011 FIXED (spec level resolved; schema implementation pending T-002.b).
- Next step: T-014 (participant enrichment) is the next recommended ticket, though blocked on data collection. T-002.b is now fully specified and unblocked.
- Pitfalls / notes for next AI: the three owner choices are locked in D-027; do not revisit dense maps, raw-game `n`, or the `MASTER` bucket name in T-002.b.

### 2026-10-29 — Kilo — Bug B-015 (Node 20 vs better-sqlite3) — Applied Node 22 policy

- Done:
  - Investigated B-015: reproduced the segfault on Node 20.20.2 — `better-sqlite3@13.0.3` exits with code 139 (SIGSEGV) when loaded natively. The 13.x release declares `engines.node: >=22` and has no Node 20 prebuilt binary; no 13.x version works on Node 20.
  - Applied the owner's Node policy [B] (require Node 22):
    - Root `package.json`: `engines.node` changed from `>=20.0.0` to `>=22.0.0`.
    - `AGENTS.md` rule 2: "Node.js 20+" → "Node.js 22+".
    - `docs/SETUP.md`: Prerequisites and Troubleshooting updated to state Node 22 is the minimum and Node 20 is unsupported (B-015).
    - `docs/ARCHITECTURE.md` (Stack): updated to "Node 22 (CI and minimum, enforced by `engines` and CI matrix...)".
    - `@types/node` devDependency aligned from `^26.6.5` to `^22.18.5` (major version matches the minimum supported Node version); `packages/etl/tsconfig.json` already uses `"types": ["node"]` and is unchanged.
    - CI matrix already uses `node-version: [22]` with `node-version: ${{ matrix.node-version }}` in the setup-node step — verified correct, no change needed.
    - Added DECISIONS.md entries D-026 (Node 22 policy, ACCEPTED) and a D-025 correction note for the `@types/node` version change.
  - B-015 moved to FIXED in `docs/BUGS.md` (removed from the Open table and Open detailed section; added detailed entry under `## Fixed`).
  - Removed the "Node version policy (B-015)" open question from PROGRESS.md.
- Files touched: `package.json`, `AGENTS.md`, `docs/SETUP.md`, `docs/ARCHITECTURE.md`, `docs/BUGS.md`, `docs/DECISIONS.md`, `docs/PROGRESS.md`, `.github/workflows/ci.yml` (verified already correct)
- Tests: `pnpm check` on Node 22.23.4 — 15 test files, 141 tests passed. On Node 20.20.2, `better-sqlite3` segfaults (exit 139) — no longer a supported runtime.
- State left: FIXED (B-015). Node 20 is unsupported; Node 22 is the minimum and only CI target.
- Next step: T-014 (participant enrichment) — data collection still pending (no Riot key), but the Node 20 blocker is resolved.
- Pitfalls / notes for next AI: Node 20 users must upgrade to Node 22. `better-sqlite3@13.0.3` is correctly pinned and does not need changing.

### 2026-10-29 — Kilo — Bugs B-022, B-023, B-024 (engine purity lint guards incomplete)

- Done:
  - **B-022**: Replaced the manual subset of Node built-in specifiers in `no-restricted-imports` patterns with a comprehensive list of every Node built-in module in both forms (`module`, `module/*` for subpaths, and `node:*` for the prefix form) covering `assert`, `async_hooks`, `buffer`, `child_process`, `cluster`, `console`, `constants`, `crypto`, `dgram`, `diagnostics_channel`, `dns`, `domain`, `events`, `fs`, `http`, `http2`, `https`, `inspector`, `module`, `net`, `os`, `path`, `perf_hooks`, `process`, `punycode`, `querystring`, `readline`, `repl`, `stream`, `string_decoder`, `sys`, `timers`, `tls`, `trace_events`, `tty`, `url`, `util`, `v8`, `vm`, `wasi`, `worker_threads`, `zlib`, and `better-sqlite3`. Applied to both `packages/engine/**/*.ts` and `packages/shared/**/*.ts` blocks.
  - **B-023**: Added a `CallExpression[callee.name='Date'][arguments.length=0]` selector to `no-restricted-syntax` alongside the existing `NewExpression` selector, so both `Date()` and `new Date()` are rejected with the same purity message. Also converted both selectors to object form with an explicit `message` field.
  - **B-024**: Added `packages/engine/src/lint-regression.test.ts`, a vitest suite (8 tests) that writes fixture files into `packages/engine/src/__lint_test__/`, lints them via the ESLint Node API, and asserts the specific `ruleId` of each error: `no-restricted-imports` for bare `crypto`/`net`/`node:crypto` imports (with imported symbols used to avoid false positives from `no-unused-vars`); `no-restricted-syntax` for `Date()` and `new Date()`; `no-restricted-globals` for `process.cwd()`; `no-restricted-properties` for `Math.random()`; and a pure `add(a, b)` function produces zero errors (guards against overblocking). Added ESLint test-file overrides for `packages/engine/**/*.test.ts` and `packages/shared/**/*.test.ts` to disable the production purity rules in test files (which legitimately need `node:fs`, `node:path`, and `__dirname`).
- Files touched: `eslint.config.mjs`, `packages/engine/src/lint-regression.test.ts`, `docs/BUGS.md`, `docs/PROGRESS.md`
- Tests: `pnpm check` — green (15 test files, 141 tests passed; 8 new regression tests).
- State left: FIXED (B-022, B-023, B-024). B-021 (type-checker gap) remains OPEN.
- Next step: T-014 (participant enrichment). T-020's engine-purity foundation is now fully in place with automated regression coverage.
- Pitfalls / notes for next AI: the ESLint test-file override disables purity rules for `*.test.ts` only; production engine/shared files remain fully guarded. The regression test uses `lintFiles` on real fixture files inside the project so the project service config applies.

### 2026-10-29 — Kilo — Bug B-017 (Node type definitions visible to pure engine/shared)

- Done:
  - Added `"types": []` to `compilerOptions` in `packages/engine/tsconfig.json` and `packages/shared/tsconfig.json`, disabling `@types` auto-inclusion (the mechanism B-017's suspected cause described) for these packages.
  - Added two ESLint blocks to `eslint.config.mjs`: one scoped to `packages/engine/**/*.ts` with `no-restricted-imports` (patterns `node:*`, `fs`, `fs/*`, `path`, `os`, `child_process`, `http`, `https`, `better-sqlite3`), `no-restricted-globals` (`process`, `Buffer`, `__dirname`, `__filename`, `require`, `window`, `document`, `localStorage`, `fetch`), `no-restricted-properties` (`Date.now` and `Math.random`, message "engine must be pure: pass time and seeds in through config"), and `no-restricted-syntax` for `new Date()`; and a second block scoped to `packages/shared/**/*.ts` with the same `no-restricted-imports` rule. Existing blocks left unchanged. Ran `prettier --write eslint.config.mjs`.
  - Note on merge: this fix was cherry-picked onto the current `HEAD` (which had already resolved B-018 and fixed ETL B-019/B-020); I resolved the resulting `docs/BUGS.md` and `docs/PROGRESS.md` conflicts and renumbered the engine type-checker finding from B-019 to **B-021** to avoid colliding with the existing ETL B-019/B-020 entries.
  - Verification by hand (probe added to `packages/engine/src/hello.ts`, then removed):
    - `export const probe = process.cwd();` — `pnpm lint` FAILED (`no-restricted-globals` on `process`); `pnpm typecheck` did NOT fail (exit 0): the engine test file `hello.test.ts` imports `vitest`, whose type declarations import `node:vm` and load `@types/node` globals into the engine `tsc` program, defeating `types: []` for the type-checker (see B-021). `types: []` does correctly disable `@types` auto-inclusion (confirmed by an isolated check: an engine-like tsconfig with `"types": []` and a file using `process.cwd()` that does not import vitest emits `error TS2591: Cannot find name 'process'`).
    - `export const probe = Math.random();` — `pnpm lint` FAILED (`no-restricted-properties` on `Math.random`).
    - Probe removed — `pnpm check` GREEN (14 test files, 133 tests passed).
  - Updated D-014 in `docs/DECISIONS.md`; moved B-017 to `## Fixed` and added B-021 in `docs/BUGS.md`.
- Files touched: `packages/engine/tsconfig.json`, `packages/shared/tsconfig.json`, `eslint.config.mjs`, `docs/DECISIONS.md`, `docs/BUGS.md`, `docs/PROGRESS.md`
- Tests: `pnpm check` — green (14 test files, 133 tests passed); probe `process.cwd()` rejected by `pnpm lint` (`no-restricted-globals`); probe `Math.random()` rejected by `pnpm lint` (`no-restricted-properties`).
- State left: FIXED (B-017). Residual type-checker gap logged as B-021 (OPEN, not fixed — out of scope per AGENTS rule 6).
- Next step: T-014 (participant enrichment). T-020's engine-purity foundation is now in place, but T-020 still awaits D-020..D-023 acceptance.
- Pitfalls / notes for next AI: `types: []` blocks the `@types` auto-inclusion mechanism but NOT type inclusion arriving through a module-import chain; engine/shared test files import `vitest` (which imports `node:vm`), so `@types/node` globals (`process`, `Buffer`) still resolve under `tsc --build`. Only ESLint catches them in production files. If you want `tsc` to reject Node globals in production files too, exclude `**/*.test.ts` from the engine and shared `tsconfig.json` `include` (or add a dedicated test type-check) and re-verify test coverage is still sufficient.

### 2026-10-29 — Devin — Bug B-020 (cappedHasRejected checks unselected entries)

- Done:
  - Wrote a regression test in `players.test.ts` first: EMERALD quota 250, Division I page 1 returns 100 entries (first 63 EMERALD, last 37 GOLD) + Divisions II–IV empty → first run should be `complete` with `fetched: 63`, second run should `skipped` with no re-fetch.
  - Confirmed the test fails with the B-019 `cappedHasRejected` check scanning all `divisionEntries` (100 entries) instead of only `divisionEntries.slice(0, perDivision)` (63 entries): the 37 trailing GOLD entries set `cappedHasRejected = true`, yielding `partial` instead of `complete`.
  - Fixed `packages/etl/src/players.ts`: changed the check to `divisionEntries.slice(0, perDivision).some((e) => (e.tier ?? '').toUpperCase() !== normalizedTier)`, so only the selected entries are evaluated.
  - B-020 FIXED.
- Files touched: `packages/etl/src/players.ts`, `packages/etl/src/players.test.ts`, `docs/BUGS.md`, `docs/PROGRESS.md`
- Tests: `pnpm check` — all green (14 test files, 133 tests passed)
- State left: FIXED
- Next step: T-014 participant enrichment — blocked only by data collection (B-015 Node 20).
- Pitfalls / notes for next AI: the B-019 `cappedHasRejected` guard must check only the slice that feeds into `entries`, not the full page. This mirrors the `entries.push(...divisionEntries.slice(0, perDivision))` selection logic.
- Docs cleanup: resolved B-018 — moved B-014 from `## Open` (table + detailed entry) into `## Fixed` so it has a single entry, and updated the stale B-006 follow-up reference.

### Template

```
### YYYY-MM-DD — <AI name/model> — Ticket T-xxx
- Done:
- Files touched:
- Tests: (command + result)
- State left: DONE / REVIEW / WIP
- Next step:
- Pitfalls / notes for next AI:
```

## Phase B — D-082 item-context corrections (feat/d082-item-contexts-fix)

- Raw timeline model: `item_events` (purchase/undo/sold/destroyed +
  participant_id + seq), `kill_events`, `match_participant_ids`,
  `extractor_runs`; migrations 017-018. `etl timeline` and new
  `etl backfill-timelines --call-budget` share the registry pipeline.
- Item taxonomy: `etl classify-items` generates
  `data/item-classes.generated.json` (+ `data/manual/item-classes.json`
  overrides); `item_build.decision_kind` adds 'path' rows; completed slots
  never contain quest/jungle-path items.
- Aggregation: slot index from net replay (undo/sold/destroyed net out),
  `participant_starters` bundles (45 s window), `item_state_scale` +
  time-normalized `stateBucket`, at-purchase threat profile with
  `profile_key='unknown'` fallback, `starterBundleKey`/`laneArchKey`/
  `netPurchasedItems`/`ownedItemsAt`/`stateBucket` engine helpers.
- ADRs D-083..D-087 PROPOSED; D-082 clause dispositions recorded.
- NOT done (documented, needs owner/next phase): export of
  item-classes/stateScale sections + zod schemas, lane-archetype export
  level, rank-dimension is deferred (D-087), backfill of the 150 local
  timelines, Prompt-2 statistical work.

## Phase B gaps closed (same branch)

- Export: `item-classes.json` + `state-scale.json` (schema v4),
  `decision_kind` split — builds export item rows only, path rows go to
  `roles/<ROLE>/build-paths/`; `laneArch` field on lane contexts via
  champion-tags archetypes; `profileKey` enum gains `unknown`.
- Shared zod: itemClasses/stateScale export schemas, laneArch optional,
  MANIFEST_SCHEMA_VERSION 3 -> 4 (loaders reject unknown versions via
  literal).
- classify-items `--check` CI mode + generated-file completeness test.
- Real export verified on state DB: 66 files incl. item-classes.json
  (859 items) + state-scale.json; public tarball ~1.5 MB gz (< 5 MB).
  No builds files yet: max games_w = 6 < exportMinGames = 10 with only
  300 backfilled matches — expected sparsity, resolves with full
  backfill.
- Real-data run caught + fixed: pendingMatches bind order, starter
  bundles now cover all participants, isSummonersRift requires map '11'.

## Backfill scale-up (2026-11-12)

- `backfill-timelines euw1`: 2,300 matches done (~1.16M raw events,
  0 failures); remaining ~22k running in background (resumable via
  extractor_runs).
- `aggregate`: item_build 18,869 rows / 154 champions; export emits
  14 SUPPORT builds files; lane/path contexts still below
  exportMinGames=10 (honest sparsity, resolves with full corpus).
