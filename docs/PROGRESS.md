# PROGRESS

## Current status

- Phase: 1 (Support / Diamond)
- Current milestone: M0 Foundations (in progress, T-002.b TODO) and M1 ETL (in progress: ingestion done; enrichment, aggregation and export TODO) -> M2 Engine
- Last updated: 2026-10-28 by Devin

## Epic status

| Epic           | Status      | Notes                                                                   |
| -------------- | ----------- | ----------------------------------------------------------------------- |
| E0 Foundations | IN PROGRESS | T-001..T-005 DONE; T-002.b TODO                                         |
| E1 ETL         | IN PROGRESS | T-010..T-013, T-011.b, T-011.c, T-013.c DONE; T-013.b DONE; T-014 ready |
| E2 Engine      | NOT STARTED | T-020 dependency-ready; needs D-020 accepted                            |
| E3 Web MVP     | NOT STARTED |                                                                         |
| E4 Runes       | NOT STARTED |                                                                         |
| E5 Items       | NOT STARTED |                                                                         |
| E6 Live        | NOT STARTED |                                                                         |
| E7 Vision      | NOT STARTED |                                                                         |

## Data collection status

- Riot key: not recorded (development keys expire every 24 h).
- Games collected: 0 (no SQLite database exists under `data/` in this workspace) | Patch: 16.21 (static data imported: champions, items, runes).
- Last aggregation: never (aggregation is not implemented yet, T-015..T-018).

## Next recommended ticket

Fix B-012 done. Next: T-014 (participant enrichment, dependency-ready). T-002.b is unblocked (see B-011 for scope it does not list yet). T-020 is dependency-ready but implements PROPOSED D-020: start it after the owner accepts D-020..D-023.

## Open questions for the owner

- Accept or revise the PROPOSED decisions D-008, D-011, D-017, D-018, D-020, D-021, D-022, D-023 and D-025. SPECS §5/§8 and T-016..T-018, T-020..T-023, T-027.a/T-027.b follow D-020..D-023.
- Review T-013.b (gaps fixed in B-010 and B-014).
- Node version policy (B-015): make Node 20 work or require Node 22.

---

## Session log (newest first)

The 2026-10-22 entries had no timestamps; their order was reconstructed from ticket dependencies on 2026-10-26.

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
- State left: REVIEW (branch `d-024-champion-pool`, rebased onto `pr-c-data-model-alignment`).
- Next step: implement shared pool schemas in T-002.b before the engine and UI pool work.
- Pitfalls / notes for next AI: the pool must never change scoring, candidate scores, or global order; the engine returns complete lists, and pagination is UI-only.

### 2026-10-24 — Copilot SDK in VS Code — PR C: data model alignment

- Done:
  - Implemented T-011.b migration 004 and migration checksums; corrected D-019 rank-known semantics.
  - Implemented T-013.c participant extraction and atomic persistence, and recorded the T-015.b role-hint limitation.
  - Reviewed PR B and recorded the remaining acceptance gaps in the review handoff.
- Files touched: `packages/etl/migrations/004_role_generic_aggregates.sql`, `packages/etl/src/db/migrate.ts`, `packages/etl/src/matches.ts`, `packages/etl/src/participants.ts`, relevant ETL tests and fixtures, `docs/BUGS.md`, `docs/DATA_MODEL.md`, `docs/DECISIONS.md`, `docs/GLOSSARY.md`, `docs/SPECS.md`, `docs/TICKETS.md`, `docs/PROGRESS.md`
- Tests: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` passed (11 files, 96 tests).
- State left: REVIEW (branch `pr-c-data-model-alignment`, rebased onto `main`).
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
- State left: REVIEW
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
