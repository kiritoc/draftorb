# DECISIONS (ADR log)

Status: PROPOSED (made by AI, awaiting owner) / ACCEPTED / SUPERSEDED. Newest at bottom.

### D-001 — TypeScript everywhere — ACCEPTED

Single language for ETL, engine, web, desktop, vision (opencv.js/tesseract.js/onnxruntime). Best fit for vibe coding and Windows setup (Node only). Java rejected despite owner expertise (would need 2 languages).

### D-002 — Static site + precomputed JSON, no backend — ACCEPTED

Free hosting, no maintenance. Engine runs client-side.

### D-003 — SQLite for ETL — ACCEPTED

No server to install. `better-sqlite3`.

### D-004 — Two rank logics — ACCEPTED

Draft probabilities from games near user's rank; runes/items from user's rank and above (experts), with experience filters. See SPECS §3.

### D-005 — Phase 1 scope = Support/Diamond/one region — ACCEPTED

### D-006 — No paid services, no runtime LLM — ACCEPTED

Scoring is deterministic stats + manual tags.

### D-007 — Auto-detection order: LCU/Live Client API, then vision — ACCEPTED

Vision is a fallback. Policy check required before shipping.

### D-008 — Rank at collection time approximates rank at game time — ACCEPTED

Documented limitation. Owner decision 2026-10-29.

### D-009 — English only in the repo — ACCEPTED

Code, docs, commits, tickets, bugs, logs and UI text are English. Chat language with AI assistants is free; anything written to files is English.

### D-010 — Dependencies for T-001 scaffold — ACCEPTED

All MIT-licensed, free, widely used:

- **typescript** 5.x — TypeScript compiler (devDep)
- **vitest** 3.x — Test runner, fast, Vite-native (devDep)
- **eslint** 9.x — Linter, flat config (devDep)
- **@eslint/js** + **typescript-eslint** — ESLint TypeScript support (devDep)
- **prettier** 3.x — Code formatter (devDep)
- **react** 19.x + **react-dom** 19.x — UI framework (web dep)
- **vite** 6.x + **@vitejs/plugin-react** — Build tool (web devDep)
- **tailwindcss** 3.x + **postcss** + **autoprefixer** — Styling (web devDep)

### D-011 — Contract parity before ticket closure — ACCEPTED

Context: `T-002` was marked DONE even though the shared package did not implement all schemas required by `docs/DATA_MODEL.md` and the downstream ETL ticket `T-003`.

Decision: Every shared-data ticket must include an explicit parity check against the canonical data contract before status is marked `DONE` or `REVIEW`. The acceptance criteria must list the exact schemas and payload shapes covered, and tests must fail if a required data model is absent.

Alternatives considered:

- Close on green unit tests only: rejected because it allows false positives when the shared contract is incomplete.
- Require only a code diff review: rejected because it is too easy to miss missing exported schemas and downstream breakage.

Consequences:

- Future tickets will be blocked until the schemas, exported types, and validation tests align with `DATA_MODEL.md` and any linked ETL/export requirements.
- This adds a mandatory governance gate and reduces the risk of semantic validation gaps in the next ticket.

Owner decision 2026-10-29.

### D-012 — zod dependency for shared validation schemas — ACCEPTED

- Context: Ticket T-002 requires runtime validation schemas and TypeScript types for draft inputs, recommendations, game state, Data Dragon static data, and exported JSON formats.
- Decision: Use `zod` (^4.x / 4.6.7, MIT) as the single validation dependency in `@draftorb/shared`.
- Alternatives: Joi, Yup, TypeBox, Valibot. Zod is standard in TypeScript/React monorepos, tree-shakeable, zero-runtime-dependencies beyond itself, and infers static TypeScript types without duplication.
- Consequences: Shared package depends on `zod`. Engine and web can safely import schemas without bundling extra runtime dependencies.

### D-013 — tsx dependency for ETL TypeScript CLI execution — ACCEPTED

- Context: Ticket T-003 and Epic E1 implement CLI commands (`pnpm etl static`, `migrate`, etc.) in TypeScript. Scripts must run seamlessly across Windows, macOS, and Linux without requiring a pre-build step in dev workflows.
- Decision: Add `tsx` (devDependency in root, MIT license, free) to execute TypeScript CLI files directly via Node.
- Alternatives: `ts-node` (slower, complex ESM loader issues), native `--experimental-strip-types` (requires Node 22.6+, not backwards compatible with the Node 22 minimum baseline), pre-compiling with `tsc` before every command (slow DX, extra build friction for CLI commands).
- Consequences: `pnpm etl <command>` invokes `tsx packages/etl/src/cli.ts <command>` seamlessly on all platforms.

### D-014 — @types/node devDependency for Node.js API typing — ACCEPTED

- Context: `packages/etl` implements Node.js scripts using `node:fs/promises`, `node:path`, `node:os`, `process`, and `fetch`. TypeScript compiler requires Node type definitions to type-check Node-specific packages.
- Decision: Add `@types/node` (^22.x, MIT license, free) as a root devDependency and enable `"types": ["node"]` in `packages/etl/tsconfig.json`. The `@types/node` major version is aligned to the minimum supported Node version (22).
- Alternatives: Ambient `declare` statements or relying on `DOM` lib (pollutes non-browser code with DOM types).
- Consequences: Strict typing for Node.js APIs in the ETL package. Correction 2026-10-26: `packages/engine` and `packages/shared` did not set `"types": []`, so TypeScript still loaded the root `@types/node` for them and Node globals type-checked there; engine purity was enforced only by review until B-017. Since B-017, the engine and shared tsconfigs set `"types": []` and ESLint blocks Node imports and globals in the engine.

### D-015 — In-house rate limiter and Riot client without external runtime libraries — ACCEPTED

- Context: Ticket T-010 requires a Riot API client honoring dual-window rate limits (`X-App-Rate-Limit` and `X-Method-Rate-Limit`), `Retry-After` backoff on 429, exponential backoff on 5xx, and aborting with "key expired?" on 401/403.
- Decision: Implement `RiotRateLimiter` and `RiotClient` in TypeScript using native `fetch` and zero additional runtime dependencies. Support dependency-injected `sleepFn` and `nowFn` for sub-second deterministic unit tests.
- Alternatives: Third-party rate limiters (e.g. `bottleneck`, `limiter`). Rejected to keep runtime dependencies zero, avoid bundle bloat or ESM quirks, and enable exact compatibility with Riot's multi-window header specification (`X-App-Rate-Limit: 20:1,100:120`).
- Consequences: Fully typed, zero-overhead, 100% testable client with deterministic virtual-clock tests and native zod response validation.

### D-016 — Persisted player rank_score formula — ACCEPTED

- Context: Player discovery stores a numeric `rank_score`, while the weighting logic in SPECS §3 uses broad rank buckets.
- Decision: Persist `rank_score` as the tier base plus division bonus. Tier bases are IRON=0, BRONZE=1, SILVER=2, GOLD=3, PLATINUM=4, EMERALD=5, DIAMOND=6, MASTER=7, GRANDMASTER=8, CHALLENGER=9. For non-apex tiers, division bonuses are IV=0, III=0.25, II=0.50, I=0.75. MASTER, GRANDMASTER, and CHALLENGER have no division bonus. Do not include LP in `rank_score`; retain the raw `tier`, `division`, and `lp` fields and compare them separately when exact rank ordering is needed (tier first, then division for non-apex tiers, then LP; apex tiers use tier then LP).
- Alternatives: Include LP in a single numeric score using a fixed cap; rejected because any cap saturates for high-LP apex players and rounded scores can collapse distinct LP values. A single unbounded LP score would also blur the boundaries between rank tiers.
- Consequences: `rank_score` is a stable tier/division value suitable for coarse aggregation, not a unique rank or within-division ordering. Exact ordering remains lossless in the stored rank fields. This score is distinct from the coarser rank buckets used by SPECS §3.

### D-017 — Rejected matches recorded in `match_rejects`; patch filter is a window lower bound — ACCEPTED

- Context: T-013 ingests ranked solo matches per player. The same match appears for up to 10 players, and refetching a match already rejected (wrong queue, too short, off-patch, invalid payload) wastes API budget. Recommendations weight older patches with recency decay (SPECS §3, `decay^(currentPatchIndex - gamePatchIndex)`), so keeping only the current patch would discard data the weighting is designed to use.
- Decision: New table `match_rejects(match_id PK, reason, patch, checked_at)` where `reason` is `queue|short|patch|invalid`. Any match already in `match_rejects` counts as `filtered` without a Riot call. The patch filter is a lower bound: `--since-patch=X` keeps matches whose patch is >= X (numeric compare on major.minor, so 16.10 > 16.9); when omitted every patch is kept. A `patch` reject stores the match's actual patch and is deleted and re-evaluated as soon as a run's window includes it (`--since-patch` lowered to that patch or below, or omitted). `queue`, `short`, and `invalid` rejects are permanent until `--reset`.
- Alternatives: (a) drop filtered ids silently — rejected, duplicates work across players; (b) store rejected ids inside the per-player cursor JSON — rejected, dedupe must be global; (c) exact `--patch` match — rejected, discards the older patches that recency decay is meant to down-weight and forces a full re-ingestion every patch; (d) re-evaluate every reject on any filter change — rejected for `queue`/`short`/`invalid` since those properties cannot change.
- Consequences: one extra table (migration `002_match_rejects`); recency is handled at aggregation time, not ingestion; the database grows with the window (pruning old patches is a separate concern).

Owner decision 2026-10-29.

### D-018 — Incremental match listing via `startTime` on done cursors — ACCEPTED

- Context: T-013 must resume after kill/restart and also pick up new games on later runs. RIOT_API.md fixes ranked solo = queue 420 but says nothing about re-running ingestion.
- Decision: Per-player cursor in `ingest_state` (`match-ingest:<platform>:<puuid>`) holds `{ status, snapshot, processed, lastGameCreation, sincePatch, stored, duplicates, filtered, invalid, updatedAt }`. `partial` cursors re-scan their stored snapshot (completed players are not re-listed). `done` cursors call `match-v5` with `startTime = lastGameCreation` (the max `gameCreation` of stored matches), so a later run only lists new games — unless the run's window is wider than the cursor's (`--since-patch` lowered or removed), in which case the player relists in full so older patch-rejected games are re-evaluated. `--reset` deletes the platform's cursors and all `match_rejects`, making changed filters (`--queue`, `--min-duration`) effective again. `--limit` selects pending (no/partial cursor) players before done players so repeated batches walk the whole population. Note `startTime` includes games already seen, so `matches`/rejects dedupe stays load-bearing.
- Alternatives: (a) always re-list the full history — rejected, wasteful and slow; (b) store the last-seen match id and page until it — rejected, paging backwards through thousands of ids costs more than a `startTime` filter.
- Consequences: a relisted game that is already stored with its 10 participants, or already in `match_rejects`, is skipped before any `getMatch` call (corrected 2026-10-26 to match the code; this line previously said repeats cost one extra `getMatch` call); `lastGameCreation` only advances on stored matches so filtered games never shrink the window.

Owner decision 2026-10-29.

### D-019 — `matches.avg_rank_score` = mean `rank_score` of known participants, plus `rank_known_count` — ACCEPTED

- Context: `matches.avg_rank_score` exists in DATA_MODEL.md but its computation is unspecified. Every rank weight in SPECS §3 depends on the game's rank, so the reliability of that estimate must be visible. At ingestion time only discovered players have a `rank_score`; the player whose match triggered ingestion is always known.
- Decision: `avg_rank_score` is the mean of known participant `players.rank_score` values, including the seed player's rank. If no other participants are known, it falls back to the seed player's `rank_score`. `matches.rank_known_count` stores the number of known ranks including the seed, so its minimum is 1; a value of 1 means only the seed's rank is known. T-014 enriches the ranks of the four bot-lane participants (league-v4 by puuid, cached in `players` so each player costs one call overall) and recomputes both columns.
- Alternatives: (a) seed player's score only — rejected, ignores other known participants; (b) leave NULL — rejected, downstream buckets need a number; (c) fetch all 10 ranks during T-013 — rejected, ~10x API cost per match; T-014 does a targeted, cached version.
- Consequences: approximate by construction (documented approximation like D-008). Since only discovered Emerald+ players count as known, `avg_rank_score` is biased upward; T-014's bot-lane rank enrichment mitigates this. Aggregation can down-weight games with `rank_known_count = 1` using `unknownRankFactor`.

### D-020 — Role-relative influence matrix by game phase — ACCEPTED

- Context: Not every other player matters equally, and the ranking depends on the user's own role and on the phase of the game. For a support the bot lane (ally ADC, enemy support, enemy ADC) decides most of the laning phase, then the junglers, then mid, then top; for a top laner it is the reverse; a jungler cares first about the enemy jungler, then about the lanes it can play around. SPECS §5 only had one hard-coded support row (`roleWeightAlly`/`roleWeightEnemy`), and items/runes had no notion of who matters.
- Decision: One config table `influence[myRole][side][otherRole][phase]` in `engine/config.ts`, used by draft scoring (§5), rune contexts (§8.1) and item contexts (§8.2). `side` is `ally|enemy`. Phases: `draft` (champion pick), `lane` (runes, starting items slot k = 0, and completed item k = 1 only if purchase time < `laneEndSeconds`, default 840 s), `mid` (everything else). This one rule is used everywhere items are classified (§8.2, D-022). The `draft` and `lane` rows share the default values of the SPECS §5 table (all five roles defined, Phase 1 uses only `SUPPORT`) and may diverge later. Validation rules (T-020): every cell is defined and in [0, 1], the enemy same-role cell (direct lane opponent) is the row maximum, the config is validated by zod and a unit test fails on an incomplete row. In the `mid` phase, for every role, enemy weights become `lambda * lane + (1 - lambda) * threatShare(e) * enemiesKnown` (`threatShare` from §8.2 step 2, `lambda` = 0.3) so the fed enemy matters most whatever their lane; ally weights stay at the `lane` row. Default values are priors only: each role x phase is calibrated separately by the backtest (D-023), which measures each slot's real contribution, and any change to the table must pass that gate.
- Alternatives: (a) keep one support-only weight row — rejected, wrong as soon as the phase or the role changes and blocks later roles; (b) equal weights for every slot — rejected, dilutes the lane matchup that drives most of the outcome; (c) learn the weights only from data — rejected as a start, too noisy at Phase 1 data volumes; the priors plus backtest calibration give a safe path.
- Consequences: one config object instead of two weight rows; the role-confidence factor of §4 still multiplies every slot weight; adding a role later means filling its row, not changing code. If rejected: SPECS §5's influence table and the §8 context slots revert to the previous support-only weights (`roleWeightAlly`/`roleWeightEnemy`), and T-020 drops the matrix.

Owner decision 2026-10-29.

### D-021 — Context win rates: layered back-off with shrinkage in log-odds space — ACCEPTED

- Context: The goal is "what do other players pick/build in this situation, and does it win", counting games that match the current situation exactly more than games that only match partly. SPECS §5 added independent pair deltas in percentage points: exact bot-lane matchups never got extra weight, effects could double-count, and sums could leave [0, 100] %.
- Decision: Every win-rate estimate is a chain of layers from general to exact; each layer is shrunk toward the prediction of the layer below it: `p_L = (wins_L + k_L * q_{L-1}) / (n_L + k_L)`, where `q_{L-1}` is the previous layer's prediction (not the global baseline). Exact contexts therefore dominate when they have enough games and fall back smoothly when they do not. Effects combine on the log-odds scale: `term = logit(p_L) - logit(q_{L-1})`, scaled by the D-020 influence weight and the §4 role confidence. Pair terms are summed and correlated (several describe the same matchups), so a global scale `s` (default 1.0, fit on the validation window by T-027.a) multiplies their sum; only the lane layers chain toward the running prediction `q = sigmoid(x)`. The result is converted back with the logistic function, so no score can leave [0, 1]. Layers per `myRole` (config `laneGroup(myRole)`): champion baseline -> pair terms for every known slot (weighted by `influence[myRole][*][*][draft]`) -> `lane_vs` (enemy lane-group champions) -> `lane_full` (with the ally lane partners); a layer is skipped when one of its champions is unknown. For a support the lane group is the bot lane: `lane_vs` = `(c, enemySupport, enemyAdc)`, `lane_full` = `(c, allyAdc, enemySupport, enemyAdc)`; for a top laner the lane group has no ally partner, so `lane_full` is skipped and only `lane_vs` (c vs enemy top) fires — a layer never duplicates the one below it. Counts are rank- and recency-weighted (§3); thresholds use the effective sample size `n_eff = (sum w)^2 / sum w^2`, so a handful of heavily weighted games cannot pass `minGames`. Before shrinkage, weighted counts are converted to equivalent counts (`games_e = n_eff`, `wins_e = wins_w * n_eff / games_w`) so the prior strength `k` is in raw-game units. Below `minGames` a layer contributes nothing and the reason is flagged `lowData` (golden rule 8).
- Alternatives: (a) additive percentage-point deltas (old §5) — rejected, double counts and can exceed 100 %; (b) exact-context win rate only — rejected, almost always too few games; (c) similarity-kernel weighting over raw games at runtime — rejected, needs raw games in the browser (D-002, 5 MB budget); (d) a trained model (logistic regression / GBM) — deferred, harder to explain in the UI; can be compared later through D-023.
- Consequences: two role-generic aggregated tables (`lane_vs`, `lane_full`) plus a `games_w2` column (sum of squared weights) in every aggregated table; exports keep only rows with `n_eff >= exportMinGames` to respect the size budget; reasons gain a `lane` type for the lane-group terms. Known limitation: draft baselines and pairs have no expert filter (D-004), so one-trick players can inflate some picks; T-027.a includes an optional ablation that down-weights games by `champion_games`. If rejected: SPECS §5 reverts to additive pair deltas, and `lane_vs`/`lane_full`, `games_w2` and the lane work in T-016/T-017 are dropped.

Owner decision 2026-10-29.

### D-022 — Runes and items compared like for like; definition of experts — ACCEPTED

- Context: Raw item win rates are biased: late items only appear in long games and players who are ahead can afford more, so "item X has 58 % win rate" mostly measures game state. SPECS §3 also asks for players with `championGames >= 30`, but champion-mastery-v4 returns points, not games.
- Decision: An item is only compared with other items bought in the same situation: same champion, same item slot `k` (0 = starting items, k >= 1 = k-th completed item), same purchase time bucket (5 min), same state bucket at purchase (`ahead|even|behind` from the team gold difference in the timeline, §8.2 thresholds), same enemy profile bucket (threat-weighted damage mix: `AD|AP|mixed`); for the `lane` phase (k = 0 always; k = 1 only when bought before `laneEndSeconds`, D-020) the context also contains the lane-context slots (top `contextSlots` by lane-phase influence). The score is the shrunk win rate of the item versus the average of all items bought in that same context, with the D-021 back-off chain dropping context dimensions in this order: lane champions -> enemy profile -> state -> time bucket -> (champion, k). Runes use the same chain with context = lane champions -> enemy damage mix -> champion. The `contextSlots` selection ranks slots by descending lane-phase influence (ties by side, ally before enemy, then role order TOP, JUNGLE, MID, ADC, SUPPORT); back-off drops them in the reverse order, least influential first, so the strongest matchup signal survives longest. Experts: a participant counts as an expert on a champion when they have `>= minChampGames` (default 30, config) games on that champion in our own `participants` data within the patch window. The champion-mastery-v4 fallback (`championPoints >= minMasteryPoints`, default 50 000, config) applies only to participants of the role the recommendation is built from (the user's role): mastery is fetched once per (puuid, champion) pair via the by-champion endpoint (`champion-mastery-v4 .../by-puuid/{puuid}/by-champion/{id}`) and cached in `participants.mastery_points` for that champion's rows only — mastery is champion-specific, so a player's points on one champion never bleed into another. Mastery points span all queues and years, so the fallback is an approximation like D-008. `is_expert` is derived: it is recomputed at every aggregation run (idempotent) from the current in-data counts plus the cached `mastery_points`, never at extraction time, so a participant becomes expert as more of their games accumulate. Known limitation: seed players have their full history ingested while other participants appear sporadically, so the in-data test favors seeds; the mastery fallback only covers participants of the recommended role.
- Alternatives: (a) raw per-item win rate — rejected, state and survival bias; (b) only pick rate ("what others build") — rejected, ignores outcome; (c) mastery points only — rejected, points also accumulate in other queues and over years.
- Consequences: at most one champion-mastery-v4 call per (puuid, champion) pair, and only for participants of the recommended role (bounded API cost); `participants` gains `mastery_points` and `is_expert` (migration 004, T-011.b); a second pass in T-014 fills `champion_games` and `mastery_points` (`is_expert` is derived at aggregation). Timeline ingestion (T-051) must record, per purchase, its completed-item index, game time and team gold difference; results are observational ("players who bought X here won Y %"), never presented as causal, and always shown with sample size and pick share. If rejected: SPECS §8.2 keeps only rule-based item scoring and T-011.b's item/expert columns and T-051/T-056's like-for-like work are dropped.

Owner decision 2026-10-29.

### D-023 — Offline backtest gates every weight and parameter — ACCEPTED

- Context: Influence weights, shrinkage strengths, the rank kernel and the recency decay are all guesses until checked against real outcomes. A tool that ranks champions by win rate must prove its numbers predict wins on games it has not seen.
- Decision: New ETL command `pnpm etl backtest`, split into T-027.a (draft predictions) and T-027.b (rune/item context calibration), role-parametrized (`myRole`, reports per `myRole` and per phase; Phase 1 runs only `SUPPORT`). A frozen test holdout (default: the latest patch in the window, or the last 20 % by `created_at`) is never used for training or tuning; tuning uses a rolling temporal validation window inside the training period. Evaluation: `userRank` = each holdout game's own rank bucket (a fixed-Diamond run is also reported) and `currentPatchIndex` = the patch right before the holdout; the engine predicts each holdout player's win with (a) the full draft and (b) masked drafts (blind pick, enemy lane group only, random partial). Metrics: log-loss, Brier score, calibration error over 10 bins, layer coverage (share of holdout drafts where each D-021 layer fires) and per-layer/per-slot ablation, against 0.5 and champion-baseline-only. Gate: an `engine/config.ts` parameter change is accepted only if a paired bootstrap (config `bootstrapResamples`, default 1000) with resampling unit `bootstrapUnit` (`match` default, `player` option — the same player appears in many matches, so match-level resampling can understate variance; the report includes both) shows no significant regression in holdout log-loss beyond `logLossTolerance` (config) AND the model stays significantly better than baseline-only. For runes/items the backtest checks calibration of the shrunk context win rates on holdout purchases (T-027.b). Reports go to `data/reports/backtest-<myRole>-<phase>-<timestamp>.json` (gitignored) and are linked in the PR.
- Alternatives: (a) tune by intuition — rejected, unverifiable; (b) random train/test split — rejected, leaks future patches into training and overstates accuracy; (c) a single log-loss threshold — rejected, ignores match-level correlation and gives no significance.
- Consequences: engine functions stay pure so the same code runs in the web app and in the backtest; parameter PRs need a backtest report; the harness is role-parametrized and its acceptance includes a toy dataset with a planted effect detected for at least TOP and SUPPORT. The frozen holdout is reused across parameter PRs (comparability) and refreshed when the latest patch changes; a gate result is only valid for the holdout it was run on. Release gate: T-034 deploys only with a linked backtest report showing log-loss significantly better than baseline-only on the frozen holdout — otherwise the web app shows a visible "unvalidated model" banner. If rejected: SPECS §5 keeps only intuitive priors and T-027.a/T-027.b are dropped.

Owner decision 2026-10-29.

### D-024 — Champion pool: personal pool list plus an always-visible, paginated overall list — ACCEPTED

- Context: Owner request. A player knows a few champions well. The tool should (1) show the best picks among _those_ champions for the current draft and (2) always show the best picks overall, so the player can also learn a new champion. SPECS §2 only had an optional `pool` "filter" and T-033 a vague "second list"; a hard filter would hide the "learn something new" case, and it was undefined whether the pool changes scores or widens the candidate set.
- Decision:
  1. **Pool.** A per-role list of champion ids owned by the user and stored only in the browser (`localStorage` key `draftorb.pool.v1`, versioned envelope `{ version: 1, pools: { <ROLE>: ChampionId[] } }`, zod-validated; no server, no account — D-002/D-006). Phase 1 UI exposes only SUPPORT; storage and schema are role-keyed. Max `poolMaxSize` per role (UI config, default 40). Blocked, full or corrupted storage never crashes the app: fall back to an empty in-memory pool and tell the user. On load, ids missing from the current `champions.json` are dropped with a notice. The pool can be exported/imported as validated JSON text to back it up or move devices.
  2. **The pool never changes scores.** `score(c)` and its reasons are identical with or without a pool. It is not a score boost and not a hard filter that hides overall picks. Known limitation: population win rates describe an average player, so a champion the user plays well may do better than shown; this is not modeled.
  3. **Engine contract.** `DraftInput.pool?` (the pool of `userRole`) stays optional. `DraftResult.recommendations` is always the complete overall ranking of every scored candidate (the engine never truncates it) with global `rank`. When `pool` is non-empty, `DraftResult` also carries `poolRecommendations` (scored pool champions in overall order; each keeps its global `rank` and gets `poolRank`, its rank inside the pool) and `poolUnavailable: { championId, reason: 'insufficientData' | 'unknownChampion' | 'picked' }[]` (the sample sizes stay in `insufficientData`, a single source; `picked` = already on the board, added in T-023, SPECS §7). Candidate set = champions with `roleProb[c][myRole] >= 0.05` plus every pool champion; a pool champion below the threshold is scored if it passes the baseline gate and carries the warning `offRole`.
  4. **UI.** The recommendations screen always shows a "Best overall" list, even with an empty pool. When the pool is non-empty a "From your pool" list is shown above it; with an empty pool a one-line call to action replaces it. The overall list also contains pool champions, tagged "In your pool", with a UI-only toggle "Hide my pool" (default off) for learning mode; ranks stay global. Each list is paginated independently and client-side: the first `recommendationPageSize` items (default 5), then a "Show N more" button reveals the next N (N = page size) until the list is exhausted, with a "Showing X of Y" label; the button disappears when nothing remains. Visible counts reset when the draft input changes (and the pool list when the pool changes). Pool champions without enough data are listed after the ranked ones with the reason ("not enough data (n_eff 12)"), never silently hidden.
- Alternatives: (a) pool as a hard filter (old SPECS §2) — rejected, no "learn a new champion" list; (b) boost pool champions' scores — rejected, mixes preference with win probability and breaks D-023 validation and explanations; (c) one merged list with badges — rejected, pool picks get buried under the overall ranking; (d) accounts or cloud sync — rejected (D-002, D-006, golden rule 1); (e) derive the pool from match history or mastery — deferred, needs the user's puuid and extra Riot calls; (f) infinite scroll — rejected, an explicit "Show more" keeps keyboard/screen-reader use and tests simple.
- Consequences: the engine output stays complete (about 170 entries, inside the 50 ms budget) and deterministic. T-002.b adds `poolRank`, `poolRecommendations`, `poolUnavailable` and the pool storage schema; T-023 implements the contract and its tests prove that the pool never changes scores; T-032 delivers the overall list with pagination; T-033 delivers pool storage, editor, import/export and the pool list. If rejected: SPECS §2/§2.1/§5/§7/§7.1 and tickets T-002.b/T-023/T-026/T-032/T-033 revert to the single filtered-list wording. Owner confirmed the defaults: page size 5, `poolMaxSize` 40 per role, and the overall list includes pool champions by default ("In your pool" badge, "Hide my pool" toggle off). Clarification (review of PR #6): "never changes order" does not mean `recommendations` is identical with vs without a pool. Point 3 widens the candidate set, so overall `rank` may shift when pool-only champions are inserted; scores of shared champions and their relative order stay the same. T-033 must test that, not list identity.

### D-028 — Record type-only devDependencies already in use — ACCEPTED

- Context: AGENTS.md rule 6 requires every dependency to be recorded here. The 2026-10-26 review found three type-only packages in use without an entry. Renumbered from D-025 (2026-10-29) to avoid the ID collision with the D-025 correction entry below.
- Decision: Keep `@types/better-sqlite3` (^9.6.0, `packages/etl`), `@types/react` and `@types/react-dom` (^19.1.2, `apps/web`) as devDependencies. All are MIT-licensed DefinitelyTyped packages, free, with no runtime code.
- Alternatives: hand-written declarations — rejected, more maintenance for no benefit.
- Consequences: no runtime impact. `@types/better-sqlite3` ^9.6.0 is older than `better-sqlite3` 13.0.3; check the typings when upgrading either package.

Owner decision 2026-10-29.

### D-026 — Require Node 22 (B-015) — ACCEPTED

- Context: B-015 reported that `better-sqlite3` 13.0.3 segfaults on Node 20.19.0. Investigation on Node 20.20.2 confirmed the segfault (exit code 139) when loading `better-sqlite3`'s native addon. The `better-sqlite3` 13.x release declares `engines.node: >=22`, and no 13.x version ships prebuilt binaries compatible with Node 20. The project's CI already runs only Node 22, and the owner's Node policy for this task is **B** (require Node 22).
- Decision: Raise the minimum supported Node version to 22. Set `engines.node` to `>=22.0.0` in the root `package.json`; update AGENTS.md rule 2 to "Node.js 22+"; update docs/SETUP.md and docs/ARCHITECTURE.md accordingly; align `@types/node` to the Node 22 major (`^22.x`); keep CI on Node 22 only with `node-version: ${{ matrix.node-version }}`.
- Alternatives:
  - Make Node 20 work by pinning an older `better-sqlite3` to a version with Node 20 prebuilt binaries — rejected by policy [B]; the owner requires Node 22.
  - Support both Node 20 and 22 — rejected by policy [B]; not pursued.
- Consequences: Node 20 is no longer a supported runtime. Developers and CI must use Node 22. `better-sqlite3` 13.0.3 remains pinned in `packages/etl/package.json` (it already satisfies the Node 22 requirement). The `Node version policy` open question in PROGRESS.md is resolved.

### D-025 — Correction: Node 22 minimum raises @types/node from ^26.x to ^22.x — ACCEPTED

- Context: D-028 (formerly D-025) referenced `@types/better-sqlite3`, `@types/react`, `@types/react-dom` but the root `@types/node` was `^26.6.5` (matching Node 26, not the then-declared Node 20 minimum). D-026 raised the minimum Node version to 22.
- Decision: Correct the root `@types/node` devDependency from `^26.6.5` to `^22.18.5` to align with the Node 22 minimum. The `@types/better-sqlite3` version is unaffected.
- Consequences: `@types/node` now matches the supported Node major version; no API surface changes for the ETL package.

### D-027 — B-011 resolution: n semantics, apex bucket name, role-prob sparsity — ACCEPTED (owner decision)

- Context: B-011 identified that SPECS §3/§7 and the shared schemas diverged on three points that T-002.b must resolve at the spec level before implementing the schemas.
- Decision (owner-chosen):
  1. **`Reason.n` and `Recommendation.reliability.games` carry `n_eff` (a real number), not raw games.** Every threshold and `lowData` flag in SPECS is evaluated against `n_eff = (sum w)^2 / sum w^2`; exposing `n_eff` makes the displayed sample size meaningful alongside weighted winrates. `DraftResult.insufficientData` continues to expose both `nEff` and `rawGames` for champions that fail the baseline gate.
  2. **The merged apex rank bucket is named `MASTER_PLUS`.** It merges MASTER, GRANDMASTER and CHALLENGER. Exports and `manifest.rankBuckets` use the 8 buckets (IRON, BRONZE, SILVER, GOLD, PLATINUM, EMERALD, DIAMOND, MASTER_PLUS), not the 10 raw rank tiers.
  3. **`role-prob.json` is sparse:** each champion entry lists only the roles with non-zero probability (roles that have games); absent roles are treated as 0. In zod 4, `z.record(roleSchema, numberSchema)` requires every key, so a sparse map must use `z.partialRecord` (or equivalent). Each champion's probabilities sum to 1 (tolerance 1e-6).
- Alternatives considered: (1) raw games — rejected because thresholds use `n_eff`, so showing raw counts would mislead; (2) `MASTER` without suffix — rejected, ambiguous with the raw MASTER tier; (3) dense maps — rejected, bloats the file with zero entries for off-role champions.
- Consequences: T-002.b schemas use `z.number().nonnegative()` (not `.int()`) for `Reason.n` and `reliability.games`; a `rankBucketSchema` with 8 values replaces `rankSchema` in bucket-typed fields; `championRoleProbabilitiesSchema` uses `z.partialRecord`; all export rows and `manifest.rankBuckets` carry the 8-value bucket.

### D-029 — Review resolutions: lowData required, manifest version pinned, zero-prob and pool-duplicate guards — ACCEPTED

- Context: Code review flagged four gaps in the T-002.b shared schemas:
  1. `Reason.lowData` was optional in the schema even though T-002.b calls it a boolean field.
  2. `manifestSchema.schemaVersion` accepted any positive integer, so tests used both 1 and 2 for the role-keyed manifest with no agreed value.
  3. `championRoleProbabilitiesSchema` accepted zero-valued role entries (e.g. `{ SUPPORT: 1, TOP: 0 }`) because `min(0)` allows 0 and the sum still equals 1, violating the sparse-map contract in DATA_MODEL.md.
  4. `championPoolSchema` accepted duplicate champion ids (e.g. `{ SUPPORT: [41, 41] }`), violating the per-role uniqueness contract that feeds recommendation generation.
- Decision:
  1. **`Reason.lowData` is required (`z.boolean()`).** The engine emits it for every reason — `true` when the reason's supporting term has `n_eff < minGames` (the term contributes 0 to the score, SPECS §5), `false` otherwise, including for non-data-driven reasons (e.g. `comp`) that carry no sample-size gate.
  2. **`MANIFEST_SCHEMA_VERSION = 1`** is a shared literal exported from `packages/shared/src/schemas/core.js`. `manifestSchema.schemaVersion` is `z.literal(MANIFEST_SCHEMA_VERSION)`. Version 1 is the agreed format for the role-keyed layout described in DATA_MODEL.md; it is bumped by convention when a JSON format changes, after which both the exporter and loader are updated together.
  3. **Zero-valued roles are rejected.** The inner value schema uses `z.number().finite().gt(0).max(1)` so any present role must have a positive probability; zero is omitted rather than encoded. This is combined with the existing sum-to-1 refinement (tolerance 1e-6).
  4. **Duplicate pool ids are rejected.** Each role's array is refined with `new Set(ids).size === ids.length`; the pool-size ceiling (`poolMaxSize`, default 40) remains a UI concern per T-002.b/D-024.
- Alternatives considered:
  - Leave `lowData` optional and let the engine choose — rejected, it removes a useful validation signal and contradicts the T-002.b acceptance criterion ("`Reason.lowData` exists").
  - Accept any version number and let exporters pick — rejected, causes the exact drift the review found (tests using 1 and 2 with no loader agreement).
  - Keep `min(0)` and add a separate zero-check refinement — rejected in favor of the simpler `gt(0)`, which communicates intent at the value level.
- Consequences: four test cases updated (zero-valued role map made sparse, duplicate pool id, manifest version pinning, zero-rejection negative test); `MANIFEST_SCHEMA_VERSION` re-exported from the package barrel. No engine or ETL code consumed these schemas yet (T-020/T-019 are not started), so no downstream breakage.

### Template

```
### D-xxx — Title — STATUS
Context / Decision / Alternatives / Consequences
```
