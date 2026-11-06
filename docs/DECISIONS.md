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

Update (T-019.b, D-043): the numeric `major.minor` compare for the `--since-patch` window and `patch`-reject re-evaluation is SUPERSEDED — both now compare `patch_index` from the `patches` table. The rest of this decision (reject table, window lower bound, permanence of `queue`/`short`/`invalid`) stands.

Owner decision 2026-10-29.

### D-018 — Incremental match listing via `startTime` on done cursors — ACCEPTED

- Context: T-013 must resume after kill/restart and also pick up new games on later runs. RIOT_API.md fixes ranked solo = queue 420 but says nothing about re-running ingestion.
- Decision: Per-player cursor in `ingest_state` (`match-ingest:<platform>:<puuid>`) holds `{ status, snapshot, processed, lastGameCreation, sincePatch, stored, duplicates, filtered, invalid, updatedAt }`. `partial` cursors re-scan their stored snapshot (completed players are not re-listed). `done` cursors call `match-v5` with `startTime = lastGameCreation` (the max `gameCreation` of stored matches), so a later run only lists new games — unless the run's window is wider than the cursor's (`--since-patch` lowered or removed), in which case the player relists in full so older patch-rejected games are re-evaluated. `--reset` deletes the platform's cursors and all `match_rejects`, making changed filters (`--queue`, `--min-duration`) effective again. `--limit` selects pending (no/partial cursor) players before done players so repeated batches walk the whole population. Note `startTime` includes games already seen, so `matches`/rejects dedupe stays load-bearing.
- Alternatives: (a) always re-list the full history — rejected, wasteful and slow; (b) store the last-seen match id and page until it — rejected, paging backwards through thousands of ids costs more than a `startTime` filter.
- Consequences: a relisted game that is already stored with its 10 participants, or already in `match_rejects`, is skipped before any `getMatch` call (corrected 2026-10-26 to match the code; this line previously said repeats cost one extra `getMatch` call); `lastGameCreation` only advances on stored matches so filtered games never shrink the window.

Owner decision 2026-10-29.

### D-019 — `matches.avg_rank_score` = mean `rank_score` of known participants, plus `rank_known_count` — ACCEPTED

- Context: `matches.avg_rank_score` exists in DATA_MODEL.md but its computation is unspecified. Every rank weight in SPECS §3 depends on the game's rank, so the reliability of that estimate must be visible. At ingestion time only discovered players have a `rank_score`; the player whose match triggered ingestion is always known.
- Decision: `avg_rank_score` is the mean of known participant `players.rank_score` values, including the seed player's rank. If no other participants are known, it falls back to the seed player's `rank_score`. `matches.rank_known_count` stores the number of known ranks including the seed, so its minimum is 1; a value of 1 means only the seed's rank is known. T-014 enriches the ranks of the four bot-lane participants (league-v4 by puuid, cached in `players`) and recomputes both columns.
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
- Decision: An item is only compared with other items bought in the same situation: same champion, same item slot `k` (0 = starting items, k >= 1 = k-th completed item), same purchase time bucket (5 min), same state bucket at purchase (`ahead|even|behind` from the team gold difference in the timeline, §8.2 thresholds), same enemy profile bucket (threat-weighted damage mix: `AD|AP|mixed`); for the `lane` phase (k = 0 always; k = 1 only when bought before `laneEndSeconds`, D-020) the context also contains the lane-context slots (top `contextSlots` by lane-phase influence). The score is the shrunk win rate of the item versus the average of all items bought in that same context, with the D-021 back-off chain dropping context dimensions in this order: lane champions -> enemy profile -> state -> time bucket -> (champion, k). Runes use the same chain with context = lane champions -> enemy damage mix -> champion. The `contextSlots` selection ranks slots by descending lane-phase influence (ties by side, ally before enemy, then role order TOP, JUNGLE, MID, ADC, SUPPORT); back-off drops them in the reverse order, least influential first, so the strongest matchup signal survives longest. Experts: a participant counts as an expert on a champion when they have `>= minChampGames` (default 30, config) games on that champion in our own `participants` data within the patch window. The champion-mastery-v4 fallback (`championPoints >= minMasteryPoints`, default 50 000, config) applies only to participants of the role the recommendation is built from (the user's role): mastery is fetched once per (puuid, champion) pair via the by-champion endpoint (`champion-mastery-v4 .../by-puuid/{puuid}/by-champion/{id}`) and cached in `participants.mastery_points` for that champion's rows only — mastery is champion-specific, so a player's points on one champion never bleed into another. Mastery points span all queues and years, so the fallback is an approximation like D-008. `is_expert` is derived: ... (line truncated to 2000 chars)
- Alternatives: (a) raw per-item win rate — rejected, state and survival bias; (b) only pick rate ("what others build") — rejected, ignores outcome; (c) mastery points only — rejected, points also accumulate in other queues and over years.
- Consequences: at most one champion-mastery-v4 call per (puuid, champion) pair, and only for participants of the recommended role (bounded API cost); `participants` gains `mastery_points` and `is_expert` (migration 004, T-011.b); a second pass in T-014 fills `champion_games` and `mastery_points` (`is_expert` is derived at aggregation). Timeline ingestion (T-051) must record, per purchase, its completed-item index, game time and team gold difference; results are observational ("players who bought X here won Y %"), never presented as causal, and always shown with sample size and pick share. If rejected: SPECS §8.2 keeps only rule-based item scoring and T-011.b's item/expert columns and T-051/T-056's like-for-like work are dropped.

Owner decision 2026-10-29.

### D-023 — Offline backtest gates every weight and parameter — ACCEPTED

- Context: Influence weights, shrinkage strengths, the rank kernel and the recency decay are all guesses until checked against real outcomes. A tool that ranks champions by win rate must prove its numbers predict wins on games it has not seen.
- Decision: New ETL command `pnpm etl backtest`, split into T-027.a (draft predictions) and T-027.b (rune/item context calibration), role-parametrized (`myRole`, reports per `myRole` and per phase; Phase 1 runs only `SUPPORT`). A frozen test holdout (default: the latest patch in the window, or the last 20 % by `created_at`) is never used for training or tuning; tuning uses a rolling temporal validation window inside the training period. Evaluation: `userRank` = each holdout game's own rank bucket (a fixed-Diamond run is also reported) and `currentPatchIndex` = the patch right before the holdout; the engine predicts each holdout player's win with (a) the full draft and (b) masked drafts (blind pick, enemy lane group only, random partial). Metrics: log-loss, Brier score, calibration error over 10 bins, layer coverage (share of holdout drafts where each D-021 layer fires) and per-layer/per-slot ablation, against 0.5 and champion-baseline-only. Gate: an `engine/config.ts` parameter change is accepted only if a paired bootstrap (config `bootstrapResamples`, default 1000) with resampling unit `bootstrapUnit` (`match` default, `player` option — the same player appears in many matches, so match-level resampling can understate variance; the report includes both) shows no significant regression in holdout log-loss beyond `logLossTolerance` (config) AND the model stays significantly better than baseline-only. For runes/items the backtest checks calibration of the shrunk context win rates on holdout purchases (T-027.b). Reports go to `data/reports/backtest-<myRole>-<phase>-<timestamp>.json` (gitignored) and are linked in the PR.
- Alternatives: (a) tune by intuition — rejected, unverifiable; (b) random train/test split — rejected, leaks future patches into training and overstates accuracy; (c) a single log-loss threshold — rejected, ignores match-level correlation and gives no significance.
- Consequences: engine functions stay pure so the same code runs in the web app and in the backtest; parameter PRs need a backtest report; the harness is role-parametrized and its acceptance includes a toy dataset with a planted effect detected for at least TOP and SUPPORT. The frozen holdout is reused across parameter PRs (comparability) and refreshed when the latest patch changes; a gate result is only valid for the holdout it was run on. Release gate: the web app shows an "unvalidated model" banner unless a report explicitly records `validationStatus: "validated"` and beats the training-only baseline. T-027.a currently reports `validationStatus: "unvalidated"`; the paired-bootstrap gate and remaining validation metrics are not implemented. If rejected: SPECS §5 keeps only intuitive priors and T-027.a/T-027.b are dropped.

Owner decision 2026-10-29.

### D-024 — Champion pool: personal pool list plus an always-visible, paginated overall list — ACCEPTED

- Context: Owner request. A player knows a few champions well. The tool should (1) show the best picks among _those_ champions for the current draft and (2) always show the best picks overall, so the player can also learn a new champion. SPECS §2 only had an optional `pool` "filter" and T-033 a vague "second list"; a hard filter would hide the "learn something new" case, and it was undefined whether the pool changes scores or widens the candidate set.
- Decision:
  1. **Pool.** A per-role list of champion ids owned by the user and stored only in the browser (`localStorage` key `draftorb.pool.v1`, versioned envelope `{ version: 1, pools: { <ROLE>: ChampionId[] } }`, zod-validated; no server, no account — D-002/D-006). Phase 1 UI exposes only SUPPORT; storage and schema are role-keyed. Max `poolMaxSize` per role (UI config, default 40). Blocked, full or corrupted storage never crashes the app: fall back to an empty in-memory pool and tell the user. On load, ids missing from the current `champions.json` are dropped with a notice. The pool can be exported/imported as validated JSON text to back it up or move devices.
  2. **The pool never changes scores.** `score(c)` and its reasons are identical with or without a pool. It is not a score boost and not a hard filter that hides overall picks. Known limitation: population win rates describe an average player, so a champion the user plays well may do better than shown; this is not modeled.
  3. **Engine contract.** `DraftInput.pool?` (the pool of `userRole`) stays optional. `DraftResult.recommendations` is always the complete overall ranking of every scored candidate (the engine never truncates it) with global `rank`. When `pool` is non-empty, `DraftResult` also carries `poolRecommendations` (scored pool champions in overall order; each keeps its global `rank` and gets `poolRank`, its rank inside the pool) and `poolUnavailable: { championId, reason: 'insufficientData' | 'unknownChampion' | 'picked' }[]` (the sample sizes stay in `insufficientData`, a single source; `picked` = already on the board, added in T-023, SPECS §7). Candidate set = champions with `roleProb[c][myRole] >= roleProbThreshold` (config, default 0.05) plus every pool champion; a pool champion below the threshold is scored if it passes the baseline gate and carries the warning `offRole`.
  4. **UI.** The recommendations screen always shows a "Best overall" list, even with an empty pool. When the pool is non-empty a "From your pool" list is shown above it; with an empty pool a one-line call to action replaces it. The overall list also contains pool champions, tagged "In your pool", with a UI-only toggle "Hide my pool" (default off) for learning mode; ranks stay global. Each list is paginated independently and client-side: the first `recommendationPageSize` items (default 5), then a "Show N more" button reveals the next N (N = page size) until the list is exhausted, with a "Showing X of Y" label; the button disappears when nothing remains. Visible counts reset when the draft input changes (and the pool list when the pool changes). Pool champions without enough data are listed after the ranked ones with the reason ("not enough data (n_eff 12)"), never silently hidden.
- Alternatives: (a) pool as a hard filter (old SPECS §2) — rejected, no "learn a new champion" list; (b) boost pool champions' scores — rejected, mixes preference with win probability and breaks D-023 validation and explanations; (c) one merged list with badges — rejected, pool picks get buried under the overall ranking; (d) accounts or cloud sync — rejected (D-002, D-006, golden rule 1); (e) derive the pool from match history or mastery — deferred, needs the user's puuid and extra Riot calls; (f) infinite scroll — rejected, an explicit "Show more" keeps keyboard/screen-reader use and tests simple.
- Consequences: the engine output stays complete (about 170 entries, inside the 50 ms budget) and deterministic. T-002.b adds `poolRank`, `poolRecommendations`, `poolUnavailable` and the pool storage schema; T-023 implements the contract and its tests prove that the pool never changes scores; T-032 delivers the overall list with pagination; T-033 delivers pool storage, editor, import/export and the pool list. If rejected: SPECS §2/§2.1/§5/§7/§7.1 and tickets T-002.b/T-023/T-026/T-032/T-033 revert to the single filtered-list wording. Owner confirmed the defaults: page size 5, `poolMaxSize` 40 per role, and the overall list includes pool champions by default ("In your pool" badge, "Hide my pool" toggle off). Clarification (review of PR #6): "never changes order" does not mean `recommendations` is identical with vs without a pool. Point 3 widens the candidate set, so overall `rank` may shift when pool-only champions are inserted; scores of shared champions and their relative order stay the same. T-033 must test that, not list identity.

### D-025 — Correction: Node 22 minimum raises @types/node from ^26.x to ^22.x — ACCEPTED

- Context: D-028 (formerly D-025) referenced `@types/better-sqlite3`, `@types/react`, `@types/react-dom` but the root `@types/node` was `^26.6.5` (matching Node 26, not the then-declared Node 20 minimum). D-026 raised the minimum Node version to 22.
- Decision: Correct the root `@types/node` devDependency from `^26.6.5` to `^22.18.5` to align with the Node 22 minimum. The `@types/better-sqlite3` version is unaffected.
- Consequences: `@types/node` now matches the supported Node major version; no API surface changes for the ETL package.

### D-026 — Require Node 22 (B-015) — ACCEPTED

- Context: B-015 reported that `better-sqlite3` 13.0.3 segfaults on Node 20.19.0. Investigation on Node 20.20.2 confirmed the segfault (exit code 139) when loading `better-sqlite3`'s native addon. The `better-sqlite3` 13.x release declares `engines.node: >=22`, and no 13.x version ships prebuilt binaries compatible with Node 20. The project's CI already runs only Node 22, and the owner's Node policy for this task is **B** (require Node 22).
- Decision: Raise the minimum supported Node version to 22. Set `engines.node` to `>=22.0.0` in the root `package.json`; update AGENTS.md rule 2 to "Node.js 22+"; update docs/SETUP.md and docs/ARCHITECTURE.md accordingly; align `@types/node` to the Node 22 major (`^22.x`); keep CI on Node 22 only with `node-version: ${{ matrix.node-version }}`.
- Alternatives:
  - Make Node 20 work by pinning an older `better-sqlite3` to a version with Node 20 prebuilt binaries — rejected by policy [B]; the owner requires Node 22.
  - Support both Node 20 and 22 — rejected by policy [B]; not pursued.
- Consequences: Node 20 is no longer a supported runtime. Developers and CI must use Node 22. `better-sqlite3` 13.0.3 remains pinned in `packages/etl/package.json` (it already satisfies the Node 22 requirement). The `Node version policy` open question in PROGRESS.md is resolved.

### D-027 — B-011 resolution: n semantics, apex bucket name, role-prob sparsity — ACCEPTED (owner decision)

- Context: B-011 identified that SPECS §3/§7 and the shared schemas diverged on three points that T-002.b must resolve at the spec level before implementing the schemas.
- Decision (owner-chosen):
  1. **`Reason.n` and `Recommendation.reliability.games` carry `n_eff` (a real number), not raw games.** Every threshold and `lowData` flag in SPECS is evaluated against `n_eff = (sum w)^2 / sum w^2`; exposing `n_eff` makes the displayed sample size meaningful alongside weighted winrates. `DraftResult.insufficientData` continues to expose both `nEff` and `rawGames` for champions that fail the baseline gate.
  2. **The merged apex rank bucket is named `MASTER_PLUS`.** It merges MASTER, GRANDMASTER and CHALLENGER. Exports and `manifest.rankBuckets` use the 8 buckets (IRON, BRONZE, SILVER, GOLD, PLATINUM, EMERALD, DIAMOND, MASTER_PLUS), not the 10 raw rank tiers.
  3. **`role-prob.json` is sparse:** each champion entry lists only the roles with non-zero probability (roles that have games); absent roles are treated as 0. In zod 4, `z.record(roleSchema, numberSchema)` requires every key, so a sparse map must use `z.partialRecord` (or equivalent). Each champion's probabilities sum to 1 (tolerance 1e-6).
- Alternatives considered: (1) raw games — rejected because thresholds use `n_eff`, so showing raw counts would mislead; (2) `MASTER` without suffix — rejected, ambiguous with the raw MASTER tier; (3) dense maps — rejected, bloats the file with zero entries for off-role champions.
- Consequences: T-002.b schemas use `z.number().nonnegative()` (not `.int()`) for `Reason.n` and `reliability.games`; a `rankBucketSchema` with 8 values replaces `rankSchema` in bucket-typed fields; `championRoleProbabilitiesSchema` uses `z.partialRecord`; all export rows and `manifest.rankBuckets` carry the 8-value bucket.

### D-028 — Record type-only devDependencies already in use — ACCEPTED

- Context: AGENTS.md rule 6 requires every dependency to be recorded here. The 2026-10-26 review found three type-only packages in use without an entry. Renumbered from D-025 (2026-10-29) to avoid the ID collision with the D-025 correction entry below.
- Decision: Keep `@types/better-sqlite3` (^9.6.0, `packages/etl`), `@types/react` and `@types/react-dom` (^19.1.2, `apps/web`) as devDependencies. All are MIT-licensed DefinitelyTyped packages, free, with no runtime code.
- Alternatives: hand-written declarations — rejected, more maintenance for no benefit.
- Consequences: no runtime impact. `@types/better-sqlite3` ^9.6.0 is older than `better-sqlite3` 13.0.3; check the typings when upgrading either package.

Owner decision 2026-10-29.

### D-029 — Review resolutions: lowData required, manifest version pinned, zero-prob and pool-duplicate guards — ACCEPTED

- Context: Code review flagged four gaps in the T-002.b shared schemas:
  1. `Reason.lowData` was optional in the schema even though T-002.b calls it a boolean field.
  2. `manifestSchema.schemaVersion` accepted any positive integer, so tests used both 1 and 2 for the role-keyed manifest with no agreed value.
  3. `championRoleProbabilitiesSchema` accepted zero-valued role entries (e.g. `{ SUPPORT: 1, TOP: 0 }`) because `min(0)` allows 0 and the sum still equals 1, violating the sparse-map contract in DATA_MODEL.md.
  4. `championPoolSchema` accepted duplicate champion ids (e.g. `{ SUPPORT: [41, 41] }`), violating the per-role uniqueness contract that feeds recommendation generation.
- Decision:
  1. **`Reason.lowData` is required (`z.boolean()`).** The engine emits it for every reason — `true` when the reason's supporting term has `n_eff < minGames` (the term contributes 0 to the score, SPECS §5), `false` otherwise, including for non-data-driven reasons (e.g. `comp`) that carry no sample-size gate.
  2. **`MANIFEST_SCHEMA_VERSION = 2`** is a shared literal exported from `packages/shared/src/schemas/core.js`. `manifestSchema.schemaVersion` is `z.literal(MANIFEST_SCHEMA_VERSION)`. Version 2 is the agreed format for the role-keyed layout described in DATA_MODEL.md (6th baseline column `games`); it supersedes version 1 (D-030). It is bumped by convention when a JSON format changes, after which both the exporter and loader are updated together.
  3. **Zero-valued roles are rejected.** The inner value schema uses `z.number().finite().gt(0).max(1)` so any present role must have a positive probability; zero is omitted rather than encoded. This is combined with the existing sum-to-1 refinement (tolerance 1e-6).
  4. **Duplicate pool ids are rejected.** Each role's array is refined with `new Set(ids).size === ids.length`; the pool-size ceiling (`poolMaxSize`, default 40) remains a UI concern per T-002.b/D-024.
- Alternatives considered:
  - Leave `lowData` optional and let the engine choose — rejected, it removes a useful validation signal and contradicts the T-002.b acceptance criterion ("`Reason.lowData` exists").
  - Accept any version number and let exporters pick — rejected, causes the exact drift the review found (tests using 1 and 2 with no loader agreement).
  - Keep `min(0)` and add a separate zero-check refinement — rejected in favor of the simpler `gt(0)`, which communicates intent at the value level.
- Consequences: four test cases updated (zero-valued role map made sparse, duplicate pool id, manifest version pinning, zero-rejection negative test); `MANIFEST_SCHEMA_VERSION` re-exported from the package barrel. No engine or ETL code consumed these schemas yet (T-020/T-019 are not started), so no downstream breakage.

### D-030 — T-023 scoring assumptions — ACCEPTED

- Context: SPECS §5 leaves several T-023 parameters and behaviors open. Golden rule 9 requires each assumption to be recorded.
- Decision:
  1. **Blind pick share.** No pick-rate export exists yet, so `blindSafety` approximates `pickShare(e)` with normalized `roleProb[e][role]` over the remaining champions with share `>= blindOpponentMinShare` (default 0.05, separate from `roleProbThreshold`) (B-026).
  2. **Blind trigger (owner-requested change to SPECS §5, previously "fewer than 2 lane enemies known").** Blind safety applies when `blindPick` is true or any role of `laneGroup(myRole).enemies` is unknown. It scores only the unseen roles, so a known enemy is never counted twice; with `blindPick` true and the lane fully known it contributes nothing. Missing or lowData matchups count as neutral (term 0) with their full share.
  3. **Weights (priors, T-027.a tunes them).** `wComp = 1.0`, `wBlind = 1.0`, `blindWorstCaseFactor = 0.5` (worst-case term, taken per unseen role), and comp weights from `DEFAULT_COMP_CONFIG`.
  4. **Hard-counter warning.** Shown when the `counter` reason `deltaPp` of a known, non-lowData enemy pair is `<= hardCounterDeltaPp` (-4.5, the L3-negative boundary), compared on the deltaPp rounded to `DELTA_PP_DECIMALS` (the displayed value).
  5. **Unsampled levels.** Comp and blind reasons have `n = 0` and are never lowData. Their level comes from `deltaPp` alone, with positive levels capped at L1 and negative levels unrestricted. lowData reasons get level 0.
  6. **`conf_lane`.** `lane_vs` is scaled by the product of the lane-group enemy confidences only (the ally partner is not part of that context). `lane_full` uses the product over allies and enemies.
  7. **`compNeed` ignores enemies until T-025.** Only tagged board allies count as evidence, including allies whose role could not be inferred.
  8. **Ambiguous fixed roles.** When role inference fails and two or more slots on a team are fixed to the same role, those slots are dropped from role-dependent layers (pairs and lane), so they cannot form a fake complete lane.
  9. **Unknown raw counts.** `insufficientData.rawGames` and the 6th baseline column are optional; a missing or 0 count is omitted rather than reported (golden rule 8; B-025).
  10. **Warnings are codes.** `counteredBy:<ROLE>:<championId>` and `offRole`; UI text lives in the web `strings` module. Comp needs are exposed only as `filled` category codes.
  11. **Hard-counter delta = reason delta.** The warning uses the `deltaPp` of the layer-1 `counter` reason (running log-odds), so warning and reason never disagree.
  12. **Ranking ties.** Scores are compared exactly; only exactly equal scores tie, broken by championId ascending.
  13. **`reliability.nEff`.** Renamed from `reliability.games`: it is the baseline n_eff, never a raw game count (golden rule 8).
  14. **Injectable config.** All recommendation weights/thresholds/lane groups live in `RecommendConfig` (`DEFAULT_RECOMMEND_CONFIG`, `packages/engine/src/config.ts`), passed as the 4th argument of `recommend` (fixes B-027). `RecommendData` lives in `@draftorb/shared`.
  15. **Versioned contracts.** `DraftResult.schemaVersion` (`DRAFT_RESULT_SCHEMA_VERSION`, starts at 1) is required and bumped on every breaking output change (items 9, 13, `picked`, level 0 are v1). `MANIFEST_SCHEMA_VERSION` is bumped to 2 for the 6th baseline column; loaders reject other versions. Unknown values are omitted, never `null` or `0`.
- Alternatives: block T-023 until pick-rate data and the backtest exist. Rejected: it would stall E2.
- Consequences: these values live in `DEFAULT_RECOMMEND_CONFIG` (`packages/engine/src/config.ts`) and are injectable. Any change to the defaults requires the D-023 backtest.

Accepted by the owner on 2026-10-31. SPECS §5/§7 text derived from this decision is normative.

### D-031 — `role_prob` counts a single patch, no recency decay — SUPERSEDED by D-035

- Context: SPECS §3 applies recency decay `decay^(currentPatchIndex - gamePatchIndex)` at aggregation time and D-017 keeps older patches for that purpose. §3 names draft probabilities (pairs, matchups, baselines) but not `role_prob`, and DATA_MODEL.md says aggregated tables are "recomputed per patch". T-015 had to choose between single-patch counts and decay-weighted counts across patches.
- Assumption (T-015): `aggregateRoleProb` counts only participants of one target patch (default: highest stored patch, numeric major.minor compare as in D-017). `role_prob` has no `patch` column and holds one patch at a time. A target patch with no participants leaves the table unchanged; a malformed patch is a usage error.
- Alternatives: decay-weighted counts across the D-017 window (more data early in a patch, but role shifts from a patch change linger; `games` would become weighted and would need `games_w2`). Rejected for now pending owner review.
- Consequences: early in a new patch `role_prob` may rest on few games; consumers should check `games` before trusting a probability (golden rule 8). Switching to decay later only changes `packages/etl/src/aggregate.ts` and its tests.

### D-032 — `@draftorb/engine` workspace dependency for ETL baseline aggregation — ACCEPTED

- Context: T-016 must weight baseline games with the engine rank kernel (SPECS §3) so that aggregation-time weights match query-time logic.
- Decision: `@draftorb/etl` depends on `@draftorb/engine` (`workspace:*`, internal, no new third-party code or license) and imports `combinedGameWeight`, `bucketIndex`, `RANK_BUCKET_ORDER` and `DEFAULT_CONFIG`. `packages/etl/tsconfig.json` references `../engine`.
- Alternatives: duplicate the kernel in ETL (rejected: the two copies could drift apart); move the kernel to `@draftorb/shared` (deferred: a larger refactor outside T-016).
- Consequences: ETL builds after engine. Engine must not import from ETL, which would create a cycle. Changes to the kernel change aggregated baselines, so the ETL must be re-run.

Owner decision 2026-10-31.

### D-033 — Recency `patchIndex` and game rank bucket in ETL aggregation — SUPERSEDED by D-043 (T-019.b)

- Context: SPECS §3 defines recency as `decay ^ (currentPatchIndex - patchIndex)` but does not define `patchIndex`. It also does not say how a match's `avg_rank_score` maps to a rank bucket. T-016 needs both.
- Question: should a patch gap (no stored games on some patches) count as one decay step or as the real number of patches released in between?
- Decision: `patchIndex` is dense over the distinct stored patches (sorted numerically with `comparePatches`), up to and including the snapshot patch. The game bucket is `clamp(floor(avg_rank_score), 0, 7)`, i.e. the `RANK_BUCKET_ORDER` index. The snapshot patch is promoted to `currentPatchIndex` even when not yet stored, so recency is measured from it.
- Alternatives: index by real release order (needs a patch list, e.g. from Data Dragon versions); use the distance in minor versions (breaks across major versions).
- Consequences: with gaps in the collected data, older patches decay less than real time would suggest. T-017 pair aggregation must use the same indexing so baselines and pairs stay consistent.

Owner decision 2026-10-31.

### D-034 — Champion roles derived from role-prob data, `champions.json.roles` kept — ACCEPTED

- Context: `TICKETS.md` T-015.b says "replace the Data Dragon champion-tag bootstrap roles with roles derived from `role-prob.json`; remove `champions.json.roles`." However `championSchema.roles` is required (SPECS/shared), `champions.json` is documented as `id, name, icon, roles` in `DATA_MODEL.md`, and the tag-coverage validation (`packages/etl/src/tags.ts`) reads `champion.roles`. `role-prob.json` itself is not produced until T-019, so T-015.b can only derive roles from the SQLite `role_prob` table produced by T-015.
- Assumption (T-015.b): keep `champions.json.roles` as a required field, but replace its source where observed data exists: roles are derived from `role_prob` (roles with observed probability, canonical order), falling back to the Data Dragon tag bootstrap for champions without role-prob data. Add a pure, tested `deriveChampionRoles` function and a `derive-roles` ETL command that rewrites `champions.json.roles` from `role_prob`. The Data Dragon tag mapping stays as the fallback and remains covered by its existing tests.
- Alternatives: remove `roles` from `champions.json` and the shared schema. Rejected: breaks the shared contract, DATA_MODEL.md, and tag coverage; `role-prob.json` is a separate file that does not yet exist.
- Consequences: `transformChampions` gains an optional `roleProbabilities` parameter (tag fallback when absent, backward compatible). `champions.json.roles` now reflects observed probabilities once `pnpm etl derive-roles` runs after `pnpm etl aggregate`. Only roles with probability >= `roleProbThreshold` (default 0.05) are kept, and a champion always keeps at least its highest-probability role (B-046).

Owner decision 2026-11-04.

### D-035 — Decay-weighted `role_prob` evidence, superseding D-031 single-patch assumption — ACCEPTED

- Status note (2026-11-04): implemented in T-015.c; accepted by the owner 2026-11-04.

- Context: D-031 (PROPOSED) made `aggregateRoleProb` count one target patch only, with `role_prob` having no `games_w`/`games_w2` columns and no recency decay. SPECS §3 applies recency decay at aggregation time and never drops older patches. The single-patch implementation wipes `role_prob` on every aggregate: after one newer-patch match is ingested, the next `pnpm etl aggregate` rebuilds the table from ~10 participants, dropping champions absent from that patch. The `role-prob.json` export carries no `games` signal, so D-031's mitigation ("consumers should check games") cannot work. Baselines (T-016/D-033) already use cross-patch decay with a dense patch index — the two tables followed different rules.
- Decision: `aggregateRoleProb` stores decay-weighted evidence like the other aggregate tables: `games` (raw count), `games_w` (sum of recency weights), `games_w2` (sum of squared weights). Weight = `recencyFactor(patchIndex, currentPatchIndex, decay) * reliabilityFactor(rankKnownCount, unknownRankFactor)`, using the same dense patch index and snapshot-patch rules as D-033. `prob = games_w(champion, role) / sum_roles games_w(champion, role)`, preserving the sum-to-1 invariant. `role-prob.json` stays a bare sparse map of probabilities (no `p`, `games` wrapper), so D-027, D-029, the shared schema, parity tests, and engine consumers do NOT change. Migration 009 adds `games_w` and `games_w2` to `role_prob`. The exporter (T-019) drops champions below `exportMinGames`; aggregate.ts itself does not filter.
- Alternatives considered:
  - Keep D-031 single-patch counts. Rejected: wipes champions absent from the latest patch; contradicts SPECS §3 recency; no sample-size signal survives export.
  - Per-champion "keep old row" guard. Rejected: leaves rows of unknown age and a third behavior beside D-033; does not match the decay-weighted model of other aggregate tables.
  - Change export to `{ [championId]: { role: { p, games } } }`. Rejected: breaks D-027/D-029 sparse-map contract, shared schema, parity tests, engine `roleProb` consumers, and would require a manifest schemaVersion bump plus engine consumer work outside this ticket.
- Gate: `exportMinGames` (default 10, raw `games` floor) is used by the exporter (T-019), not by `aggregate.ts`. `n_eff` is computable from `games_w`/`games_w2` but is not used as a storage filter because `role_prob` is single-role-pair evidence (no user-bucket weighting); using `n_eff` here would mix concepts that belong to per-bucket tables like `baseline`. A raw-game floor is the simplest gate the exporter can apply before writing the bare sparse map.
- Consequences: `aggregate.ts` signature changes from `(db, patch?)` to `(db, { patch?, config? })`; callers updated. Migration 009 applied before first real collection run. T-015.c tracks this work, sequenced with T-015.b and before T-019.

Owner decision 2026-11-04.

### D-036 — Rune aggregation scope decisions (T-018 follow-ups) — ACCEPTED

- Update (T-018 review, 2026-11-01): both gaps are now implemented in T-018. Mastery fallback: a participant is an expert when in-window `champion_games >= minChampGames` OR cached `mastery_points >= minMasteryPoints` (enrichment only fetches mastery for the recommended role, so the fallback is role-limited). Rank weighting: migration 011 rebuilds `rune_ctx` with a `rank_bucket` column; each game contributes to every user bucket with `expertWeight(gameBucket, userBucket, alpha, wMax)` (0 below the user bucket). The text below is kept for history.

- Context: T-018 implemented basic rune aggregation per SPECS §8.1 and D-022 but deferred two features described in D-022: (1) mastery fallback for participants of the user's role, and (2) rank-based expert weighting. The handoff notes these as intentional gaps.
- Assumption (T-018): these features are intentionally deferred to a follow-up ticket after the baseline rune export (T-019) is complete. Mastery fallback requires a config option `minMasteryPoints` and user-role input to identify which participants are of the recommended role (mastery is fetched per (puuid, champion) and cached in `participants.mastery_points`). Rank-based expert weighting requires a migration to add a `rank_bucket` column to `rune_ctx` (matching the per-bucket tables like `baseline`) and a decision on whether to store separate rows per bucket or weight by bucket at aggregation time.
- Alternatives:
  - Implement both features in T-018. Rejected: would expand scope beyond the baseline aggregation and defer the export.
  - Drop mastery fallback entirely and rely only on `champion_games`. Rejected: D-022 specifies the fallback for participants of the user's role.
  - Drop rank-based weighting entirely and treat all experts equally. Rejected: D-022 says "rank-based expertWeight" is a future addition.
- Consequences: T-018 stores a single expert-weighted `rune_ctx` table with no rank bucket column. Follow-up work will require a migration if rank buckets are added. Mastery points are already stored in `participants` from T-014 but are not used in T-018.

_Note: D-037..D-042 were never assigned; numbering resumes at D-043._

### D-043 — Patch index from Data Dragon versions.json — ACCEPTED

- Context: SPECS §12 requires a `patches(patch_index, version_label, released_at)` table. `matches.patch` is TEXT `major.minor` (RIOT_API.md). Data Dragon `versions.json` lists versions newest-first; hotfixes share a `major.minor` label.
- Decision:
  - Table `patches(patch_index INTEGER PRIMARY KEY, version_label TEXT NOT NULL UNIQUE, released_at INTEGER)`.
  - `version_label` = `major.minor`, identical to `matches.patch`.
  - `patch_index` assigned once, oldest-first starting at 1, append-only, never reassigned or renumbered.
  - Ordering source: Data Dragon `versions.json`, reversed (newest-first -> oldest-first ordinal).
  - Hotfixes: all source versions sharing the same `major.minor` label collapse to one `patch_index`; one patch = one `patch_index`; the grouping rule is defined here, once.
  - One parse is allowed and defined once: `gameVersion` -> `major.minor` label. Version strings are never compared numerically for age, windows, or breakpoints; age/window/breakpoint logic uses `patch_index` only.
  - A match whose label is absent from `patches`: refresh `patches` from the source first; if still absent, a typed error / `invalid` reject (never a silent skip), distinct from `patch` and `pruned`.
- Alternatives:
  - Numeric version comparison for age — rejected: the source ordinal is the source of truth; parse-once maps to `patch_index`, then only ordinals are used.
  - Dense-over-stored-patches index (D-033) — rejected: gaps in collected data distort recency.
- Consequences: D-033's dense-over-stored-patches index and the numeric-compare part of D-017 are superseded by T-019.b (not before). Aggregate tables are rebuilt each run, so switching is a code change plus re-run, not a data migration. With gaps in collected data, recency follows real patch distance, not stored-patch distance.
- Implementation note (2026-11-04): `versions.json` also lists legacy entries that are not `major.minor.patch` (e.g. `lolpatch_7.20`, `lolpatch_3.7`); T-019.b ignores them when building `patches`.

Owner decision 2026-11-04.

### D-044 — Retention and prune — ACCEPTED

- Context: SPECS §13 requires bounded retention. D-017 leaves "pruning old patches" as a separate concern. `matches`/`participants`/`item_events` have ON DELETE CASCADE.
- Decision:
  - No parallel stats tables. Existing aggregate tables (`baseline`, `pair_ally`, `pair_enemy`, `lane_vs`, `lane_full`, `rune_ctx`, `item_build`, `role_prob`) are the only statistics store; recomputed on every `aggregate` run with weights baked in (SPECS §14, D-045).
  - Raw `matches`/`participants`/`item_events` kept for the last N patches only (`retentionPatches`, default 20, ETL config). The retention window must contain the frozen holdout plus the training window (D-023/T-027.a). With `decay = 0.85`, data 20 patches back weighs 0.85^20 ≈ 0.04, so the default prune drops under 5% of the recency weight mass.
  - `pnpm etl prune [--keep-patches N] [--dry-run]` (`N` defaults to `retentionPatches`): in ONE transaction, for matches with `patch_index <= latest - N`, write a `match_rejects` tombstone with reason `pruned` (actual `patch`, `checked_at`) and delete the match (cascade removes `participants`/`item_events`). Idempotent. `--dry-run` prints counts only. Manual use: after a major game rework (e.g. a season start or an item-system overhaul) the owner may run it once with a smaller `N` to delete older data for good; the tombstones keep that data from being re-ingested even though the default ingestion window is wider. A global `reset` breakpoint (D-047) is the reversible alternative: it zeroes the old data at aggregation without deleting it.
  - `match_rejects.reason` list becomes `queue|short|patch|invalid|pruned`. This extends D-017's list; do not edit D-017. `patch` keeps its D-017 meaning (re-evaluated when a run's window includes it). `pruned` is permanent: `findRejection` never deletes or re-evaluates it, whatever `--since-patch` says.
  - `--reset` (D-018) clears `queue|short|patch|invalid` rejects and keeps `pruned`. Only the explicit flag `--reset-tombstones` clears `pruned`; its help text warns that pruned matches become fetchable again.
  - Default ingestion window: `patch_index >= latest - retentionPatches + 1`, so ingestion never re-adds data the next prune would delete. An explicit `--since-patch` below this bound is a usage error unless `--reset-tombstones` is also given.
  - If `match_rejects.reason` has a CHECK or enum in the real migrations, T-019.c adds a migration (next free number) allowing `pruned`. If not, none.
  - Aggregate tables are rebuilt each run: no purge, no soft delete, no grace period. `reset` breakpoints give weight 0 at aggregation; they do not delete data. Retention and weighting are independent.
  - Invariant: rows are never deleted to express a weight; they are deleted only for retention (outside the window).
- Size estimate (assumptions stated): assume `M` matches per patch (unknown; parameterize), ~20 stored rows per match (1 match + 10 participants + ~8 item events + 1 tombstone), ~150 bytes per row. Retained rows ≈ N × M × 20 × 150 bytes. For N=20, M=1000: ≈ 6 MB. Tombstones ≈ N × M × 1 row × ~60 bytes ≈ 1.2 MB. Aggregate tables bounded by key cardinality × 8 rank buckets × N patches, not by match count.
- Alternatives:
  - Keep full history — rejected: unbounded growth.
  - Soft-delete + grace period — rejected: complexity without benefit since aggregates are rebuilt.
  - Parallel stats tables (`champion_stats`, `matchup_stats`, `item_stats`, `build_stats`) — rejected: no producer/consumer, cannot represent engine consumption (F2/F3).
- Consequences: prune must run before backtest evaluation; the holdout patch must be inside the window. Pruned matches cannot return through any ingestion or reset path except `--reset-tombstones`.
- Review note (2026-11-04): the first draft defaulted to 8 patches, which pruned ≈ 27% of the recency weight mass (0.85^8 ≈ 0.27) to save a few MB of easily kept data; the owner raised it to 20.

Owner decision 2026-11-04: keep 20 patches by default, with manual pruning still possible after a major game rework.

### D-045 — Weight formula — ACCEPTED

- Context: SPECS §14 needs one weight formula combining rank kernel, reliability, recency, and change weight. Two decays (0.85 in section 3, 0.7 in the PR) conflict; keep one: `decay = 0.85`.
- Decision:
  - Single formula (SPECS §14), stated once: `w = rankKernel × reliability × recency × changeWeight`.
    - `rankKernel(gameBucket, userBucket)`, `reliability(rank_known_count, unknownRankFactor)`, `recency(decay, currentPatchIndex - patchIndex)` exist (SPECS §3, `combinedGameWeight`, D-032, D-033).
    - `decay = 0.85` (SPECS §3). There is no separate decay constant distinct from `decay`.
    - `changeWeight(entities, patchIndex, asOf)`: across time = product of change weights at patches q with `p < q <= asOf`; across entities of the row's entity set INCLUDING the global entity = min; floor `minWeight` (default 0.05, ETL config) except `reset` = 0 (no floor); only events with `patch_index > p` AND `patch_index <= asOf` apply; `asOf` = snapshot's `currentPatchIndex` (backtest: patch before holdout).
  - Entity set per aggregate table: baseline {champion}; pair_ally {champion, ally champion}; pair_enemy {champion, enemy champion}; lane_vs {champion, opp1, opp2}; lane_full {champion, partner, opp1, opp2}; rune_ctx {champion} plus every rune id of the row's page (keystone, primary style, sub style, selected perks from `perks_json`; stat shards excluded); item_build {champion, item}; role_prob {champion}. The global entity is added to every set. For `rune_ctx` the weight is computed per game from that participant's own page.
  - Weights baked into `wins_w`, `games_w`, `games_w2`; `n_eff`, thresholds, exports, engine unchanged.
  - Purity: engine `changeWeight` is pure, receives plain data (events, breakpoints); SQLite reads stay in ETL.
  - Safety: change weighting disabled by default (`changeWeightEnabled` = false, ETL config; neutral weights 1.0). Enabled only after T-027.a passes the D-023 gate. With flag on and no events/breakpoints, aggregates byte-identical to current output (regression test).
  - Every new parameter (`minWeight`, band edges/weights, default `weight_factor`) is a prior; changes only through the D-023 gate.
- Alternatives:
  - A second decay constant distinct from `decay=0.85` — rejected: two decays on same rows.
  - Read-time weights in the web app — rejected: D-002 precomputes JSON; only aggregation/export time is coherent.
- Consequences: config names camelCase (`changeWeightEnabled`, `minWeight`, `retentionPatches`) in ETL config; engine parameters stay in `engine/config.ts`.

Owner decision 2026-11-04.

### D-046 — Automatic change score from CommunityDragon game data — ACCEPTED

- Context: SPECS §15 needs deterministic change scoring per patch without full snapshots, so that data from before a balance change can be downweighted (D-045). The first draft read Data Dragon, but Data Dragon champion files do not carry ability values: on 16.22.1 `champion/Ahri.json`, Q `effect` holds only `null`/zero arrays, `vars` is empty and the tooltip uses placeholders (`{{ totaldamage }}`); only `cooldown`, `cost`, `range` and base `stats` are real. Ability damage and ratio changes, the most common balance changes, would be invisible, while tooltip rewording would be visible. CommunityDragon publishes the game's own data files per patch. Checked on 16.21: `game/data/characters/ahri/ahri.bin.json` (≈ 64 KB) has `Characters/Ahri/Spells/AhriQAbility/AhriQ` with `mSpell.DataValues` `BaseDamage = [10, 35, 60, 85, 110, 135, 160]`, `mSpellCalculations.TotalDamage` with an AP `mCoefficient` of 0.5, `cooldownTime` and `mana`, and `Characters/Ahri/CharacterRecords/Root` with base and per-level stats. `game/items.cdtb.bin.json` (≈ 16 MB) has `Items/<id>` records with `price`, `recipeItemLinks` and `mFlat*`/`mPercent*` stat mods. Patch folders exist back to `10.1`.
- Decision:
  - Source: CommunityDragon `https://raw.communitydragon.org/<major.minor>/` (same label as `matches.patch`), fetched with `fetch`, no new dependency, no key. Free game data, not a third-party stats site (golden rule 1). Data Dragon stays the source of the published catalogs (`champions.json`, `items.json`, `runes.json`, T-003) and of the Summoner's Rift item filter (`item.json` `maps["11"]`); CommunityDragon is used only by `pnpm etl changes`.
  - Files: champions — `plugins/rcp-be-lol-game-data/global/default/v1/champion-summary.json` (numeric id -> alias; ids < 0 skipped), then `game/data/characters/<alias>/<alias>.bin.json` (alias lowercased); items — `game/items.cdtb.bin.json`; runes — `game/perks.cdtb.bin.json` (`mScript.mSpellScriptData.mEffectAmount`/`mCalculations`; the plugin `perks.json` only has tooltips with `@placeholders@`).
  - Command `pnpm etl changes <patch>` writes `entity_change_scores(entity_type, entity_id, patch_index, content_hash, change_score, details)`; `entity_type` IN (`champion`,`item`,`rune`); `entity_id` = numeric champion/item/perk id; unique key `(entity_type, entity_id, patch_index)`; re-run overwrites. `change_score` REAL in [0,1] or NULL, rounded to 4 decimals. `content_hash` + `details` only (no snapshots); the previous patch's files are re-downloaded when needed.
  - Algorithm (TypeScript terms):
    1. Allowlist extraction (configurable, normative list in SPECS §15): only balance fields are read; everything else in the game files (skins, VFX, animation, icons, client/tooltip data, unresolved `{hash}` names) is ignored. Champion: numeric base and per-level stats of the character record; for every spell of the record's ability list, `DataValues` (keyed by `name`, not by position), `mSpellCalculations` formula parts (referenced data value names and `mCoefficient`s), `cooldownTime`, `mana`, `castRange`. Item: `price`, `recipeItemLinks`, numeric `mFlat*`/`mPercent*` mods and item `DataValues`. Rune: numeric values once located.
    2. Flatten into `Map<string, Leaf>` (path -> leaf), leaf `number | number[]`. Numbers rounded to 6 decimals first (the files store float32 values such as `0.30000001192092896`).
    3. `content_hash` = sha256 of canonical JSON (sorted keys) of the map (`node:crypto`). Equal -> `change_score = 0`.
    4. Otherwise sum contributions:
       - number: `min(1, abs(new-old) / max(abs(old), 1e-6)) * 0.5`, per-leaf cap 0.5.
       - number[] same length: `mean(relative change per index) * 0.5` (one contribution per array). Different length: 0.3.
       - structural: a spell added, removed or replaced in the ability list -> 0.6 each; a data value or calculation added or removed -> 0.3 each; item recipe changed -> 0.3; stat mod added or removed -> 0.3.
    5. `change_score = min(1, sum)`, rounded to 4 decimals.
  - Text is never compared, so tooltip rewording cannot change a score.
  - Properties (tested): rewording or reordering never changes the score (allowlist + canonical JSON + name keys); magnitude matters beyond the per-leaf cap; monotone in change size for fixed keys.
  - Bands (half-open): [0, 0.1) x1.0; [0.1, 0.3) x0.9; [0.3, 0.6) x0.5; [0.6, 1] creates `suggested` breakpoint (source `auto`, mode `downweight`, `weight_factor` 0.2). While a suggestion is pending or after rejection: effective weight = [0.3, 0.6) band weight (x0.5), never 1.0 (F18).
  - Fallback: missing/unreadable/incomplete source, or no previous patch with data -> `change_score = NULL`, weight 1.0, warning logged (first patch: NULL, no warning). Stated once in SPECS §15; all other sections reference it. Never invent a score, never block the pipeline.
  - Fixtures (arithmetic shown in SPECS §15): cooldown scalar 10->9 = 0.05 ([0,0.1) x1.0); armor 30->36 (0.1) + cooldown 10->9 (0.05) = 0.15 ([0.1,0.3) x0.9); damage array [10,9,8,7,6]->[9,8,7,6,5] ≈ 0.065 ([0,0.1) x1.0); AP ratio 0.5->0.55 = 0.05; ability replaced = 0.6 ([0.6,1] suggested); identical = 0; skin/VFX-only change = 0; ARAM-only item = 0.
  - Verification update (2026-11-04, prototype on 16.20 -> 16.21 and 16.21 -> 16.22; results in SPECS §15 and PROGRESS.md). The algorithm above is refined as follows (normative text in SPECS §15): champions limited to the Data Dragon catalog (drops `Jade_*` game-mode variants) and items to `maps["11"]`; all entry paths and field names compared in FNV-1a hashed form (CommunityDragon resolves hashed names over time); `DataValues`/`mDataValues` keyed by name (position keys created false changes when values were inserted); a change repeated inside one entity counts once; the 0.6 structural weight applies to root spells only (child missiles were false positives); perk per-mode overrides ignored; a score for the still-live patch is provisional because folders change during the patch (hotfixes) and are final once the next patch is out. Remaining false-positive class: internal data refactors with the same in-game effect, handled by rejecting the suggested breakpoint.
  - Sequencing: manual breakpoints (T-019.e) ship before automatic scores (T-019.d). T-019.d starts with a verification step on two real consecutive patches: every champion and item change listed in the official patch notes must get a non-zero score, unchanged entities must score 0, and the list of misses and false positives is recorded in PROGRESS.md before the allowlist is frozen. Whether change weighting is turned on at all is decided by the backtest (D-023, T-027.a); it stays off (`changeWeightEnabled = false`) otherwise.
- Alternatives:
  - Data Dragon as the source — rejected: no ability values, so most champion changes are invisible.
  - Ignore-list over whole files — rejected: game files are dominated by skin/VFX entries (65 entries in Ahri's file), so almost every patch would look changed.
  - Parsing official patch notes — rejected: brittle HTML, and runtime LLMs are excluded (D-006).
  - Detecting changes only from shifts in our own win rates — rejected for now: too noisy at Phase 1 volumes; may become a second signal later, through the D-023 gate.
  - Python `difflib.SequenceMatcher` / text similarity — rejected: text is no longer compared.
  - Full JSON snapshots — rejected: unbounded (D-006).
  - Pending suggestion = weight 1.0 — rejected: biggest changes get least protection.
- Consequences: no new dependency (`fetch`, `node:crypto` are built-in). A new external host (community-run, not Riot): its format can change and some names are hashed; the fallback covers outages and unreadable files. About 11 MB of champion files plus 16 MB of item data downloaded per patch compared; only hashes and details are stored.

Owner decision 2026-11-04 (after the Data Dragon review above: CommunityDragon source, allowlist, manual breakpoints first).

### D-047 — Breakpoints — ACCEPTED

- Context: SPECS §16 needs manual/validated override of automatic change weights. The PR's table lacks uniqueness, CHECK constraints, and a lifecycle.
- Decision:
  - Table `data_breakpoints(id INTEGER PRIMARY KEY, scope_type TEXT NOT NULL, scope_id INTEGER, from_patch_index INTEGER NOT NULL, mode TEXT NOT NULL, weight_factor REAL, status TEXT NOT NULL, source TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL)` with CHECKs: `scope_type IN ('champion','item','rune','global')`; `scope_id IS NULL` iff `scope_type='global'`; `mode IN ('reset','downweight')`; `weight_factor IS NULL` for `reset` and `0 < weight_factor <= 1` for `downweight`; `status IN ('suggested','active','rejected')`; `source IN ('auto','manual')`; `reason NOT NULL` with `length(reason) > 0`; `from_patch_index >= 1`.
  - Unique expression index `idx_data_breakpoints_unique` on `(scope_type, COALESCE(scope_id, -1), from_patch_index, source)`. Re-running detection cannot duplicate rows.
  - Affected data: `patch_index < from_patch_index`. An active breakpoint replaces the automatic change weight for that entity/patch with its `weight_factor`; still multiplies with change weights of other patches. Several active breakpoints on same entity/patch: `reset` dominates (0); otherwise `weight_factor`s multiply, floored at `minWeight`. One rule, same whether or not they share `from_patch_index`. A breakpoint applies at aggregation to any retained data with `patch_index < from_patch_index`; if none remains it has no effect (F39).
  - Scope table (which aggregate tables each scope affects):
    - champion: `baseline`, `pair_ally`, `pair_enemy`, `lane_vs`, `lane_full`, `rune_ctx`, `role_prob` (rows keyed by champion)
    - item: `item_build` only. Champion-wide win-rate shifts from item reworks are handled by `champion` or `global` breakpoints (documented limitation; cascade is a rejected alternative).
    - rune: `rune_ctx`
    - global: all aggregate tables
  - Lifecycle: `suggested -> active` (validate) or `rejected`. CLI `pnpm etl breakpoint list|add|validate|reject`. `pnpm etl status` shows "review needed" count for suggested breakpoints. Web badge out of scope. Manual `add` creates `active` row with `source='manual'` and mandatory `reason`.
  - Hotfix limitation: hotfixes merged into the same `patch_index` never downweight same-patch data (known limitation; change events apply to `patch_index <` the change patch).
  - Breakpoint on pruned patch: see the affected-data rule above (`patch_index < from_patch_index`; no retained data = no effect).
- Alternatives:
  - item breakpoint cascades to champion tables — rejected: champion/global breakpoints are the tool.
  - `weight_factor = 0` as reset — rejected: reset is its own mode; require 0 < weight_factor <= 1.
- Consequences: `status` enum has no `validated` (use `active`); `weight_factor` NOT NULL required only for downweight.
- Note (2026-11-04): manual breakpoints do not depend on D-046 and ship first (T-019.e before T-019.d). Rows with `source = 'auto'` appear once T-019.d lands.

Owner decision 2026-11-04.

### D-048 — No separate Bayesian smoothing — ACCEPTED

- Context: SPECS §17 proposed smoothing `smoothed_winrate = (weighted_wins + K × p0) / (effective_games + K)` with data-driven `p0`.
- Decision: NOT adopted.
  - D-021 layered shrinkage on equivalent counts already provides Bayesian-style smoothing (`k` in raw-game units).
  - `p0` = weighted role average equals 0.5 under complete-role matches (one participant per role per team), so it adds nothing over §5's fixed 0.5 prior.
  - `K = 20` semantics conflict with D-021's equivalent-count conversion.
  - For items, `p0` is undefined (no role).
- Alternatives:
  - Adopt as is — rejected: redundant with D-021; `p0` = 0.5 adds nothing.
  - Adopt with equivalent-count conversion — rejected: still redundant; D-021 shrinkage is the single smoothing mechanism.
- Consequences: no `K`, `p0`, or smoothing table. Edge cases in §17 reference §5/D-021 for confidence.

Owner decision 2026-11-04.

### D-049 — Preserve rank buckets in rune exports — ACCEPTED

- Status note (2026-11-04): implemented in the rune-export rank-bucket work (migration 011 `rune_ctx.rank_bucket`, B-038 fix); accepted by the owner 2026-11-04.

- Context: `rune_ctx` stores rank-specific aggregates because expert weighting depends on the user's rank bucket. The export grouped pages only by context key and level, which merged these distinct statistics.
- Decision: include `rankBucket` on every exported rune context, group by it, and bump `MANIFEST_SCHEMA_VERSION` to 3.
- Alternatives:
  - Keep the existing payload and merge buckets — rejected: consumers cannot distinguish rank-specific data, and exported rates combine different populations.
  - Export separate files per bucket — rejected: adds path complexity without changing the rune-context contract.
- Consequences: consumers must accept schema version 3 and read `rankBucket` on rune contexts.

Owner decision 2026-11-04.

### D-050 — Reserve the user's role during ally role inference — ACCEPTED

- Status note (2026-11-04): implemented in B-043; accepted by the owner 2026-11-04.

- Context: B-043. Ally role inference ran with all 5 roles available, so an unfixed ally could be assigned `userRole` even though the user occupies it (e.g. an unfixed Senna ally inferred as SUPPORT while the user plays support). The ally then produced no ally-pair synergy for the role it actually plays.
- Decision:
  - `inferRoles` takes `excludedRoles` (default `[]`, keeping existing behavior): the exact solver skips any assignment that puts an excluded role on an unfixed slot, and a fixed slot holding an excluded role makes the call return `null`.
  - `resolveViableSubset` forwards `excludedRoles` to its `inferRoles` calls.
  - `resolveKnownSlots` takes `reservedRoles` (default `[]`): slots fixed to a reserved role are dropped first (they conflict with the user and lose only role-dependent effects — pairs and lane — like the D-030 ambiguous case; they still count for comp via `input.allies` and stay excluded from candidates via `buildCandidateSet`). Dedup, inference and the viable-subset fallback then run with `reservedRoles` as `excludedRoles`. An unfixed ally that can only play a reserved role fails inference and is dropped by the existing fallback.
  - `recommend` passes `[userRole]` for the allies call; the enemies call is unchanged.
- Alternatives:
  - Treat a conflicting fixed ally as authoritative and drop the user's role — rejected: `userRole` is the input that defines the request.
  - Keep the current behavior — rejected: the ally is scored against the wrong role and its real synergy is lost (e.g. an ADC Senna ally contributes no ADC synergy).
- Consequences: no output-shape change (`DRAFT_RESULT_SCHEMA_VERSION` unchanged). Enemy inference is untouched: every enemy role is legitimately possible.

Owner decision 2026-11-04. Rationale: the user can fix the role of any champion they know; their own role is always known, so `userRole` is authoritative and no ally may take it.

### D-051 — Latest-patch pointer for the web app — ACCEPTED

- Context: ARCHITECTURE.md says the web loads `data/public/manifest.json` (latest), but export only writes `data/public/<patch>/manifest.json`, so nothing tells the web which patch is current.
- Decision: export writes `data/public/latest.json` = `{ schemaVersion, patch, manifest: "<patch>/manifest.json", generatedAt }` as the last step after the patch directory is published; the web fetches it first, then the referenced manifest.
- Alternatives:
  - Copy the latest manifest to `data/public/manifest.json` — rejected: its `files` paths are relative to the patch dir, so a copy needs rewriting and can drift.
  - Hard-code the patch in the web build — rejected: needs a redeploy per patch.
- Consequences: one extra small fetch; old patch dirs stay addressable; T-029 implements it.

Owner decision 2026-11-04.

### D-052 — Pick-rate export semantics for `blindSafety` — PROPOSED

- Context: B-026. `blindSafety` needs `pickShare(e)` = the share of picks of champion `e` in an unseen enemy role, but no pick-rate export existed, so the engine approximated it with `roleProb[e][role]` (the share of `e`'s own games played in that role — a different quantity).
- Decision:
  1. **Source.** `pick-rate.json` is computed from the `role_prob` table's `games_w` per (champion, role): `share(e, role) = games_w(e, role) / sum_e games_w(e, role)`. Each (champion, role) cell is gated by `n_eff >= exportMinGames` like every other export, then shares are renormalized per role to sum 1 (round6, largest share absorbs the residual, same rule as B-049).
  2. **Scope.** Global like `role-prob.json`, independent of `manifest.roles`: `role_prob` has no rank-bucket or platform split, so pick shares are global across buckets and platforms (same aggregation scope as role probabilities).
  3. **Threshold.** `blindOpponentMinShare` now applies to the pick-share value. With real shares (a handful of picks above a few percent) the 0.05 default keeps only reasonably popular opponents; the value may need retuning once real data exists (T-027.a).
  4. **Fallback.** `RecommendData.pickRate` is optional: exports published before `pick-rate.json` existed keep the roleProb approximation until re-exported. The backtest's `RecommendData` always carries real pick rates.
- Alternatives:
  - Per-rank-bucket pick shares — rejected for now: `role_prob` carries no bucket dimension; would need a new aggregation.
  - Required `pickRate` field — rejected: already-published patch exports have no `pick-rate.json` and cannot be regenerated while the database is locked.
- Consequences: `pnpm etl export` writes `pick-rate.json` (manifest `files`, no schemaVersion bump — additive file, loader treats it as optional). Engine behavior is unchanged until an export containing the file is loaded.

### D-053 — Champion avatars from the Data Dragon CDN — ACCEPTED

- Context: the pool editor needed a browsable champion set with avatars, but `champions.json` stores only the icon file name (`Annie.png`) and no images are shipped with the export.
- Decision: resolve avatar URLs at runtime against the Data Dragon CDN (`https://ddragon.leagueoflegends.com/cdn/<version>/img/champion/<icon>`). The export patch is a `major.minor` label, so `apps/web/src/data/champion-icons.ts` maps it to the newest matching full version from `api/versions.json` (fetched once per session). Every failure path (CDN down, unknown patch, missing version) degrades to `null` and the grid renders a letter placeholder — avatars never block the app.
- Alternatives:
  - Bundle icons into `data/public/<patch>/` at export time — rejected by the owner: adds ETL work and per-patch image weight for no functional gain while the app already requires network access for its data.
  - CommunityDragon icons — rejected: Data Dragon is the documented static-data source (RIOT_API.md) and its `img/champion/` path is stable and key-free.
- Consequences: one extra small fetch (`versions.json`) per session; avatar availability depends on Riot's CDN, mitigated by the placeholder fallback. `square/` portraits return AccessDenied on this CDN, so the 128x128 `img/champion/` portrait is used.

Owner decision 2026-11-05 (avatar source chosen in session).

### D-054 — Insufficient-data pool champions render as list cards with baseline win rate — ACCEPTED

- Context: pool champions that fail the baseline gate were only summarized in a warning line ("Pool champions not recommended: ..."), so the user could not see them in the "From your pool" list or read a win rate when data exists. SPECS §7.1 already requires unscored pool champions to be listed after the ranked ones.
- Decision:
  1. `insufficientData` entries may carry `winRate`: the baseline `p0` fraction (SPECS §5) for the user's rank bucket, present only when the baseline row has weighted evidence (`games_e > 0`). Missing or empty baseline rows omit it rather than inventing a prior-only 50%.
  2. `DRAFT_RESULT_SCHEMA_VERSION` stays 1: the field is optional and additive.
  3. The web "From your pool" list renders `poolUnavailable` champions after ranked recommendations as cards with a "Not recommended" badge, the reason (insufficient data with `n_eff`/raw games, already picked, or not in the champion catalogue) and the win rate when present. The warning line is removed.
- Alternatives:
  - Show the raw (unshrunk) win rate — rejected: tiny samples can read 0%/100% and contradict the engine's `p0`.
  - Compute the win rate in the web layer — rejected: it would duplicate baseline indexing/weighting logic that belongs to the engine.
- Consequences: SPECS §7/§7.1 updated; UI strings stay centralized; ETL exports and the backtest are unaffected (engine output only).

Owner decision 2026-11-05.

### D-055 — Patch-index implementation details for T-019.b — ACCEPTED

- Context: D-043 fixes the `patches` table and the source ordinal, but leaves implementation choices open: where `patch_index` lives for stored matches, what `currentPatchIndex` is when no snapshot is given, when `patches` is refreshed, and how orphans and catalog drift are handled. The draft below was owner-reviewed; the revisions are part of this decision.
- Decision (implemented 2026-11-06):
  1. `matches.patch` stays a TEXT `major.minor` label; there is no `patch_index` column on `matches` or `match_rejects`. Aggregation and ingestion resolve labels through `patches` (prepared lookup / in-memory map). A `REFERENCES` FK was rejected: the real database can hold labels absent from `patches` until the first refresh, and rebuilding `matches` under `foreign_keys = ON` would cascade-delete `participants`. Instead a regression test asserts no orphan labels exist after ingestion, and read commands report orphans (below).
  2. `currentPatchIndex` = the snapshot's `patch_index` when `aggregate [patch]` is given (promoted even with no stored games at it, as before), else the highest `patch_index` among stored matches. The max in `patches` is NOT used. `loadPatchWindow` returns an empty window (`currentPatchIndex = -1`) when no stored label resolves within the bound.
  3. Ingestion resolves each match label through `createPatchResolver`: one `versions.json` fetch per run, on the first miss (shared with the empty-table retention refresh via `resolver.refresh()`). A failed refresh is a transient player failure, not an `invalid` reject.
  4. `aggregate`, `derive-roles` and `matches` fetch `versions.json` only on a miss — when the explicit snapshot label or a stored label needed for the run is absent from `patches` — at most once per run (`ensurePatchCoverage`). Offline runs work whenever every needed label already resolves.
  5. Graceful degradation on the read path: fetch fails but every needed label resolves -> proceed with a warning; fetch fails and the explicit snapshot label cannot be resolved -> fail with an error naming the label; fetch fails and only stored labels are missing -> proceed, exclude them, and log the excluded match count plus the distinct labels; fetch succeeds but Data Dragon still does not know the explicit label -> reject with a clear error.
  6. Orphan labels are rare and visible: `loadPatchWindow` returns `orphanLabels`/`orphanMatches`; the exclusion path never drops silently.
  7. Ordering is NUMERIC by (major, minor), never string order (`14.10` > `14.9`) and independent of `versions.json` position: `parsePatchLabels` dedupes hotfixes and sorts numerically; unparseable entries are skipped with a warning. `patch_index` is gap-free from 1 and stable: `refreshPatches` verifies the stored table is contiguous and numerically ordered and that every missing label sorts after the newest stored one, then appends — it refuses to renumber or misorder.
  8. `gameVersion` -> label uses the same `major.minor` format as the Data Dragon label (tested on representative strings).
  9. `backtest` copies `patches` into its in-memory database.
  10. `released_at` is removed (migration `014_patches_drop_released_at`): `versions.json` carries no release dates and nothing populated the column.
  11. Reproducibility: `aggregate` records `{ patch, patchIndex, currentPatchIndex, patchesMaxIndex, aggregatedAt }` in `ingest_state` (`aggregate:snapshot`); `export` publishes it as `patch-meta.json` (hashed in `manifest.files`, not schema-validated — the strict manifest schema is unchanged, so existing snapshots stay valid).
- Alternatives: a `patch_index` column on `matches`/`match_rejects` (denormalized, needs backfill and rewrite on catalog changes — rejected, the lookup is cheap and labels are already stored); `currentPatchIndex` = max `patch_index` in `patches` (penalizes all games by a constant when a brand-new patch has no games yet — rejected, the stored-max matches prior semantics); FK `matches.patch REFERENCES patches(version_label)` (rejected, see 1); keeping `released_at` NULL forever (rejected — a permanently empty column is worse than none).
- Consequences: read commands fetch only on a miss; recency follows real patch distance (gaps in collected data count); aggregates written before this change keep working (snapshot metadata is simply absent until the next `aggregate` + `export`).

### D-056 — `matches --refresh`: ingestion scoped to already-ingested players — PROPOSED

- Context: `matches` orders pending (no/partial cursor) players before done players (D-018) so repeated `--limit` batches walk the whole discovered population. Once `players` has discovered more players than were ingested, there is no way to run a cheap "refresh the set we already collected" pass: a plain run walks all pending players first, and `--limit` can never reach the done players.
- Decision: new boolean flag `--refresh` on `pnpm etl matches`. It restricts the player selection to puuids that already have an ingest cursor for the platform (any status, `partial` or `done`); ordering and `--limit` then apply within that subset. Done cursors keep the D-018 incremental listing (`startTime = lastGameCreation`), so a refresh costs ~1 match-list call per player plus any genuinely new games. `--refresh` combined with `--reset` is a usage error (reset clears the cursors the flag selects on).
- Alternatives: (a) reorder done players first globally — rejected, it would starve pending ingestion; (b) a `--tier`/`--players-file` filter — rejected as more machinery than needed for the weekly-refresh use case; (c) selecting by stored `matches` instead of cursors — rejected, the cursor is the resume mechanism and a stored match without a cursor cannot happen.
- Consequences: `pnpm etl matches euw1 --refresh` refreshes exactly the ingested set (e.g. the top-250 batch) without touching pending players; full-population ingestion remains the default no-flag behavior.

### D-057 — Scheduled ETL refresh in GitHub Actions with DB state on an orphan branch — PROPOSED

- Context: the owner obtained a Riot **personal key** (no expiry) and wants the pipeline to refresh the database every 12h, persist the ~265 MB SQLite between runs, and auto-publish `data/public` exports. Constraints: the DB is gitignored and >100 MB (GitHub's per-file limit) uncompressed; the deployed site serves only committed `data/public` JSON; ingestion must stay resumable and bounded under the 6h job limit.
- Decision:
  1. State lives on orphan branch `etl-db` as a single gzipped file `DraftOrb.sqlite.gz` (~58 MB, under the 100 MB limit). Each run fetches it, and at the end checkpoints WAL + VACUUMs, re-gzips and force-pushes an **amended single commit** so branch history stays ~58 MB.
  2. The job refuses to run when `etl-db` is missing (a fresh empty DB could otherwise overwrite good state); reseeding is a documented manual git procedure (SETUP.md).
  3. Cadence: cron every 12h (`37 */12 * * *`) + `workflow_dispatch`. Each run: `migrate` → `check-key` → `static` → `matches --refresh` → `matches --limit 100` (bounded pending ingest) → `prune` → `aggregate` → `derive-roles` → `export` → `status`.
  4. Compact/upload steps use `if: always()` so partial progress (cursors, stored matches) is saved even when a pipeline step fails; exports are committed to `main` only on success. `GITHUB_TOKEN` pushes do not trigger `push`-event workflows, so the job dispatches `deploy.yml` via `gh workflow run` (workflow_dispatch is the allowed exception) when exports changed; the workflow holds `contents: write` + `actions: write`.
  5. Secret: `RIOT_API_KEY` (personal key) in Actions secrets; `GITHUB_TOKEN` with `contents: write` covers clone/push of both branches.
- Alternatives: (a) `actions/cache` — rejected: cache entries can only be written from inside a workflow, so the existing local DB could never be seeded; eviction would force a multi-day rebuild. (b) GitHub artifacts — rejected: same seeding problem plus the ~500 MB free storage quota vs ~58-150 MB per run. (c) Cloudflare R2/B2 — viable and more durable, deferred: needs an external account and secrets; revisit if the gzipped DB approaches 100 MB. (d) Committing the DB to `main` — impossible (>100 MB/file). (e) `workflow_dispatch`-only — rejected, the owner wants automatic refresh.
- Consequences: every run costs ~58 MB download + ~58 MB upload; pending-player ingest advances ~100 players/run (~2,648 pending → ~26 days to fill at current cadence); the state branch must never be deleted; if the gzipped DB nears 100 MB, reduce `--per-player`/retention or migrate to R2/B2.

### D-058 — Retriable `invalid` rejects for unknown patch labels — PROPOSED

- Context: PR #49 review pointed out that a match rejected `invalid` only because its `major.minor` label was absent from `patches` (D-043/D-055, e.g. Riot returns a match from a patch Data Dragon has not published yet) stays rejected forever: `findRejection` only re-evaluates `patch` rejects, and D-017's update says `invalid` rejects are permanent until `--reset`. The spec does not distinguish label-unknown `invalid` rejects from genuinely broken payloads.
- Decision (assumption, PROPOSED): `findRejection` treats an `invalid` reject that carries a patch label as retriable — it re-resolves the label through the run's patch resolver and drops the reject once the label is known, so the match is refetched and re-evaluated. `invalid` rejects without a label (schema/participant failures), `queue`, `short` and `pruned` rejects stay permanent as before. Related review fixes in the same change: `--reset`/`--reset-tombstones` now run only after `--since-patch` validation succeeds (a failed run no longer destroys cursors or tombstones); `--reset-tombstones` forces done cursors to relist in full AND uncapped so cleared tombstones' matches are actually reachable however old they are; `ingestMatches` reports `stoppedEarly` when the 3-consecutive-failure breaker trips and `etl matches` exits non-zero on it, so scheduled runs never publish a partial refresh (isolated transient failures still exit 0 — the breaker exists to tolerate them); the ETL workflow refuses to run on non-`main` refs so a manual dispatch cannot publish exports to a branch `deploy.yml` does not build.
- Alternatives: (a) a new reject reason + migration — rejected, the label-carrying `invalid` row already identifies the retriable case; (b) revisiting completed cursors on every catalog refresh — rejected, far broader than the rare Data Dragon lag; (c) keeping `invalid` fully permanent per D-017 — rejected, it makes the lag case unrecoverable without a manual `--reset`.
- Consequences: matches rejected during a catalog lag self-heal on a later run once `versions.json` catches up (the rejected match's `gameCreation` never advanced `lastGameCreation`, so incremental listing still returns its id); the "`invalid` is permanent" wording in D-017/SPECS §13 now has this one exception.

### D-059 — Rune recommender interpretation details (SPECS §8.1) — PROPOSED

- Context: T-040 implements the engine side of SPECS §8.1, which leaves several mechanics unspecified: which champions count as "context slots" under partial drafts, what "the same page's win rate in the next broader context" means when the page is absent there, how pages are identified across contexts, and what the adaptation hint contains.
- Decision (assumptions, PROPOSED):
  1. Context slots are the lane-group champions whose role was resolved by §4 inference (fixed or inferred), sorted by descending lane-phase `influence` with the spec tie-breaks (ally before enemy, then role order TOP, JUNGLE, MID, ADC, SUPPORT), capped at `contextSlots`. Prefix keys are emitted for n = selected count down to 1 in the exact `lane:`/`damagemix:`/`global` `context_key` format the aggregator writes. A partial-draft key can only match export data when the known champions coincide with an aggregation prefix; otherwise it misses and back-off continues — it can never produce a wrong match.
  2. Page identity across contexts = all exported page fields (`primaryStyleId`, `subStyleId`, `keystoneId`, `selectedPerkIds`, `statShardIds`); rows describing the same displayed page are merged (weighted counts summed, pick shares added, `players` maxed).
  3. Shrinkage: each page's win rate at a context is shrunk toward the same page's shrunk estimate at the nearest broader context where it has data (recursive, D-021 style); when the page is absent from every broader context, the prior is the pooled (all-pages) estimate of the immediate next broader context; the broadest level shrinks toward 0.5. Prior strength `kRune` = 40 equivalent games (prior, tunable via `RuneConfig`).
  4. A page is scored once, at the most specific context of the chain where it appears; ranking is by that shrunk win rate, tie-break by that context's `pickShare`, then by page key for determinism. `lowData` uses `config.minGames` on the scoring context's `n_eff`; low-data pages are flagged, never dropped.
  5. The enemy damage mix is computed over every enemy board champion (role inference not required), with the same rules as the ETL aggregator (untagged/`NONE` ignored, `MIXED` counts for both, none tagged -> `mixed`).
  6. The adaptation hint reports the `statShardIds` of the most-picked page (by `gamesW`) inside the `damagemix:<mix>` context matching the enemy team; no hint when that context or its shards are absent. The engine does not interpret shard semantics (no armor/MR mapping exists in the data).
  7. Output contract: `RuneRecommendationResult` (`RUNE_RESULT_SCHEMA_VERSION` = 1) with `pages` (top `topPages`, default 3), `adaptationHints`, `damageMix` and `dataAvailable` (false when no export context matches the user's rank bucket).
- Alternatives: (a) shrink toward the broader context's raw `winsW/gamesW` — rejected, a 2-game broader sample would dominate the prior; (b) prior = 0.5 whenever the page is missing in the next broader level — rejected, the pooled context estimate is strictly more informative; (c) emitting lane keys for arbitrary known subsets — rejected, the aggregator only writes influence-order prefixes, so non-prefix keys can never match.
- Consequences: T-041 (runes UI) consumes `RuneRecommendationResult` as-is; T-027.b calibrates `kRune`/`topPages` through the D-023 gate.

### Template

```
### D-xxx — Title — STATUS
Context / Decision / Alternatives / Consequences
```
