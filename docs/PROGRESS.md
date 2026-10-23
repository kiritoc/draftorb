# PROGRESS

## Current status
- Phase: 1 (Support / Diamond)
- Current milestone: M0 Foundations (Complete) -> M1 ETL (Complete) -> M2 Engine
- Last updated: 2026-10-23 by Devin

## Epic status
| Epic | Status | Notes |
|---|---|---|
| E0 Foundations | DONE | T-001..T-004 DONE |
| E1 ETL | DONE | T-010..T-013 DONE; T-014 ready |
| E2 Engine | NOT STARTED | Ready to start T-020 |
| E3 Web MVP | NOT STARTED | |
| E4 Runes | NOT STARTED | |
| E5 Items | NOT STARTED | |
| E6 Live | NOT STARTED | |
| E7 Vision | NOT STARTED | |

## Data collection status
- Riot key: (valid until ...)
- Games collected: 0 | Diamond: 0 | Patch: 16.21 (static imported)
- Last aggregation: -

## Next recommended ticket
T-014 (Participant extraction)

## Open questions for the owner
- None.

---
## Session log (newest first)
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

### 2026-10-23 — Devin — Ticket T-013
- Done:
  - Implemented match ingestion in `packages/etl/src/matches.ts` + `matches-store.ts`: per-player ranked solo id listing (queue 420, `type=ranked`, paged by 100), fetch + zod revalidation of every `getMatch` payload (client returns raw on schema mismatch -> counted `invalid`, recorded in `match_rejects`), filters (queue, duration < 15 min, `--patch`), storage in `matches` with `INSERT OR IGNORE`.
  - Resumability: per-player cursor in `ingest_state` (`match-ingest:<platform>:<puuid>`) persists the id snapshot + `processed` after every match, so kill/restart resumes mid-player; `done` cursors list only ids newer than `lastGameCreation` via Riot `startTime` (epoch seconds).
  - Dedup: new `match_rejects` table (migration `002_match_rejects.sql`) remembers rejected ids across players; `patch` rejects keep the actual patch and are re-evaluated when a run targets it (D-017).
  - CLI `pnpm etl matches [platform] [--patch=16.21] [--per-player=20] [--limit=N] [--queue=420] [--min-duration=900] [--reset]` with per-player progress log (`[i/n] puuid… ids=.. stored=.. dup=.. filtered=.. invalid=..`).
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
  - D-016 is PROPOSED; confirm or revise the formula with the owner before relying on it as an accepted decision.

### 2026-10-22 — Copilot CLI — Ticket T-012
- Done:
  - Implemented tier-based player discovery in `packages/etl/src/players.ts` with default tier sequence `EMERALD..CHALLENGER`, per-tier quotas, rank score conversion (`tier + division + LP`), resumable `ingest_state` progress, and SQLite upserts for player rows.
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
  - `playerRankScore()` intentionally uses a tier base + division ladder + capped LP bonus; it is deterministic and suitable for persisted rank_score values.
  - Discovery is resumable per platform/tier via the `ingest_state` table; the state is currently treated as a completion marker after a successful fetch for that tier.
  - The CLI uses quota entries in `EMERALD:250,...` format, but keep the default values in sync with `DEFAULT_PLAYER_QUOTAS`.

### 2026-10-22 — Antigravity (Gemini 3.8 Flash) — Ticket T-010
- Done:
  - Implemented `RiotRateLimiter` (`packages/etl/src/riot/rate-limiter.ts`) supporting multi-window app limits (20 req/1s, 100 req/120s), method-specific limits, header synchronisation (`X-App-Rate-Limit`, `X-Method-Rate-Limit`, `Retry-After`), and serialized concurrency queue to eliminate race conditions.
  - Implemented `RiotClient` (`packages/etl/src/riot/client.ts`) with automatic 429 `Retry-After` retry, 5xx exponential backoff (max 5 tries), immediate 401/403 abort with explicit message `"key expired?"`, and non-crashing Zod response validation that logs unknown payload shapes.
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
  - All static and aggregated formats needed for T-003 and E1 now have validation schemas in `@draftorb/shared`.
  - File length for `packages/shared/src/index.ts` is 291 lines (< 300 lines rule). If adding more schemas, consider modularizing into domain files (e.g. `draft.ts`, `items.ts`, `runes.ts`).

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
