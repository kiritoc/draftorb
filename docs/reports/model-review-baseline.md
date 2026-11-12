# Model review baseline — Phase 0 audit (2026-11-12)

Scope: verify prerequisites, measure real data volume and API limits, run the
current backtest, verify real Riot payloads, and deliver verdicts on findings
F1–F9. No behavior change in this phase. All numbers are aggregates; no foreign
player identifiers appear in this report.

Local database: `data/DraftOrb.sqlite` (read-only queries). Riot calls made in
this run: ~8 (well under `localCallBudget`).

## (a) Prerequisite check — "Fix D-082" artifacts on `main`

Branch `feat/joint-model-and-items-engine` was created from `main` at
`4df96c5` (merge of PR #59). Verified present:

| Artifact                                      | Status  | Evidence                                                                                                                                                                                                                                      |
| --------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Item taxonomy pipeline                        | present | `packages/etl/src/item-classes.ts`, `commands/classify-items.ts`, `data/item-classes.generated.json` (859 items: 140 completed, 19 boots, 63 component, 11 starter, 5 quest_reward, 3 quest_line, 6 jungle_path, 14 consumable, 598 excluded) |
| Item classes export                           | present | `data/public/16.22/item-classes.json`                                                                                                                                                                                                         |
| `item_build.decision_kind` with `path` rows   | present | migration 018; DB: 18,445 `item` + 424 `path` rows                                                                                                                                                                                            |
| `item_events` event types                     | present | 4,709,486 rows; `purchase`/`undo`/`sold`/`destroyed`                                                                                                                                                                                          |
| `kill_events`                                 | present | 604,535 rows                                                                                                                                                                                                                                  |
| `participant_starters`                        | present | 22,968 rows                                                                                                                                                                                                                                   |
| `item_state_scale`                            | present | 10 rows (per patch × 5-min bucket)                                                                                                                                                                                                            |
| `stateBucket()` with `stateBucketMode`        | present | `packages/engine/src/item-context.ts` (`legacyAbsolute`/`timeNormalized`)                                                                                                                                                                     |
| `laneArchKey()`                               | present | `item-context.ts`                                                                                                                                                                                                                             |
| `etl backfill-timelines` + extractor registry | present | `commands/backfill.ts`, `timeline-extractors.ts` (`item-events`, `kill-events`, `participant-ids`; 10,633 matches marked)                                                                                                                     |
| `netPurchasedItems()`, `ownedItemsAt()`       | present | `item-context.ts`                                                                                                                                                                                                                             |

**Prerequisites satisfied — no abort.**

## (b) Data volume

- Matches: **24,325** (was ~3.6k at the D-082 audit). Participants: 243,250.
  Support games (`role='SUPPORT'`): **48,650** across **141** champions
  (games/champion: p10 = 2, p50 = 23, p90 = 1,352, max = 3,820 — heavy skew).
- Patches: 12 labels; mass concentrated in 16.21 (8,524) and 16.22 (13,946);
  16.10–16.19 hold only ~217 matches combined.
- Timeline coverage: 10,633 / 24,325 matches (44%) have extractor_runs done;
  `matches.fetched_timeline` is unused by the Phase B pipeline (stays 0).

### Cell `n_eff` distributions — SUPPORT, DIAMOND bucket

`n_eff = games_w² / games_w2` per aggregate row.

| Table      | cells  | min | p10 | p50 | p90  | max   | % ≥ 25 (`minGames`) | % ≥ 10 (`exportMinGames`) | % ≥ 5 |
| ---------- | ------ | --- | --- | --- | ---- | ----- | ------------------- | ------------------------- | ----- |
| pair_enemy | 22,417 | 1.0 | 1.0 | 2.3 | 25.6 | 307   | 10.3%               | 21.8%                     | 32.9% |
| pair_ally  | 18,560 | 1.0 | 1.0 | 2.3 | 24.5 | 1,266 | 9.8%                | 21.6%                     | 32.8% |
| lane_vs    | 23,102 | 1.0 | 1.0 | 1.0 | 3.6  | 103   | 0.25%               | 1.7%                      | 5.8%  |
| lane_full  | 41,954 | 1.0 | 1.0 | 1.0 | 1.0  | 36    | 0.01%               | 0.06%                     | 0.4%  |

Focused cells — top-30 supports (by game count), enemy SUPPORT and enemy ADC
pair rows, DIAMOND:

| other_role | cells | mean n_eff | % ≥ 25 | % ≥ 10 |
| ---------- | ----- | ---------- | ------ | ------ |
| SUPPORT    | 2,135 | 18.1       | 20.7%  | 36.1%  |
| ADC        | 2,126 | 18.2       | 21.1%  | 37.5%  |

Triples `(candidate, enemy support, enemy ADC)` (`lane_vs`/`lane_full`) are
essentially empty: median n_eff = 1.0.

## (c) Backtest — `pnpm etl backtest draft` (full draft, all roles)

Report: `/tmp/backtest-baseline.json` (run 2026-11-12; holdout = patch 16.22,
training = 10,379 games on 11 earlier patches, holdout = 13,946 games).

- log-loss: engine **0.6967** vs champion-baseline-only **0.6946** — the current
  engine is _worse_ than baseline-only on the frozen holdout.
- Brier: engine 0.2517 vs baseline 0.2507.
- SUPPORT per-role: log-loss 0.6981, mean prediction 0.509 vs actual 0.500.
- Calibration (10 bins): predictions cluster in [0.38, 0.72]; extreme bins are
  overconfident — bin 7 (mean pred 0.724) actual win rate 0.528 (n=89);
  bin 3 (pred 0.377) actual 0.475 (n=3,305). The score is miscalibrated in the
  tails, consistent with unregularized summed pair terms (F2/F4).
- `validationStatus: unvalidated`; masked drafts, paired bootstrap, rolling
  validation and layer ablation are not implemented yet (D-023 gate pending —
  extended in Phase 3).

## (d) Real payload verification (live EUW1 calls, 2026-11-12)

`match-v5` participant `challenges` — all five suspected fields **exist, are
`number`, and are populated 10/10 for every `teamPosition`** in the sampled
match (patch 16.22):

- `earlyLaningPhaseGoldExpAdvantage` (number)
- `laningPhaseGoldExpAdvantage` (number)
- `maxCsAdvantageOnLaneOpponent` (number)
- `maxLevelLeadLaneOpponent` (number)
- `visionScoreAdvantageLaneOpponent` (number)

Each participant carries ~125–127 challenge keys. The project does **not**
store `challenges` today (`riotParticipantDtoSchema` is `.passthrough()` but no
challenges columns exist in `participants`). `teamPosition` was populated for
all 10 participants (`TOP/JUNGLE/MIDDLE/BOTTOM/UTILITY`); `individualPosition`
also present. Timeline `participantFrames` at ~10:00/15:00/20:00 contain
`championStats, currentGold, damageStats, goldPerSecond, jungleMinionsKilled,
level, minionsKilled, participantId, position, timeEnemySpentControlled,
totalGold, xp`. Frame timestamps are **not** exactly on the minute
(600261 ms, 900361 ms, 1200483 ms observed) — extractors must pick the nearest
frame at-or-after the target minute. Early-surrender/remake matches may lack
frames entirely (omit, never store 0).

## (e) Riot client check

`RiotRateLimiter` (`packages/etl/src/riot/rate-limiter.ts`) is header-adaptive:
it parses **all** windows from `X-App-Rate-Limit` and `X-Method-Rate-Limit`
(comma-separated `limit:window` pairs), keeps per-method histories, honors
`Retry-After` via `blockUntil`, and replaces defaults on first response.
Nothing is hard-coded to 100/2 min at runtime (`DEFAULT_APP_LIMITS` is only the
pre-first-response guess). `RiotClient` passes a per-endpoint `methodKey`.

Caveats recorded: (1) the limiter only tracks its own process's requests — the
scheduled workflow shares the same application budget (`X-App-Rate-Limit-Count`
showed 54–57/120 already consumed during measurement), so a local run can
collide with CI; (2) `matches` has no `--call-budget` flag (only
`backfill-timelines` does) — added in Phase 2.

Calls per stored match (steady state): 1 detail + 1 timeline + ~0.02–0.05
amortized id-listing + amortized enrichment ≈ **2.1–2.3**.

## (f) Key and policy

- Key is a standard **personal key** (owner-confirmed); the "DEVELOPMENT KEY"
  header label is generic. Personal keys do not expire on a schedule; dev keys
  deactivate every 24 h (developer.riotgames.com/docs/portal, fetched
  2026-11-12).
- Policy (fetched 2026-11-12): API Terms prohibit "excessive or abusive" request
  volume; no clause explicitly bans scheduled/automated use within limits,
  storing derived aggregates for personal use, or serving derived data in a
  local tool. General Policies require product registration/audit and forbid
  unfair-advantage tools and de-anonymization. Whether DraftOrb is registered
  on the portal: **UNVERIFIED (owner action)**. The "reasonable request volume"
  clause is a judgement call — see decision rule 5.2 outcome in the PR.

## (g) Storage

- DB file: 2,946 MB (2.81 GB of pages) for 24,325 matches ≈ **115 KB/match**.
- gzip -9 of the live file: **498,260,184 bytes ≈ 475 MiB** (≈5.9× ratio).
- Per-table (dbstat, top): `item_events` ~600 MB + indexes ~920 MB total;
  `rune_ctx` ~600 MB; `participants` ~158 MB; pair/lane tables ~150 MB combined.
- Release-asset limit verified from docs.github.com (2026-11-12): **2 GiB per
  file**, ≤1000 assets per release, no total-size limit. 25% cap = 512 MiB.
  Current gzipped DB at ~475 MiB is already at **~93% of that cap** — ingest
  volume must be capped accordingly (decision rule 5.3).
- Repository visibility: **`kiritoc/draftorb` is PRIVATE** (gh, 2026-11-12) —
  this contradicts the D-079 note "the main repo stays public". Consequence for
  5.2(iv): private-repo Actions minutes apply; current `etl.yml` runs last
  ~1–3.5 h × 2/day (≈90–190 h/month ≈ 5,400–11,400 min/month). Free-plan private
  minutes (~2,000/month) and the actual plan are **UNVERIFIED** (billing API
  needs a scope we don't have). Any increase in run duration/volume increases
  monthly minutes → guard 5.2(iv) fails unless the plan is verified.

## (h) Completion curves (item classes; purchase events of `completed`+`boots`)

Methodology note: counts raw purchase events (not net replay); n = participants
with ≥1 such purchase per role (~20.9k each — timeline coverage 44% of matches).

| Role    | k=1 p25/p50/p75 (min) | k=3      | k=5      | median completed items at game end (p25/p75) |
| ------- | --------------------- | -------- | -------- | -------------------------------------------- |
| TOP     | 5/7/10                | 14/16/18 | 23/25/28 | 4 (4/5)                                      |
| JUNGLE  | 6/9/10                | 14/17/19 | 22/24/27 | 5 (4/6)                                      |
| MID     | 4/6/9                 | 12/14/16 | 22/24/27 | 5 (4/5)                                      |
| ADC     | 5/8/10                | 13/14/17 | 21/23/26 | 5 (4/6)                                      |
| SUPPORT | 4/5/9                 | 14/16/19 | 26/29/31 | 4 (3/4)                                      |

Implication for Phase 5.5: median core length ≈ 4 completed items (min 2, max 6).

## (i) Starter bundle frequency (`participant_starters`, 22,968 rows)

Top bundles per role (bundle = `itemId:count` sorted):

- SUPPORT (20 distinct): `2003:2,3340:1,3865:1` 2,426 (53%); `2003:2,3364:1,3865:1`
  1,012 (22%); `2003:2,3865:1` 867 (19%); rest <2% each.
- ADC: `1086:1,2003:2,3340:1` 1,428; `1086:1,2003:2` 1,197; `1055:1,2003:1[,3340:1]`
  ~750 combined.
- MID: `1056:1,2003:2[,3340:1]` ~3,000 combined (Doran's Ring dominant).
- TOP: `1055:1,2003:1[,3340:1]` ~1,600 combined; `1054/1056/1120` variants.
- JUNGLE: pet items dominate — `1101/1102/1103[:3340]` ≈ 3,700 of 4,590.

Top-30 supports combined: same three bundles ≈ 94% of rows. Starter choice is
low-entropy — consistent with "expect many contexts with no detectable
difference" (Phase 5.4).

## (j) Verdicts on F1–F9

- **F1 (data volume vs granularity): CONFIRMED, worse than estimated.** Median
  `n_eff` of pair cells is 2.3 (not "single-digit but usable"); `lane_vs` median
  1.0 and `lane_full` median 1.0 — 99.75%/99.99% of lane cells are below
  `minGames=25`. At n=25 the SE of a win rate is ~10 pp; detecting a true 3 pp
  counter needs ~1,100 games/cell — unreachable at current volume even ×10.
  The engine effectively reduces to baseline + comp + blind for most drafts.
- **F2 (`pairTerm` flaw): CONFIRMED analytically.** `pairTerm = logit(shrunk
pair WR) − logit(p0_c)` subtracts only the candidate baseline. For a weak
  enemy (`p0_e < 0.5`), pair WR exceeds `p0_c` for every candidate → a positive
  ~constant shift for all candidates (distorts absolute probabilities, badges,
  the −4.5 pp warning; count-dependent shrinkage leaks a small ranking bias).
  Same for ally terms. Fix specified in Phase 1.1.
- **F3 (prior strengths guessed): CONFIRMED as unverified.** k=40 implies true
  matchup-effect SD ≈ 0.5/√40 ≈ 7.9 pp; reviewer intuition 2–3 pp ⇒ k in the
  hundreds. `tune-priors` lands in Phase 1.2.
- **F4 (naive-Bayes patch): CONFIRMED directionally.** Summed correlated pair
  terms + hand-set influence + global scale `s` is not jointly fit; backtest
  shows the engine underperforms baseline-only, evidence the variance exceeds
  the signal. Joint model in Phase 3.
- **F5 (blend units): CONFIRMED by code inspection.** `personalizedScore`
  averages `metaNorm ∈ [0,1]` (rank position) with a win probability — ordinal
  and cardinal units mixed (D-073 point 5). Fixed in Phase 1.3.
- **F6 (1-bit outcome): CONFIRMED feasible.** `challenges` lane-advantage
  fields verified populated for all roles (d); timeline `participantFrames`
  give gold/XP/level/CS at ~10/15/20 min for the lane surrogate (Phase 3.1).
- **F7 (API budget unverified): RESOLVED.** Measured app limit 100/120 s +
  20/1 s → 0.833 req/s ≈ 72k/day, shared with CI (see RIOT_API.md "Effective
  limits"). Method limits all ≥16.7 req/s — app limit binds.
- **F8 (item value depends on state/enemy): supported by design need;** no
  contradicting evidence. Phase 5 implements the analytic + data layers.
- **F9 (build plan vs single item): confirmed as scope gap;** starter bundles
  exist (`participant_starters`), path rows exist (`decision_kind='path'`).

## (k) Ticket breakdown (added to TICKETS.md)

See `docs/TICKETS.md` — new section "Prompt-2 model upgrade" with tickets
T-120..T-126 (one per phase) plus sub-items.

## (j2) Phase 1 gate measurements (2026-11-12)

- `backtest draft --pair-adjust` (D-088 on, all else default): log-loss
  **0.696714** vs legacy **0.696726**; Brier 0.251746 vs 0.251745; SUPPORT
  log-loss 0.69794 vs 0.69809. Delta ≈ +0.00001 log-loss — **no measurable
  gain**. As predicted analytically, the adjustment is a near-constant shift
  per slot (ranking essentially unchanged; only shrinkage nonlinearity moves
  probabilities). Verdict: gate FAILS → `pairMainEffectAdjust` stays
  `false`; the flag and `pairMainEffects` remain available for the Phase 3
  joint model where interaction terms are fit jointly rather than demeaned.
- `tune-priors --role=SUPPORT`: grid running at report time; early rows
  (k0=10, k=20–40) show SUPPORT log-loss 0.6983–0.7011 vs the deployed
  (20/40/40) 0.6981 — no dramatic prior win so far. Final JSON:
  `/tmp/tune-priors-support.json` (session-local; rerun command documented
  in SETUP pending Phase 7 docs).

## Assumptions made

- Cell `n_eff` computed as `games_w²/games_w2` on the aggregate tables (the
  engine's own convention).
- Completion curves count purchase events of `completed`+`boots` classes, not
  net-replayed items (approximation; Phase 2 extractor output will be exact).
- "minGames" in (b) = 25 (engine default); `exportMinGames` = 10 also reported.
- Calls/match estimate includes amortized enrichment; mastery fetches are rare.
- Gzip measurement was taken on the live DB file (WAL not checkpointed); a
  post-VACUUM state release may differ slightly.
