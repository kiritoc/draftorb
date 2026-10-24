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

### D-008 — Rank at collection time approximates rank at game time — PROPOSED
Documented limitation.

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

### D-011 — Contract parity before ticket closure — PROPOSED
Context: `T-002` was marked DONE even though the shared package did not implement all schemas required by `docs/DATA_MODEL.md` and the downstream ETL ticket `T-003`.

Decision: Every shared-data ticket must include an explicit parity check against the canonical data contract before status is marked `DONE` or `REVIEW`. The acceptance criteria must list the exact schemas and payload shapes covered, and tests must fail if a required data model is absent.

Alternatives considered:
- Close on green unit tests only: rejected because it allows false positives when the shared contract is incomplete.
- Require only a code diff review: rejected because it is too easy to miss missing exported schemas and downstream breakage.

Consequences:
- Future tickets will be blocked until the schemas, exported types, and validation tests align with `DATA_MODEL.md` and any linked ETL/export requirements.
- This adds a mandatory governance gate and reduces the risk of semantic validation gaps in the next ticket.

### D-012 — zod dependency for shared validation schemas — ACCEPTED
- Context: Ticket T-002 requires runtime validation schemas and TypeScript types for draft inputs, recommendations, game state, Data Dragon static data, and exported JSON formats.
- Decision: Use `zod` (^4.x / 4.6.7, MIT) as the single validation dependency in `@draftorb/shared`.
- Alternatives: Joi, Yup, TypeBox, Valibot. Zod is standard in TypeScript/React monorepos, tree-shakeable, zero-runtime-dependencies beyond itself, and infers static TypeScript types without duplication.
- Consequences: Shared package depends on `zod`. Engine and web can safely import schemas without bundling extra runtime dependencies.

### D-013 — tsx dependency for ETL TypeScript CLI execution — ACCEPTED
- Context: Ticket T-003 and Epic E1 implement CLI commands (`pnpm etl static`, `migrate`, etc.) in TypeScript. Scripts must run seamlessly across Windows, macOS, and Linux without requiring a pre-build step in dev workflows.
- Decision: Add `tsx` (devDependency in root, MIT license, free) to execute TypeScript CLI files directly via Node.
- Alternatives: `ts-node` (slower, complex ESM loader issues), native `--experimental-strip-types` (requires Node 22.6+, not backwards compatible with Node 20 LTS baseline), pre-compiling with `tsc` before every command (slow DX, extra build friction for CLI commands).
- Consequences: `pnpm etl <command>` invokes `tsx packages/etl/src/cli.ts <command>` seamlessly on all platforms.

### D-014 — @types/node devDependency for Node.js API typing — ACCEPTED
- Context: `packages/etl` implements Node.js scripts using `node:fs/promises`, `node:path`, `node:os`, `process`, and `fetch`. TypeScript compiler requires Node type definitions to type-check Node-specific packages.
- Decision: Add `@types/node` (^26.x, MIT license, free) as a root devDependency and enable `"types": ["node"]` in `packages/etl/tsconfig.json`.
- Alternatives: Ambient `declare` statements or relying on `DOM` lib (pollutes non-browser code with DOM types).
- Consequences: Strict typing for Node.js APIs in ETL package without affecting pure engine constraints.

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

### D-017 — Rejected matches recorded in `match_rejects`; patch filter is a window lower bound — PROPOSED
- Context: T-013 ingests ranked solo matches per player. The same match appears for up to 10 players, and refetching a match already rejected (wrong queue, too short, off-patch, invalid payload) wastes API budget. Recommendations weight older patches with recency decay (SPECS §3, `decay^(currentPatchIndex - gamePatchIndex)`), so keeping only the current patch would discard data the weighting is designed to use.
- Decision: New table `match_rejects(match_id PK, reason, patch, checked_at)` where `reason` is `queue|short|patch|invalid`. Any match already in `match_rejects` counts as `filtered` without a Riot call. The patch filter is a lower bound: `--since-patch=X` keeps matches whose patch is >= X (numeric compare on major.minor, so 16.10 > 16.9); when omitted every patch is kept. A `patch` reject stores the match's actual patch and is deleted and re-evaluated as soon as a run's window includes it (`--since-patch` lowered to that patch or below, or omitted). `queue`, `short`, and `invalid` rejects are permanent until `--reset`.
- Alternatives: (a) drop filtered ids silently — rejected, duplicates work across players; (b) store rejected ids inside the per-player cursor JSON — rejected, dedupe must be global; (c) exact `--patch` match — rejected, discards the older patches that recency decay is meant to down-weight and forces a full re-ingestion every patch; (d) re-evaluate every reject on any filter change — rejected for `queue`/`short`/`invalid` since those properties cannot change.
- Consequences: one extra table (migration `002_match_rejects`); recency is handled at aggregation time, not ingestion; the database grows with the window (pruning old patches is a separate concern).

### D-018 — Incremental match listing via `startTime` on done cursors — PROPOSED
- Context: T-013 must resume after kill/restart and also pick up new games on later runs. RIOT_API.md fixes ranked solo = queue 420 but says nothing about re-running ingestion.
- Decision: Per-player cursor in `ingest_state` (`match-ingest:<platform>:<puuid>`) holds `{ status, snapshot, processed, lastGameCreation, sincePatch, stored, duplicates, filtered, invalid, updatedAt }`. `partial` cursors re-scan their stored snapshot (completed players are not re-listed). `done` cursors call `match-v5` with `startTime = lastGameCreation` (the max `gameCreation` of stored matches), so a later run only lists new games — unless the run's window is wider than the cursor's (`--since-patch` lowered or removed), in which case the player relists in full so older patch-rejected games are re-evaluated. `--reset` deletes the platform's cursors and all `match_rejects`, making changed filters (`--queue`, `--min-duration`) effective again. `--limit` selects pending (no/partial cursor) players before done players so repeated batches walk the whole population. Note `startTime` includes games already seen, so `matches`/rejects dedupe stays load-bearing.
- Alternatives: (a) always re-list the full history — rejected, wasteful and slow; (b) store the last-seen match id and page until it — rejected, paging backwards through thousands of ids costs more than a `startTime` filter.
- Consequences: repeats of a stored game cost one extra `getMatch` call each (they dedupe on `match_id` only after fetch); `lastGameCreation` only advances on stored matches so filtered games never shrink the window.

### D-019 — `matches.avg_rank_score` = mean `rank_score` of known participants, plus `rank_known_count` — PROPOSED
- Context: `matches.avg_rank_score` exists in DATA_MODEL.md but its computation is unspecified. Every rank weight in SPECS §3 depends on the game's rank, so the reliability of that estimate must be visible. At ingestion time only discovered players have a `rank_score`.
- Decision: `avg_rank_score` is the mean of `players.rank_score` over the match's participant puuids found in `players`; if none are known it falls back to the seed player's `rank_score`. New column `matches.rank_known_count` (migration `003_matches_rank_known`) stores how many participants contributed (0 = fallback). T-014 enriches the ranks of the four bot-lane participants (league-v4 by puuid, cached in `players` so each player costs one call overall) and recomputes both columns.
- Alternatives: (a) seed player's score only — rejected, ignores other known participants; (b) leave NULL — rejected, downstream buckets need a number; (c) fetch all 10 ranks during T-013 — rejected, ~10x API cost per match; T-014 does a targeted, cached version.
- Consequences: approximate by construction (documented approximation like D-008); aggregation can down-weight or exclude games with a low `rank_known_count` (threshold in config).

### D-020 — Role-relative influence matrix by game phase — PROPOSED
- Context: Not every other player matters equally, and the ranking depends on the user's own role and on the phase of the game. For a support the bot lane (ally ADC, enemy support, enemy ADC) decides most of the laning phase, then the junglers, then mid, then top; for a top laner it is the reverse; a jungler cares first about the enemy jungler, then about the lanes it can play around. SPECS §5 only had one hard-coded support row (`roleWeightAlly`/`roleWeightEnemy`), and items/runes had no notion of who matters.
- Decision: One config table `influence[myRole][side][otherRole][phase]` in `engine/config.ts`, used by draft scoring (§5), rune contexts (§8.1) and item contexts (§8.2). `side` is `ally|enemy`. Phases: `draft` (champion pick), `lane` (runes, starting items, first completed item, game time < `laneEndSeconds`, default 840 s), `mid` (2nd completed item onward or after `laneEndSeconds`). The `draft` and `lane` rows share the default values of the SPECS §5 table (all five roles defined, Phase 1 uses only `SUPPORT`). In the `mid` phase enemy weights become `lambda * lane + (1 - lambda) * threatShare(e) * enemiesKnown` (`threatShare` from §8.2 step 2, `lambda` = 0.3) so the fed enemy matters most whatever their lane; ally weights stay at the `lane` row. Default values are priors only: the backtest (D-023) measures each slot's real contribution and any change to the table must pass that gate.
- Alternatives: (a) keep one support-only weight row — rejected, wrong as soon as the phase or the role changes and blocks later roles; (b) equal weights for every slot — rejected, dilutes the lane matchup that drives most of the outcome; (c) learn the weights only from data — rejected as a start, too noisy at Phase 1 data volumes; the priors plus backtest calibration give a safe path.
- Consequences: one config object instead of two weight rows; the role-confidence factor of §4 still multiplies every slot weight; adding a role later means filling its row, not changing code.

### D-021 — Context win rates: layered back-off with shrinkage in log-odds space — PROPOSED
- Context: The goal is "what do other players pick/build in this situation, and does it win", counting games that match the current situation exactly more than games that only match partly. SPECS §5 added independent pair deltas in percentage points: exact bot-lane matchups never got extra weight, effects could double-count, and sums could leave [0, 100] %.
- Decision: Every win-rate estimate is a chain of layers from general to exact; each layer is shrunk toward the prediction of the layer below it: `p_L = (wins_L + k_L * q_{L-1}) / (n_L + k_L)`, where `q_{L-1}` is the previous layer's prediction (not the global baseline). Exact contexts therefore dominate when they have enough games and fall back smoothly when they do not. Effects combine on the log-odds scale: `term = logit(p_L) - logit(q_{L-1})`, scaled by the D-020 influence weight and the §4 role confidence, summed, then converted back with the logistic function. For a support the layers are: champion baseline -> pair terms for every known slot -> enemy bot lane `(c, enemySupport, enemyAdc)` -> full bot lane `(c, allyAdc, enemySupport, enemyAdc)`; a layer is skipped when one of its champions is unknown. Counts are rank- and recency-weighted (§3); thresholds use the effective sample size `n_eff = (sum w)^2 / sum w^2`, so a handful of heavily weighted games cannot pass `minGames`. Below `minGames` a layer contributes nothing and the reason is flagged `lowData` (golden rule 8).
- Alternatives: (a) additive percentage-point deltas (old §5) — rejected, double counts and can exceed 100 %; (b) exact-context win rate only — rejected, almost always too few games; (c) similarity-kernel weighting over raw games at runtime — rejected, needs raw games in the browser (D-002, 5 MB budget); (d) a trained model (logistic regression / GBM) — deferred, harder to explain in the UI; can be compared later through D-023.
- Consequences: two new aggregated tables (`lane_vs`, `lane_2v2`) plus a `games_w2` column (sum of squared weights) in every aggregated table; exports keep only rows with `n_eff >= minGames` to respect the size budget; reasons gain a `lane` type for the bot-lane terms.

### D-022 — Runes and items compared like for like; definition of experts — PROPOSED
- Context: Raw item win rates are biased: late items only appear in long games and players who are ahead can afford more, so "item X has 58 % win rate" mostly measures game state. SPECS §3 also asks for players with `championGames >= 30`, but champion-mastery-v4 returns points, not games.
- Decision: An item is only compared with other items bought in the same situation: same champion, same completed-item slot index `k`, same purchase time bucket (5 min), same state bucket at purchase (`ahead|even|behind` from the team gold difference in the timeline, §8.2 thresholds), same enemy profile bucket (threat-weighted damage mix: `AD|AP|mixed`); for the `lane` phase (k = 1 and starting items) the context also contains the enemy bot lane and ally ADC. The score is the shrunk win rate of the item versus the average of all items bought in that same context, with the D-021 back-off chain dropping context dimensions in this order: lane champions -> enemy profile -> state -> time bucket -> (champion, k). Runes use the same chain with context = lane champions -> enemy damage mix -> champion. Experts: a participant counts as an expert on a champion if they have `>= minChampGames` (default 30) games on it in our own `participants` data within the patch window, or, when our data has fewer games, champion-mastery-v4 `championPoints >= minMasteryPoints` (default 50 000, config).
- Alternatives: (a) raw per-item win rate — rejected, state and survival bias; (b) only pick rate ("what others build") — rejected, ignores outcome; (c) mastery points only — rejected, points also accumulate in other queues and over years.
- Consequences: timeline ingestion (T-051) must record, per purchase, its completed-item index, game time and team gold difference; results are observational ("players who bought X here won Y %"), never presented as causal, and always shown with sample size and pick share.

### D-023 — Offline backtest gates every weight and parameter — PROPOSED
- Context: Influence weights, shrinkage strengths, the rank kernel and the recency decay are all guesses until checked against real outcomes. A tool that ranks champions by win rate must prove its numbers predict wins on games it has not seen.
- Decision: New ETL command `pnpm etl backtest` (T-027). Temporal split: aggregates are built only from matches older than the holdout (default: the latest patch in the window, or the last 20 % by `created_at`), then the engine predicts the win probability of each holdout support with (a) the full draft and (b) masked drafts (blind pick, enemy bot lane only, random partial). Metrics: log-loss, Brier score, calibration error over 10 bins, against two baselines (0.5 and champion baseline only). Slot ablation (drop one slot's term, measure the log-loss change) gives the empirical influence of each slot and is used to recalibrate D-020. Gate: a change to `engine/config.ts` parameters is accepted only if holdout log-loss does not get worse and stays better than the baseline-only model; the report (`data/reports/backtest-<timestamp>.json`, gitignored) is linked in the PR. For items and runes the backtest checks calibration of the shrunk context win rates on holdout purchases.
- Alternatives: (a) tune by intuition — rejected, unverifiable; (b) random train/test split — rejected, leaks future patches into training and overstates accuracy.
- Consequences: one more ETL ticket; engine functions stay pure so the same code runs in the web app and in the backtest; parameter PRs need a backtest report.

### Template
```
### D-xxx — Title — STATUS
Context / Decision / Alternatives / Consequences
```
