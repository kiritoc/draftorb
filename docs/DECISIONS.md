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

### D-017 — Rejected matches recorded in `match_rejects` for cross-player dedupe — PROPOSED
- Context: T-013 ingests ranked solo matches per player. The same match appears for up to 10 players (match ids come from each player's history), and refetching a match already rejected (wrong queue, too short, off-patch, invalid payload) wastes API budget. The spec does not say what to do with filtered matches.
- Decision: New table `match_rejects(match_id PK, reason, patch, checked_at)` where `reason` is `queue|short|patch|invalid`. Any match already in `match_rejects` counts as `filtered` without a Riot call. A `patch` reject stores the match's actual patch: when a run targets that patch (`--patch` equal, or any patch when `--patch` is omitted), the reject row is deleted and the match is re-evaluated. `queue`, `short`, and `invalid` rejects are permanent.
- Alternatives: (a) drop filtered ids silently — rejected, duplicates work across players; (b) store rejected ids inside the per-player cursor JSON — rejected, dedupe must be global, not per player; (c) re-evaluate every reject when the target patch changes — rejected for `queue`/`short`/`invalid` since those properties cannot change.
- Consequences: one extra table (migration `002_match_rejects`); patch-filtered matches stay recoverable for future patches; a run with no `--patch` re-evaluates every `patch` reject.

### D-018 — Incremental match listing via `startTime` on done cursors — PROPOSED
- Context: T-013 must resume after kill/restart and also pick up new games on later runs. RIOT_API.md fixes ranked solo = queue 420 but says nothing about re-running ingestion.
- Decision: Per-player cursor in `ingest_state` (`match-ingest:<platform>:<puuid>`) holds `{ status, snapshot, processed, lastGameCreation, patch, stored, duplicates, filtered, invalid, updatedAt }`. `partial` cursors re-scan their stored snapshot (completed players are not re-listed). `done` cursors call `match-v5` with `startTime = lastGameCreation` (the max `gameCreation` of stored matches), so a later run only lists new games — unless the cursor's `patch` differs from the run's `--patch`, in which case the player relists in full so older patch-rejected games are re-evaluated. `--reset` deletes the platform's cursors and all `match_rejects`, making changed filters (`--queue`, `--min-duration`) effective again. `--limit` selects pending (no/partial cursor) players before done players so repeated batches walk the whole population. Note `startTime` includes games already seen, so `matches`/rejects dedupe stays load-bearing.
- Alternatives: (a) always re-list the full history — rejected, wasteful and slow; (b) store the last-seen match id and page until it — rejected, paging backwards through thousands of ids costs more than a `startTime` filter.
- Consequences: repeats of a stored game cost one extra `getMatch` call each (they dedupe on `match_id` only after fetch); `lastGameCreation` only advances on stored matches so filtered games never shrink the window.

### D-019 — `matches.avg_rank_score` = mean `rank_score` of known participants — PROPOSED
- Context: `matches.avg_rank_score` exists in DATA_MODEL.md but its computation is unspecified. At ingestion time only seed players have a `rank_score`; other participants are unknown.
- Decision: `avg_rank_score` is the mean of `players.rank_score` over the match's participant puuids found in the `players` table; if none are known, it falls back to the seed player's own `rank_score`. T-014 may refine it once participant ranks are extracted.
- Alternatives: (a) use the seed player's score directly — rejected, ignores that teammates are usually near the seed's rank and biases nothing toward match reality; (b) leave NULL — rejected, downstream buckets need a number.
- Consequences: approximate by construction (documented approximation like D-008); recompute is cheap if participant ranks become available.

### Template
```
### D-xxx — Title — STATUS
Context / Decision / Alternatives / Consequences
```
