# PROGRESS

## Current status

- Phase: 1 (Support / Diamond)
- Current milestone: M0 Foundations (T-002.b DONE) and M1 ETL (in progress: T-014 DONE; T-015 DONE; T-016 DONE; T-017..T-019 TODO) -> M2 Engine (T-020..T-023 DONE)
- Last updated: 2026-10-31 by Antigravity

## Epic status

| Epic           | Status      | Notes                                                                                                    |
| -------------- | ----------- | -------------------------------------------------------------------------------------------------------- |
| E0 Foundations | IN PROGRESS | T-001..T-005 DONE; T-002.b DONE                                                                          |
| E1 ETL         | IN PROGRESS | T-010..T-013, T-011.b, T-011.c, T-013.b, T-013.c, T-013.d, T-013.e, T-014, T-015 DONE; T-016..T-019 TODO |
| E2 Engine      | IN PROGRESS | T-020 DONE; T-021 DONE; T-022 DONE; T-023 DONE                                                           |
| E3 Web MVP     | NOT STARTED |                                                                                                          |
| E4 Runes       | NOT STARTED |                                                                                                          |
| E5 Items       | NOT STARTED |                                                                                                          |
| E6 Live        | NOT STARTED |                                                                                                          |
| E7 Vision      | NOT STARTED |                                                                                                          |

## Data collection status

- Riot key: not recorded (development keys expire every 24 h).
- Games collected: 0 (no SQLite database exists under `data/` in this workspace) | Patch: 16.21 (static data imported: champions, items, runes).
- Last aggregation: never (aggregation is not implemented yet, T-015..T-018).

## Next recommended ticket

T-023 is **DONE** (Role-generic recommendation engine with explanations, layered shrinkage scoring, pool contract D-024, composition needs, golden test runner and golden fixtures including non-support TOP 1v1 lane group).
Next engine tickets: **T-024** (Blind pick mode), **T-025** (Comp needs full model), **T-026** (Golden test suite 20+ scenarios) or **T-027.a** (Draft backtest harness).
Next ETL ticket: **T-017** (Aggregate pair tables, depends on T-016,T-011.b).

Earlier handoff (kept for history): B-017 done (engine and shared `"types": []` plus ESLint purity guardrails in `eslint.config.mjs` with automated regression tests; T-020's engine-purity prerequisite is fully satisfied — the residual `tsc` gap caused by test files importing `vitest` is logged as B-021 and not fixed). B-022 (all Node built-ins blocked), B-023 (Date() call blocked) and B-024 (regression tests) also fixed. B-011 fixed (spec + T-002.b scope; implementation in T-002.b). Fix B-012 done. T-013.e done (typed schema-less `request()`, timeout/invalid-JSON regression tests, CLI + matches refactor below 300 lines; `pnpm check` 184 tests). **T-013.d done** (`pnpm etl status`, read-only parameterized counts and progress, empty & seeded database tests, CLI handling when database does not exist; `pnpm check` 153 tests). **D-008, D-011, D-017, D-018, D-020, D-021, D-022, D-023 accepted (2026-10-29); D-028 (formerly D-025, @types/... devDeps) renumbered and accepted.** SPECS §5/§8 are now normative. **T-002.b DONE** (shared schema parity); `packages/shared/src/index.ts` split by domain into `schemas/*.ts` (10 modules); rankBucketSchema (8 buckets), sparse role-prob with sum-to-1, Reason.with as ChampionId[], Reason.lowData, n_eff non-integer, lane reason type, DraftResult with insufficientData/poolRecommendations/poolUnavailable, championPoolSchema, manifest roles, all role-keyed export tuple schemas with games_w2, rune/build export schemas; 184 tests pass. **T-020 DONE** (rank weighting module: config + kernel + n_eff + equivalent-counts + influence matrix; 49 engine tests). **T-021 DONE** (Role inference — `inferRoles` with brute-force permutation over 120 assignments, viability check for missing champions, confidence = best/total probability mass; 15 tests). **T-022 DONE** (shrinkage + level mapping). T-014 (Participant enrichment) remains **data-blocked** (no Riot key, 0 games collected, no SQLite database under `data/`). **T-014 implementation DONE** (2026-10-29): enrichment module, mastery endpoint, 22 tests.

## Open questions for the owner

- Review T-013.b (gaps fixed in B-010 and B-014).

---

## Session log (newest first)

### 2026-10-31 — Antigravity — Ticket T-016 (Aggregate baselines)

- Done:
  - **`packages/etl/src/aggregate-baseline.ts`** (new): `aggregateBaseline(db)` computes `baseline` rows per (champion, my_role, user rank bucket) using the engine rank kernel (`combinedGameWeight` from `@draftorb/engine`). Each game contributes to every user bucket row weighted by `rankDistanceWeight * recencyFactor * reliabilityFactor`; accumulates `wins_w`, `games_w`, `games_w2`, `games` (raw count); clears and rewrites the table in a transaction (idempotent). Populates the `games` 6th column added by migration 008, resolving B-025/B-033.
  - **`packages/etl/src/aggregate-baseline.test.ts`** (new, 3 tests): weighted counts and `n_eff` verified on toy data (uniform weight → n_eff = raw count; uneven recency weights → n_eff < raw count; out-of-window game contributes 0 weight; empty DB → empty baseline).
  - **`packages/etl/src/commands/aggregate.ts`** (edited): `pnpm etl aggregate` now also writes baseline rows; description updated.
  - **`packages/etl/src/index.ts`** (edited): exports `aggregateBaseline` and `BaselineRow`.
  - **`packages/etl/package.json`** (edited): added `@draftorb/engine` workspace dependency to reuse the engine rank kernel.
  - **`packages/etl/tsconfig.json`** (edited): added `../engine` project reference.
  - **`docs/SETUP.md`** (edited): `pnpm etl aggregate` description updated to include baselines.
  - Review fixes: the game rank bucket now comes from `matches.avg_rank_score`, so participants with unknown rank still contribute; an optional `[patch]` argument excludes newer matches and sets recency relative to that patch (`aggregateBaseline(db, { patch })`); a malformed patch throws before the table is touched, so existing baselines are preserved. The ETL dependency on `@draftorb/engine` is recorded as D-032 (PROPOSED).
- Tests: `pnpm check` green (typecheck, lint, format: 0 errors; 603 tests across 42 files, including the 4 baseline tests).
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

### 2026-10-28 — Devin — Bug B-019 (wrong-tier entries in capped division mark tier complete)

- Done:
  - Wrote a regression test in `players.test.ts` first: EMERALD quota 250 with Division I returning 100 GOLD entries (wrong tier) + Divisions II–IV empty → first run `partial` with `fetched: 0`; second run (Division I returns EMERALD entries) → `complete` with `fetched: 63`.
  - Confirmed the test fails with the current `exhausted: divisionsExhausted > 0` + `completed = rankedEntries.length >= quota || exhausted` (marks the tier `complete` despite 0 valid entries).
  - Fixed `getTierEntries` (`packages/etl/src/players.ts`): returns `cappedHasRejected: boolean` — true when a capped division (stopped at `perDivision`, not by an empty/short page) contributed entries later rejected by the tier filter. Updated the return type and both return paths (apex tier returns `cappedHasRejected: false`).
  - Updated `discoverPlayersByTier`: `completed = rankedEntries.length >= quota || (exhausted && !cappedHasRejected)`, so a tier with rejected capped-division entries stays `partial` and is re-fetched.
  - B-019 FIXED.
- Files touched: `packages/etl/src/players.ts`, `packages/etl/src/players.test.ts`, `docs/BUGS.md`, `docs/PROGRESS.md`
- Tests: `pnpm check` — all green (14 test files, 132 tests passed)
- State left: FIXED
- Next step: T-014 (participant enrichment) — blocked only by data collection (B-015 Node 20, or wait for Node 22).
- Pitfalls / notes for next AI: the `> 0` change from B-013 was too broad; the `cappedHasRejected` guard narrows it to only skip tiers where no capped division had rejected entries. Existing test (d) still passes because its capped division returns all-valid EMERALD entries (`cappedHasRejected = false`).

### 2026-10-28 — Devin — Bug tracker cleanup (B-013 stale entry + B-018)

- Done:
  - Removed the stale `### B-013 — ... — OPEN` detailed entry from the `## Open` section in `docs/BUGS.md` (lines 63–71). B-013 is already fully documented as FIXED under `## Fixed` (line 102), with the fix details, tests, and commit/ticket reference. The Open table never listed B-013, so no table change was needed.
  - Added B-018 to the Open table and its detailed entry: B-014 is FIXED (fix committed in the 2026-10-28 session) but is still listed in the Open table and retains its detailed entry under `## Open` instead of `## Fixed`. Per AGENTS.md rule 6, this was logged, not fixed (out of scope for this task).
- Files touched: `docs/BUGS.md`, `docs/PROGRESS.md`
- Tests: none (docs-only change); `pnpm check` — all green (14 test files, 131 tests passed).
- State left: FIXED (B-013 stale entry removed; B-018 logged for future cleanup)
- Next step: next contributor to handle B-018 by moving B-014 to `## Fixed` and out of the Open table.
- Pitfalls / notes for next AI: none

### 2026-10-28 — Devin — Bug B-013 (player discovery completion marker)

- Done:
  - Wrote 4 regression tests in `players.test.ts`: (a) quota reached on full pages → `complete`, (b) league exhausted below quota on short pages → `complete` with `fetched < quota`, (c) full pages whose `tier` differs from the requested tier → filtered out → `partial` and re-fetched on the next run, (d) some divisions exhausted (empty/short pages) + others capped at `perDivision` (full pages) → `complete` with no endless retries.
  - Confirmed test (c) fails with the buggy `completed = rankedEntries.length >= quota || pageCount > 0` (always true because `pageCount >= 1`), and test (d) fails with `exhausted = divisionsExhausted === DIVISION_ORDER.length` (too strict — 3 of 4 exhausted divisions still yields `false`).
  - Fixed `getTierEntries` to return `{ entries, pageCount, exhausted }`: apex tiers are always `exhausted: true`; non-apex tiers are `exhausted` when any division stopped on an empty or short page (keeping the existing `< 100` rule). Changed `completed` to `rankedEntries.length >= quota || exhausted`.
  - B-013 FIXED.
- Files touched: `packages/etl/src/players.ts`, `packages/etl/src/players.test.ts`, `docs/BUGS.md`, `docs/TICKETS.md`, `docs/PROGRESS.md`
- Tests: `pnpm check` — all green (14 test files, 131 tests passed)
- State left: FIXED
- Next step: T-014 participant enrichment.
- Pitfalls / notes for next AI: none

### 2026-10-28 — Devin — Bug B-014 (CLI args validation)

- Done:
  - Created `packages/etl/src/cli-args.ts` with `EXIT`, `CliError`, `UsageError`, `parseStrictPositiveInt`, `parseTierList`, `parseQuotaList`.
  - Wrote `cli-args.test.ts` first (19 tests) covering all cases; moved parsing from `cli.ts`.
  - Wired `runMatches` and `runPlayers` to helpers; strict validation for numeric flags and tier names.
  - B-014 FIXED; T-013.b gaps (B-010, B-014) resolved, T-013.b set to DONE.
- Files touched: `packages/etl/src/cli-args.ts`, `packages/etl/src/cli-args.test.ts`, `packages/etl/src/cli.ts`, `docs/BUGS.md`, `docs/TICKETS.md`, `docs/PROGRESS.md`
- Tests: `pnpm check` — all green (14 test files, 127 tests passed)
- State left: FIXED
- Next step: T-014
- Pitfalls / notes for next AI: none

- Done:
  - Routed default paths through `config/paths.ts`: added `defaultDataDir()`, `defaultPublicDataDir()`, `defaultManualDataDir()`.
  - Removed CLI `findPackageRoot` and local `resolveDbPath`; imported from `config/paths`.
  - `importStaticData()` defaults outputDir to `defaultPublicDataDir()`.
  - `validateChampionTagsFile()` defaults repoRoot to `resolveRepoRoot()`.
  - `loadEnv()` uses `defaultEnvPaths()` (falls back to cwd on throw).
  - Updated `players.test.ts` to use `join(root, 'packages', 'etl')`.
  - Ran `pnpm check` — all green (13 test files, 108 tests passed).
- Files touched: `packages/etl/src/config/paths.ts`, `packages/etl/src/cli.ts`, `packages/etl/src/ddragon.ts`, `packages/etl/src/tags.ts`, `packages/etl/src/riot/env.ts`, `packages/etl/src/players.test.ts`, `docs/BUGS.md`, `docs/PROGRESS.md`, `docs/SETUP.md`, `AGENTS.md`
- Tests: `pnpm check` — all green (13 test files, 108 tests passed)
- State left: FIXED
- Next step: T-014.
- Pitfalls / notes for next AI: none

### 2026-10-28 — Devin — Bug B-010 (API key redaction)

- Done:
  - Wrote failing regression tests for B-010 with a UUID-shaped key (`RGAPI-1a2b3c4d-1234-5678-9abc-def012345678`) to verify that the bug leaks key fragments.
  - Fixed the redaction order in `packages/etl/src/riot/types.ts`: redact API key patterns first (`/RGAPI-[A-Za-z0-9_-]+/g`), then shorten PUUIDs.
  - Renamed `redactPuuid` to `shortenPuuids` and fixed the regex to match whole 78-character base64url tokens (the verified PUUID length from fixture data) with word boundaries: `(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{78}(?![A-Za-z0-9_-])`.
  - Removed the redundant `redactPuuid()` call from the 401/403 path in `packages/etl/src/riot/client.ts`; the error constructor already redacts the body.
  - Added regression tests for: (a) UUID-shaped keys in 400 errors, (b) UUID-shaped keys in 403 auth errors, (c) UUID-shaped keys in nested JSON error bodies, (d) 78-character PUUIDs in error bodies.
  - Ran `pnpm check` — all green (13 test files, 108 tests passed).
- Files touched: `packages/etl/src/riot/types.ts`, `packages/etl/src/riot/client.ts`, `packages/etl/src/riot/client.test.ts`, `docs/BUGS.md`, `docs/PROGRESS.md`
- Tests: `pnpm check` — all green (13 test files, 108 tests passed)
- State left: FIXED
- Next step: fix B-012, then T-014.
- Pitfalls / notes for next AI: none

### 2026-10-28 — Devin — Ticket T-011.c (Migration 005 verification)

- Done:
  - Ran baseline `pnpm install --frozen-lockfile` and `pnpm check` (green, 13 test files, 104 tests passed).
  - Added `lane_full` duplicate test to `migrate.test.ts`: insert row with `partner_id` NULL and `opp2_id` NULL, insert same key again expecting /UNIQUE/, then insert same row with `opp2_id = 5` expecting success (non-NULL keys stay distinct).
  - Fixed test hygiene: moved test databases from repository root to `mkdtempSync(join(tmpdir(), 'draftorb-migrate-'))` for unique temp directory per test run, added `afterAll` to clean temp directory including WAL/SHM files.
  - Ran `pnpm check` again (green, 13 test files, 104 tests passed).
- Files touched: `packages/etl/src/db/migrate.test.ts`, `docs/TICKETS.md`, `docs/PROGRESS.md`
- Tests: `pnpm check` — all green (13 test files, 104 tests passed)
- State left: DONE
- Next step: fix B-010 and B-012, then T-014.
- Pitfalls / notes for next AI: none

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

### 2026-10-26 — GitHub Copilot (Claude Opus 5.5) — Project review and docs/code alignment

- Done:
  - Reviewed the whole project against AGENTS.md, SPECS.md and CONVENTIONS.md and logged B-010..B-017 in BUGS.md. No bug was fixed and no behavior changed.
  - Aligned the docs with the code: corrected false or stale statements in this file (milestone, open questions, Migration 005 entry, superseded notes, order of the 2026-10-22 entries) and in TICKETS.md (migration 005 split into T-011.c, T-013.b reopened to REVIEW, new T-013.d/T-013.e, cross-references to open bugs), DATA_MODEL.md (migration 005 uses expression indexes), RIOT_API.md (schema policy, mastery endpoint not implemented yet), SETUP.md (implemented vs planned ETL commands, Node 22, run from the repo root), DECISIONS.md (D-014 and D-018 corrections, new D-025), ARCHITECTURE.md and AGENTS.md; added follow-up notes to B-006; fixed the `.gitignore` header and the `DRAFTORB_DB_PATH` comment in `cli.ts`.
- Files touched: `.gitignore`, `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/BUGS.md`, `docs/DATA_MODEL.md`, `docs/DECISIONS.md`, `docs/PROGRESS.md`, `docs/RIOT_API.md`, `docs/SETUP.md`, `docs/TICKETS.md`, `packages/etl/src/cli.ts` (header comment only)
- Tests: none run (owner request; docs and comments only). Static count of the current tree: 13 test files, 104 test cases.
- State left: REVIEW (owner to confirm the corrections and answer the open questions).
- Next step: fix B-010 and B-012, then T-014.
- Pitfalls / notes for next AI:
  - This workspace has no `.git` directory, so branch and merge claims in older entries cannot be verified here.
  - Never edit an applied migration file (the runner rejects changed checksums); documentation fixes for migration 005 went to DATA_MODEL.md only.

### 2026-10-24 — Copilot SDK in VS Code (summary from Qwen 3.5 - Ollama) — Ticket T-011.c (Migration 005, originally logged as T-011)

- Done:
  - Created migration file `packages/etl/migrations/005_lane_null_unique.sql` to add unique indexes for nullable lane keys.
  - Added unique expression indexes on `COALESCE(opp2_id, -1)` (`lane_vs`) and on `COALESCE(partner_id, -1)` and `COALESCE(opp2_id, -1)` (`lane_full`) so rows with NULL lane keys cannot duplicate. Corrected 2026-10-26: this entry originally said "WHERE clause conditions"; the migration has no WHERE clause.
  - Verified migration syntax against DATA_MODEL.md (whose "partial index" wording was itself wrong and was corrected on 2026-10-26).
  - Confirmed migration will run after migrations 001-004 (established dependency chain).
- Files touched: `packages/etl/migrations/005_lane_null_unique.sql`, `docs/PROGRESS.md`, `docs/TICKETS.md`. Corrected 2026-10-26: `packages/etl/src/db/migrate.test.ts` (migration 005 assertions and a NULL `opp2_id` duplicate test) and `docs/DATA_MODEL.md` (migration 005 notes) were also changed for this migration but not logged.
- Tests: none run in this session ("idempotency to be verified in next session"). `migrate.test.ts` now covers idempotency and the `lane_vs` NULL case; the `lane_full` NULL case is not covered.
- State left: REVIEW (corrected 2026-10-26: originally logged as DONE without running tests).
- Next step: run `pnpm check`, add a `lane_full` NULL-partner duplicate test, then T-014.
- Pitfalls / notes for next AI: migration 005 relies on COALESCE expression indexes with the sentinel -1 (never a valid champion id); ensure it runs after migrations 001-004.

### 2026-10-24 — Copilot SDK in VS Code — Ticket T-013.b

- Done:
  - Redacted Riot API key patterns from error messages, URLs, and recursively serialized response bodies; retained the authentication recovery hint for nonempty 401/403 responses. Update 2026-10-26: redaction is incomplete for real UUID-shaped keys (B-010).
  - Kept transient match-ID listing failures isolated per player and verified that failures leave existing cursors unchanged while sharing the consecutive-failure threshold with match-detail requests.
  - Reused the shared platform list, made `players` and `matches` argument parsing strict, rejected excess positionals, and required fully valid nonnegative integer quotas. Update 2026-10-26: `matches` numeric flags and tier names are still not fully validated (B-014).
  - Closed internally owned SQLite connections in `finally` for direct match ingestion and player discovery calls.
  - Extended `.gitignore` for raw ETL data, documented the explicit `RiotSchemaError` policy, and confirmed existing Riot client regression coverage for auth, retries, rate limiting, and endpoint fixtures remains in place.
- Files touched: `.gitignore`, `docs/BUGS.md`, `docs/PROGRESS.md`, `docs/RIOT_API.md`, `docs/TICKETS.md`, `packages/etl/src/cli.ts`, `packages/etl/src/db-ownership.test.ts`, `packages/etl/src/matches.test.ts`, `packages/etl/src/matches.ts`, `packages/etl/src/players.ts`, `packages/etl/src/riot/client.test.ts`, `packages/etl/src/riot/types.ts`
- Tests: `pnpm check` (10 files, 90 tests passed); CLI smoke tests returned usage exit code 2 for unknown options, extra positionals, unsupported platforms, and malformed quotas; `git check-ignore --no-index -v` confirmed secret, generated, database, and raw-data patterns.
- State left: DONE (reopened to REVIEW on 2026-10-26: the key-redaction and malformed-options criteria still fail, see B-010 and B-014)
- Next step: T-014 participant enrichment; T-002.b remains unblocked.
- Pitfalls / notes for next AI: `.env`, `.env.local`, `.env.*`, `dist/`, and `*.tsbuildinfo` were already ignored on this branch; raw ETL data now has explicit ignore coverage as well.

### 2026-10-24 — Copilot SDK in VS Code — D-024 champion pool contract

- Done: applied the D-024 product decision and documented the browser-only per-role pool, score-preserving engine contract, and independently paginated "From your pool" and "Best overall" lists.
- Files touched: `AGENTS.md`, `docs/CONVENTIONS.md`, `docs/DATA_MODEL.md`, `docs/DECISIONS.md`, `docs/GLOSSARY.md`, `docs/PLAN_SUMMARY.md`, `docs/PROGRESS.md`, `docs/SPECS.md`, `docs/TESTING.md`, `docs/TICKETS.md`
- Tests: none (documentation and product-contract changes only).
- State left: REVIEW (branch `d-024-champion-pool`, rebased onto `pr-c-data-model-alignment`). Merged into main (ba66453).
- Next step: implement shared pool schemas in T-002.b before the engine and UI pool work.
- Pitfalls / notes for next AI: the pool must never change scoring, candidate scores, or global order; the engine returns complete lists, and pagination is UI-only.

### 2026-10-24 — Copilot SDK in VS Code — PR C: data model alignment

- Done:
  - Implemented T-011.b migration 004 and migration checksums; corrected D-019 rank-known semantics.
  - Implemented T-013.c participant extraction and atomic persistence, and recorded the T-015.b role-hint limitation.
  - Reviewed PR B and recorded the remaining acceptance gaps in the review handoff.
- Files touched: `packages/etl/migrations/004_role_generic_aggregates.sql`, `packages/etl/src/db/migrate.ts`, `packages/etl/src/matches.ts`, `packages/etl/src/participants.ts`, relevant ETL tests and fixtures, `docs/BUGS.md`, `docs/DATA_MODEL.md`, `docs/DECISIONS.md`, `docs/GLOSSARY.md`, `docs/SPECS.md`, `docs/TICKETS.md`, `docs/PROGRESS.md`
- Tests: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` passed (11 files, 96 tests).
- State left: REVIEW (branch `pr-c-data-model-alignment`, rebased onto `main`). Merged into main (c237fe6).
- Next step: review the rebased PR C branch; then continue with T-014 participant enrichment.
- Pitfalls / notes for next AI: migration 004 drops and recreates derived aggregate tables because their old support-specific schema is obsolete; `champions.json.roles` remains a bootstrap hint and has no JUNGLE entries in patch 16.21.

### 2026-10-24 — Copilot SDK in VS Code — PR B review

- Done: reviewed PR B against the requested B1-B5 acceptance criteria. The frozen-install/typecheck/lint/format/test gate passed on B (9 test files, 85 tests).
- Files touched: none for this review; C4 separately removes the redundant participant-schema re-parse while implementing PR C.
- Tests: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` passed on B.
- State left: REVIEW (acceptance gaps remain: player-discovery completion is marked after any page; CLI path/platform logic remains duplicated and CLI is not split; no-schema Riot requests retain an arbitrary generic result type; timeout/bad-JSON/redaction regression coverage is missing; `.gitignore` dropped prior ignore rules).
- Next step: address the listed PR B gaps before merging.
- Pitfalls / notes for next AI: the task requested review only for PR B; keep any corrections to that branch separate from PR C.
- Status 2026-10-26: the `.gitignore` rules and the shared platform list were restored in T-013.b, which also added redaction tests (redaction is still incomplete, B-010). Still open: CLI path duplication (B-012), completion marker (B-013), typed schema-less requests, timeout/bad-JSON tests and the CLI split (T-013.e).

### 2026-10-24 — Copilot SDK in VS Code — Ticket T-005

- Done:
  - Restored the ETL CLI entrypoint and placed the Riot client, match ingestion, and player discovery implementations in their correct modules.
  - Fixed ETL imports, revalidated match payloads before processing, and limited each division's contribution to the player quota.
  - Restored the complete Riot client regression suite and aligned its schema-mismatch test with the explicit `RiotSchemaError` behavior.
  - Excluded machine-local `.devin/` settings from repository-wide formatting checks.
- Files touched: `.prettierignore`, `docs/BUGS.md`, `docs/PROGRESS.md`, `docs/TICKETS.md`, `packages/etl/src/cli.ts`, `packages/etl/src/matches.ts`, `packages/etl/src/players.test.ts`, `packages/etl/src/players.ts`, `packages/etl/src/riot/client.test.ts`, `packages/etl/src/riot/client.ts`
- Tests: `pnpm check` (9 files, 85 tests passed), `pnpm --filter @draftorb/web build`, and `pnpm etl help` all passed.
- State left: DONE
- Next step: T-011.b and T-002.b (both unblocked), then T-014.
- Pitfalls / notes for next AI: keep the ETL entrypoint and source modules at their current paths; tests import the Riot client and types relative to `src/riot/`.

### 2026-10-24 — Devin — PR A: tooling baseline

- Done:
  - Added `.prettierignore` (lockfile, `data/`, test fixtures, build output) and applied Prettier to the whole repo in a dedicated `style: apply prettier` commit.
  - Added root script `pnpm check` (typecheck, lint, format check, tests).
  - Added `.github/workflows/ci.yml`: push + pull_request, matrix `ubuntu-latest` / `windows-latest`, Node 22, pnpm from `packageManager`, `pnpm install --frozen-lockfile && pnpm check`. No secrets; tests never touch the network.
- Files touched: `.prettierignore`, `package.json`, `.github/workflows/ci.yml`, `docs/SETUP.md`, `docs/PROGRESS.md` (+ formatting-only changes from Prettier).
- Tests: `pnpm check` — all green (9 files, 83 tests).
- State left: REVIEW. Merged into main (3ea2e11).
- Next step: PR B (ETL robustness).
- Pitfalls / notes for next AI:
  - `pnpm format` is now safe repo-wide (the lockfile and generated data are ignored); `pnpm format:check` is enforced in CI.

### 2026-10-24 — Devin — Review fixes for D-020..D-023

- Done: applied the owner review to the docs PR. Experts reworked (in-data games primary, mastery fallback only for the recommended role, one cached call per (puuid, champion) pair; `participants.mastery_points`/`is_expert`); contract-parity tickets T-002.b (role-keyed zod schemas, `DraftResult.insufficientData{nEff,rawGames}`, `lane` reason, schemaVersion) and T-011.b (migration 004) with dependency rewiring; D-023 gate replaced by a paired-bootstrap-by-match test on a frozen holdout with rolling validation, T-027 split into T-027.a/T-027.b; model made role-generic (`laneGroup`, validation rules, `contextSlots`); exports role-keyed (`roles/<ROLE>/...`, `exportMinGames`); scale `s`, equivalent counts, reason ordering, single item phase rule; glossary + limitations updated.
- Files touched: `docs/DECISIONS.md`, `docs/SPECS.md`, `docs/DATA_MODEL.md`, `docs/TICKETS.md`, `docs/GLOSSARY.md`, `docs/PROGRESS.md`
- Tests: none (docs only).
- State left: REVIEW (owner to accept/revise D-020..D-023).
- Next step: T-011.b and T-002.b (both unblocked), then T-014.
- Pitfalls / notes for next AI: model sections are role-generic on purpose; only SUPPORT is populated/exposed in Phase 1.

### 2026-10-24 — Devin — Design: ranking model (D-020..D-023)

- Done: docs-only design for "best champion/runes/items from what other players do, weighted by win rate and by how close the game conditions are". Added PROPOSED ADRs D-020 (role-relative influence matrix by phase, all five roles incl. jungle), D-021 (layered back-off with shrinkage in log-odds space, bot-lane `lane_vs`/`lane_2v2` tables, `n_eff`), D-022 (like-for-like item/rune comparison, experts definition), D-023 (temporal-holdout backtest gate). Rewrote SPECS §5 and §8.1/§8.2, extended §3 and §7, updated DATA_MODEL aggregated tables/exports, GLOSSARY, and tickets T-014/16/17/18/20/22/51/56; added T-027 Backtest harness.
- Files touched: `docs/DECISIONS.md`, `docs/SPECS.md`, `docs/DATA_MODEL.md`, `docs/TICKETS.md`, `docs/GLOSSARY.md`, `docs/PROGRESS.md`
- Tests: none (docs only).
- State left: REVIEW (owner to accept/revise D-020..D-023).
- Next step: T-014 once PR #1 is merged.
- Pitfalls / notes for next AI: influence values in SPECS §5 are priors; change them only with a T-027 backtest report.

### 2026-10-24 — Devin — Ticket T-013 (D-017/D-019 revisions)

- Done:
  - Changed `--since-patch` to a numeric lower-bound window; patch rejects are re-evaluated when included, and cursors relist in full only when the window widens.
  - Stored `rank_known_count` alongside the mean known-participant `avg_rank_score`, with a fallback to the seed player's score when no participants are known.
  - Added migration `003_matches_rank_known.sql`, tests, and the approved D-017/D-019 documentation.
- Files touched:
  - `docs/BUGS.md`
  - `docs/DATA_MODEL.md`
  - `docs/DECISIONS.md`
  - `docs/PROGRESS.md`
  - `packages/etl/migrations/003_matches_rank_known.sql`
  - `packages/etl/src/cli.ts`
  - `packages/etl/src/db/migrate.test.ts`
  - `packages/etl/src/index.ts`
  - `packages/etl/src/matches-store.ts`
  - `packages/etl/src/matches.test.ts`
  - `packages/etl/src/matches.ts`
- Tests: `pnpm test` (9 files, 83 tests passed), `pnpm typecheck`, `pnpm lint`, CLI invalid `--since-patch` usage smoke (exit 2 with the expected error), and `git diff --check` passed.
- State left: REVIEW
- Next step: Owner review; CI loop to be handled after re-brief.
- Pitfalls / notes for next AI:
  - Use Node 22 for ETL tests on this VM; Node 20.19.0 segfaults while loading `better-sqlite3`.

### 2026-10-23 — Devin — Ticket T-013

- Done:
  - Implemented match ingestion in `packages/etl/src/matches.ts` + `matches-store.ts`: per-player ranked solo id listing (queue 420, `type=ranked`, paged by 100), fetch + zod revalidation of every `getMatch` payload (client returns raw on schema mismatch -> counted `invalid`, recorded in `match_rejects`; superseded by B-008: the client now throws `RiotSchemaError`, still counted `invalid`), filters (queue, duration < 15 min, `--since-patch` lower bound), storage in `matches` with `INSERT OR IGNORE`.
  - Resumability: per-player cursor in `ingest_state` (`match-ingest:<platform>:<puuid>`) persists the id snapshot + `processed` after every match, so kill/restart resumes mid-player; `done` cursors list only ids from `lastGameCreation` on via Riot `startTime` (epoch seconds; inclusive, so already stored games are relisted and skipped by dedup), and relist in full when the run widens the cursor's patch window (`--since-patch` lowered or removed). Raising the lower bound keeps the incremental `startTime` path. `--reset` wipes the platform's cursors and all `match_rejects`; `--limit` takes pending players before done ones.
  - Dedup: `match_rejects` (migration `002_match_rejects.sql`) remembers rejected ids across players; patch rejects keep the actual patch and are re-evaluated when the `--since-patch` window includes it (D-017).
  - Match rows store `rank_known_count` with `avg_rank_score` (migration `003_matches_rank_known.sql`); unknown participants fall back to the seeding player's score.
  - CLI `pnpm etl matches [platform] [--since-patch=16.19] [--per-player=20] [--limit=N] [--queue=420] [--min-duration=900] [--reset]` with per-player progress log (`[i/n] puuid… ids=.. stored=.. dup=.. filtered=.. invalid=..`).
  - Made `db/migrate.test.ts` assertions read the migration list from disk so adding migration files no longer breaks the suite.
  - Recorded ADRs D-017..D-019 (PROPOSED) in `docs/DECISIONS.md`.
- Files touched:
  - `packages/etl/migrations/002_match_rejects.sql`
  - `packages/etl/src/matches.ts`
  - `packages/etl/src/matches-store.ts`
  - `packages/etl/src/matches.test.ts`
  - `packages/etl/src/cli.ts`
  - `packages/etl/src/index.ts`
  - `packages/etl/src/db/migrate.test.ts`
  - `docs/TICKETS.md`
  - `docs/DATA_MODEL.md`
  - `docs/DECISIONS.md`
  - `docs/PROGRESS.md`
- Tests: `pnpm test` (9 files, 77 tests passed), `pnpm typecheck`, `pnpm lint` all green.
- State left: DONE
- Next step: T-014 (Participant extraction).
- Pitfalls / notes for next AI:
  - Riot `startTime` is epoch **seconds** while `gameCreation` is ms — divide by 1000 when passing cursor timestamps.
  - `match_rejects` rows with reason `patch` are deleted on re-evaluation; `queue`/`short`/`invalid` are permanent.
  - On this VM, Node 20.19.0 segfaults loading better-sqlite3 (`napi_module_register_by_symbol`); Node 22 works. Run tests under Node 22 here.
  - `pnpm format` reformats the whole repo including `pnpm-lock.yaml`; format only touched files instead.

### 2026-10-23 — Copilot SDK in VS Code — D-016 confirmation

- Done:
  - Accepted the D-016 formula with `rank_score` limited to tier and division; raw LP remains available for exact rank ordering and is not capped or rounded into the score.
  - Updated player score calculation, tests, and the related data-model and specification notes.
- Files touched:
  - `packages/etl/src/players.ts`
  - `packages/etl/src/players.test.ts`
  - `docs/DECISIONS.md`
  - `docs/DATA_MODEL.md`
  - `docs/SPECS.md`
  - `docs/PROGRESS.md`
- Tests: `pnpm test` (8 files, 68 tests passed), `pnpm typecheck`, `pnpm lint`, and `git diff --check` passed.
- State left: DONE
- Next step: Continue with T-013 (Match ingestion).
- Pitfalls / notes for next AI:
  - `rank_score` intentionally does not distinguish LP within a division or apex tier; use stored rank fields for exact comparisons.

### 2026-10-23 — Copilot SDK in VS Code — Review follow-up

- Done:
  - Corrected the initial SQLite schema for optional mastery, item event uniqueness, valid participant roles, and player rank-score indexing.
  - Added regression coverage for item event types sharing a timestamp/item, Riot fetch rejection retries and exhaustion, and pruning expired rate-limit timestamps.
  - Clarified T-012 resumability and T-013 Riot payload revalidation acceptance criteria.
  - Proposed D-016 for persisted rank_score and aligned DATA_MODEL.md and SPECS §3.
- Files touched:
  - `packages/etl/migrations/001_initial.sql`
  - `packages/etl/src/db/migrate.test.ts`
  - `packages/etl/src/players.test.ts`
  - `packages/etl/src/riot/client.test.ts`
  - `packages/etl/src/riot/rate-limiter.ts`
  - `packages/etl/src/riot/rate-limiter.test.ts`
  - `docs/DECISIONS.md`
  - `docs/DATA_MODEL.md`
  - `docs/SPECS.md`
  - `docs/TICKETS.md`
  - `docs/PROGRESS.md`
- Tests: `pnpm test` (8 files, 68 tests passed); `pnpm typecheck` passed; `pnpm lint` passed.
- State left: DONE (review follow-up resolved; all requested checks pass).
- Next step: T-013 (Match ingestion).
- Pitfalls / notes for next AI:
  - D-016 is PROPOSED; confirm or revise the formula with the owner before relying on it as an accepted decision. Resolved: D-016 was accepted on 2026-10-23 (entry above).

### 2026-10-22 — Copilot CLI — Ticket T-012

- Done:
  - Implemented tier-based player discovery in `packages/etl/src/players.ts` with default tier sequence `EMERALD..CHALLENGER`, per-tier quotas, rank score conversion (`tier + division + LP`; LP removed by D-016 on 2026-10-23), resumable `ingest_state` progress, and SQLite upserts for player rows.
  - Exposed player discovery from `packages/etl/src/index.ts` and added CLI support in `packages/etl/src/cli.ts` (`pnpm etl players`, plus `--platform`, `--tiers`, `--quota`, `--reset`).
  - Added unit coverage in `packages/etl/src/players.test.ts` for rank score calculation and quota/resume logic.
- Files touched:
  - `packages/etl/src/players.ts`
  - `packages/etl/src/players.test.ts`
  - `packages/etl/src/index.ts`
  - `packages/etl/src/cli.ts`
  - `docs/TICKETS.md`
  - `docs/PROGRESS.md`
- Tests: `pnpm test && pnpm typecheck && pnpm lint` (8 test files, 63 tests passed).
- State left: DONE
- Next step: T-013 (Match ingestion)
- Pitfalls / notes for next AI:
  - `playerRankScore()` intentionally uses a tier base + division ladder + capped LP bonus; it is deterministic and suitable for persisted rank_score values. Superseded by D-016 (2026-10-23): LP is no longer part of `rank_score`.
  - Discovery is resumable per platform/tier via the `ingest_state` table; the state is currently treated as a completion marker after a successful fetch for that tier. The marker is always set (B-013).
  - The CLI uses quota entries in `EMERALD:250,...` format, but keep the default values in sync with `DEFAULT_PLAYER_QUOTAS`.

### 2026-10-22 — GitHub Copilot — Ticket T-011

- Done:
  - Fixed the SQLite migration runner in `packages/etl/src/db/migrate.ts` to avoid masking original errors, avoid unnecessary write locks on already-applied migrations, and centralize migration table creation.
  - Moved `busy_timeout` to `openDb()` so the connection setting is applied consistently.
  - Added filename validation to reject malformed migration names and kept `getMigrationStatus()` behavior correct for applied-but-missing versions.
  - Added a transaction-based re-check under write lock for pending migrations and contextualized failure messages on migration errors.
- Files touched:
  - `packages/etl/src/db/migrate.ts`
  - `packages/etl/src/db/migrate.test.ts`
- Tests: `pnpm vitest run packages/etl/src/db/migrate.test.ts` and `pnpm test -- --run && pnpm typecheck && pnpm lint` — all green.
- State left: DONE
- Next step: T-012 (Player discovery by tier) or continue with the next ETL ingestion ticket.
- Pitfalls / notes for next AI:
  - The migration transaction is now wrapped in `db.transaction()` with a re-check under the write lock and a contextualized error message.
  - `getMigrationStatus()` still treats `missingVersions` as applied entries without a matching SQL file on disk, which is useful for migration hygiene and debugging.

### 2026-10-22 — Antigravity — Ticket T-011

- Done:
  - Fixed the SQLite connection setup in `packages/etl/src/db/migrate.ts` to enable `PRAGMA foreign_keys = ON` in `openDb()`, matching the default enforcement expected by SQLite-safe schema work.
  - Documented the review point that `PRAGMA foreign_keys` must be set outside a transaction; if a migration needs to temporarily disable it, that must happen before `BEGIN IMMEDIATE` because SQLite ignores the pragma once a transaction is active.
  - Added regression coverage in `packages/etl/src/db/migrate.test.ts` to assert the opened database has WAL + foreign keys enabled.
- Files touched:
  - `packages/etl/src/db/migrate.ts`
  - `packages/etl/src/db/migrate.test.ts`
  - `docs/TICKETS.md`
  - `docs/PROGRESS.md`
- Tests: `pnpm exec vitest run packages/etl/src/db/migrate.test.ts` (12/12 passed).
- State left: DONE
- Next step: T-012 (Player discovery by tier)
- Pitfalls / notes for next AI:
  - SQLite’s `foreign_keys` pragma is connection-scoped and must be configured on the DB handle before any migration transaction begins.
  - A migration that needs to disable `foreign_keys` for table rebuilds must do it before `BEGIN IMMEDIATE`; once inside the transaction, SQLite will ignore the change.

### 2026-10-22 — Antigravity — Ticket T-011

- Done:
  - Fixed `getMigrationStatus()` in `packages/etl/src/db/migrate.ts` to compute `pending` as the set difference between the migration files on disk and the versions already applied. This avoids negative or incorrect pending counts when a migration was deleted/renamed.
  - Added `missingVersions` reporting so applied migrations absent from the migration directory are surfaced as a deployment anomaly.
  - Added a regression test in `packages/etl/src/db/migrate.test.ts` covering the missing-disk-file case.
- Files touched:
  - `packages/etl/src/db/migrate.ts`
  - `packages/etl/src/db/migrate.test.ts`
- Tests: `pnpm vitest run packages/etl/src/db/migrate.test.ts` (9 tests passed)
- State left: REVIEW
- Next step: continue T-011 and complete the migration runner acceptance checks with the rest of the ETL suite.
- Pitfalls / notes for next AI:
  - `pending` now reflects the difference of sets, not arithmetic on counts.
  - `missingVersions` is intentionally explicit and should be treated as an operational warning, not a normal pending migration.

### 2026-10-22 — Antigravity (Gemini 3.8 Flash) — Ticket T-010

- Done:
  - Implemented `RiotRateLimiter` (`packages/etl/src/riot/rate-limiter.ts`) supporting multi-window app limits (20 req/1s, 100 req/120s), method-specific limits, header synchronisation (`X-App-Rate-Limit`, `X-Method-Rate-Limit`, `Retry-After`), and serialized concurrency queue to eliminate race conditions.
  - Implemented `RiotClient` (`packages/etl/src/riot/client.ts`) with automatic 429 `Retry-After` retry, 5xx exponential backoff (max 5 tries), immediate 401/403 abort with explicit message `"key expired?"`, and non-crashing Zod response validation that logs unknown payload shapes (superseded by B-008: schema mismatches now throw `RiotSchemaError`).
  - Added types and error hierarchy in `packages/etl/src/riot/types.ts` (`RiotApiError`, `RiotAuthError`, `RiotRateLimitError`), platform/regional routing definitions (`PLATFORMS`, `REGIONAL_ROUTINGS`, `platformToRegion`).
  - Added Zod schemas for Riot API responses in `packages/etl/src/riot/schemas.ts` (`riotLeagueEntriesSchema`, `riotLeagueListSchema`, `riotMatchDtoSchema`, `riotMatchIdsSchema`).
  - Added lightweight `.env` parser helper in `packages/etl/src/riot/env.ts` to load `RIOT_API_KEY` seamlessly without heavy dependencies.
  - Re-exported `z` from `@draftorb/shared` so monorepo packages share a single typed Zod instance.
  - Added real Riot API fixtures in `packages/etl/test/fixtures/` (`league-entries.json`, `league-challenger.json`, `match.json`, `match-ids.json`).
  - Added `check-key` CLI command to `packages/etl/src/cli.ts` for quick connectivity and key verification.
  - Recorded ADR `D-015` in `docs/DECISIONS.md`.
  - Wrote 23 unit tests across `packages/etl/src/riot/rate-limiter.test.ts` (9 tests) and `packages/etl/src/riot/client.test.ts` (14 tests) covering 429 retry, 5xx exponential backoff, 401/403 abort, header parsing, queueing, and fixture validation with injected virtual timers.
- Files touched:
  - `packages/etl/src/riot/types.ts`
  - `packages/etl/src/riot/schemas.ts`
  - `packages/etl/src/riot/rate-limiter.ts`
  - `packages/etl/src/riot/rate-limiter.test.ts`
  - `packages/etl/src/riot/client.ts`
  - `packages/etl/src/riot/client.test.ts`
  - `packages/etl/src/riot/env.ts`
  - `packages/etl/src/riot/index.ts`
  - `packages/etl/src/index.ts`
  - `packages/etl/src/cli.ts`
  - `packages/etl/test/fixtures/league-entries.json`
  - `packages/etl/test/fixtures/league-challenger.json`
  - `packages/etl/test/fixtures/match-ids.json`
  - `packages/etl/test/fixtures/match.json`
  - `packages/shared/src/index.ts`
  - `docs/DECISIONS.md`
  - `docs/TICKETS.md`
  - `docs/PROGRESS.md`
- Tests: `pnpm test && pnpm typecheck && pnpm lint` (6 test files, 47 tests passed in < 500ms).
- State left: DONE
- Next step: T-011 (SQLite schema + migrations) or T-020 (Rank weighting module)
- Pitfalls / notes for next AI:
  - Riot match-v5 endpoints use regional routing (`europe`, `americas`, `asia`, `sea`). The client automatically converts platform IDs (e.g. `euw1`) to regional routing via `platformToRegion()`.
  - `RiotClient` constructor accepts custom `sleepFn` and `nowFn` so rate limiting and backoff unit tests run deterministically in milliseconds without actual `setTimeout` delays.
  - `RiotClient` accepts `autoLoadEnv: false` so tests expecting missing API keys do not accidentally re-read `.env` from disk when a local developer key is configured.

### 2026-10-22 — Gemini — Ticket T-004

- Done:
  - Created `data/manual/champion-tags.json` with 70 champions: all 43 support champions from Data Dragon (100% coverage) plus 27 common and off-meta flex picks.
  - Exported `damageTypeSchema`, `DamageType`, `championRangeSchema`, and `ChampionRange` in `@draftorb/shared`.
  - Added key-to-championId match refinement in `championTagsMapSchema` in `@draftorb/shared` to enforce ID integrity.
  - Implemented pure coverage evaluator (`evaluateChampionTagsCoverage`), report formatter (`formatCoverageReport`), and file validator (`validateChampionTagsFile`) in `packages/etl/src/tags.ts`.
  - Added `validate-tags` command to ETL CLI (`packages/etl/src/cli.ts`) and `"validate:tags"` script in root and ETL package.json.
  - Added unit test suite in `packages/etl/src/tags.test.ts` (5 tests covering pure coverage logic, missing supports detection, report formatting, real file validation, and error handling) and updated shared schema tests.
- Files touched:
  - `data/manual/champion-tags.json`
  - `packages/shared/src/index.ts`
  - `packages/shared/src/index.test.ts`
  - `packages/etl/src/tags.ts`
  - `packages/etl/src/tags.test.ts`
  - `packages/etl/src/index.ts`
  - `packages/etl/src/cli.ts`
  - `packages/etl/package.json`
  - `package.json`
  - `docs/TICKETS.md`
  - `docs/PROGRESS.md`
- Tests: `pnpm test && pnpm typecheck && pnpm lint` (4 test files, 24 tests passed), and `pnpm validate:tags` (100% support coverage, 70 champions tagged, untagged champions listed).
- State left: DONE
- Next step: T-010 (Riot client + rate limiter) or T-020 (Rank weighting module)
- Pitfalls / notes for next AI:
  - Thresh and Rakan are ranged in game mechanics (range 450 and 300 respectively); tagged as `RANGED`.
  - `championTagsMapSchema` enforces that dictionary keys match the inner `championId` as strings.
  - `pnpm validate:tags` enforces 100% coverage of champions tagged with `SUPPORT` in `champions.json`; if any support champion is missing in the future, the validation script exits with code 1.

### 2026-10-22 — Gemini — Ticket T-003

- Done:
  - Added `championsMapSchema` and `runeTreesSchema` in `@draftorb/shared`.
  - Implemented Data Dragon importer in `packages/etl/src/ddragon.ts` with pure transformers, version patch extractor (`getPatchFromVersion`), tag-to-role mapper (`mapChampionTagsToRoles`), and fetch functions with optional injection for unit testing.
  - Implemented ETL CLI in `packages/etl/src/cli.ts` supporting `pnpm etl static [version]`.
  - Added root and package script mappings for `etl` and `static`.
  - Recorded ADRs `D-013` (tsx) and `D-014` (@types/node) in `docs/DECISIONS.md`.
  - Wrote comprehensive unit tests in `packages/etl/src/ddragon.test.ts` (7 tests covering edge cases, transformers, mock fetch, and disk file emission).
  - Executed `pnpm etl static` and verified downloaded data for patch 16.21: 173 champions, 859 items, 5 rune trees, all validated by Zod schemas in `data/public/16.21/`.
- Files touched:
  - `packages/shared/src/index.ts`
  - `packages/shared/src/index.test.ts`
  - `packages/etl/src/ddragon.ts`
  - `packages/etl/src/ddragon.test.ts`
  - `packages/etl/src/cli.ts`
  - `packages/etl/src/index.ts`
  - `packages/etl/package.json`
  - `packages/etl/tsconfig.json`
  - `package.json`
  - `docs/DECISIONS.md`
  - `docs/TICKETS.md`
  - `docs/PROGRESS.md`
  - `data/public/16.21/champions.json`
  - `data/public/16.21/items.json`
  - `data/public/16.21/runes.json`
- Tests: `npm test && npm run typecheck && npm run lint` (3 test files, 19 tests passed), and `pnpm etl static` (live import + Zod validation).
- State left: DONE
- Next step: T-004 (Support champion tags)
- Pitfalls / notes for next AI:
  - Data Dragon contains obsolete/internal items with empty `name` (e.g. `2008`, `226660`); `transformItems` filters them out because `itemSchema` requires `name.min(1)`.
  - Data Dragon `runesReforged.json` contains extra fields (`longDesc`); `transformRunes` maps only the fields defined in `runePerkSchema` to comply with `.strict()`.
  - `data/public/<patch>/*.json` files are committed as public assets according to `DATA_MODEL.md`.

### 2026-10-22 — Gemini — Ticket T-002 remediation & completion

- Done:
  - Fixed semantic bug in `PlayerState.items` (was using `championIdSchema`, now uses `itemIdSchema`).
  - Added missing shared models to achieve full parity with `DATA_MODEL.md`: `itemIdSchema`, `itemSchema`, `itemsMapSchema`, `itemTagsSchema`, `itemTagsMapSchema`, `runePerkSchema`, `runeTreeSchema`, `runePageSchema`, `supportBaselineEntrySchema`, `supportBaselineTableSchema`, `supportPairTableSchema`.
  - Removed loose `.rest(z.number())` on `supportPairEntrySchema` to strictly enforce the 6-element tuple contract.
  - Recorded ADR `D-012` for `zod` in `docs/DECISIONS.md`.
  - Resolved and closed `B-002` in `docs/BUGS.md`.
  - Extended unit tests in `packages/shared/src/index.test.ts` (12 tests total, all passing).
- Files touched:
  - `packages/shared/src/index.ts`
  - `packages/shared/src/index.test.ts`
  - `docs/DECISIONS.md`
  - `docs/BUGS.md`
  - `docs/PROGRESS.md`
- Tests: `npx vitest run && npx tsc -b && npx eslint .` all green.
- State left: DONE
- Next step: T-003 (Data Dragon importer)
- Pitfalls / notes for next AI:
  - All static and aggregated formats needed for T-003 and E1 now have validation schemas in `@draftorb/shared`. Superseded: the role-keyed exports, `games_w2` and the D-024 pool fields are T-002.b; see also B-011.
  - File length for `packages/shared/src/index.ts` is 291 lines (< 300 lines rule). If adding more schemas, consider modularizing into domain files (e.g. `draft.ts`, `items.ts`, `runes.ts`). Update 2026-10-26: the file is now 312 lines, above the 300-line convention.

### 2026-10-22 — Session note — Governance review / blocker

- Done: Recorded the blocking semantic bug and the governance drift discovered after T-002.
- Files touched:
  - `docs/BUGS.md`
  - `docs/DECISIONS.md`
- State left: REVIEW / BLOCKED
- Next step:
  - Re-open the T-002 acceptance gate and compare `packages/shared/src/index.ts` against every contract in `docs/DATA_MODEL.md` before declaring any future ticket done.
  - Add the missing schemas required by the data model before continuing to `T-003`.
  - Require schema parity tests that fail if an exported model is absent from the public API.
- Pitfalls / notes for next AI:
  - Green tests do not equal contract coverage.
  - Acceptance must be checked against the canonical docs, not only against the narrow happy path used in the first tests.
  - Project governance requires explicit parity checks and bug logs before ticket closure.

### 2026-10-22 — Claude Opus 4.6 (Thinking) — Ticket T-002

- Done: Implemented the shared Zod schemas and exported TypeScript types for rank, roles, champion IDs, draft inputs, recommendations, game state, manifest data, and static champion metadata. Added focused tests covering valid and invalid payloads.
- Files touched:
  - `packages/shared/src/index.ts`
  - `packages/shared/src/index.test.ts`
  - `packages/shared/package.json`
- Tests: `pnpm test && pnpm typecheck && pnpm lint` — all green (2 test files, 9 tests passed)
- State left: DONE
- Next step: T-003 (Data Dragon importer)
- Pitfalls / notes for next AI:
  - `zod` is the single validation dependency in the shared package
  - Keep runtime logic out of shared package; this ticket is schema-only
  - `DraftInput`/`GameState` are intentionally strict but permissive on optional fields such as `role` and `pool`

### 2026-10-22 — Claude Opus 4.6 (Thinking) — Ticket T-001

- Done: Full monorepo scaffold with pnpm workspaces (shared, engine, etl, web), TypeScript strict config, Vitest, ESLint (flat config), Prettier, Vite + React + Tailwind for web app
- Files touched:
  - Root: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `.prettierrc`, `vitest.config.ts`, `eslint.config.mjs`
  - `packages/shared/`: `package.json`, `tsconfig.json`, `src/index.ts`
  - `packages/engine/`: `package.json`, `tsconfig.json`, `src/index.ts`, `src/hello.ts`, `src/hello.test.ts`
  - `packages/etl/`: `package.json`, `tsconfig.json`, `src/index.ts`
  - `apps/web/`: `package.json`, `tsconfig.json`, `vite.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`
- Tests: `pnpm install && pnpm test && pnpm typecheck && pnpm lint` — all green (3/3 tests pass)
- State left: DONE
- Next step: T-002 (Shared types + zod schemas)
- Pitfalls / notes for next AI:
  - Web tsconfig uses `rootDir: "."` and `noEmit: true` (no composite) to include config files at project root
  - ESLint uses flat config (`eslint.config.mjs`) with `allowDefaultProject` for root config files
  - `postcss.config.mjs` (ESM, not CJS) to avoid lint errors in ESM project
  - Engine has a placeholder `add()` function + test — replace with real code in T-020+
  - Tailwind v3 is used (v4 was still beta-ish at time of scaffold)
