# BUGS

Severity: S1 blocker, S2 major, S3 minor, S4 cosmetic. Status: OPEN, INVESTIGATING, FIXED, WONTFIX. Add newest on top of the open list.

## Open

| ID    | Sev | Area   | Title                                                                                    | Status | Found by/date                            | Ticket  |
| ----- | --- | ------ | ---------------------------------------------------------------------------------------- | ------ | ---------------------------------------- | ------- |
| B-017 | S3  | engine | Node type definitions are visible to the pure engine and shared packages                 | OPEN   | GitHub Copilot project review 2026-10-26 | T-020   |
| B-016 | S4  | docs   | Bug ID B-007 is used for two different fixed bugs                                        | OPEN   | GitHub Copilot project review 2026-10-26 | –       |
| B-015 | S3  | etl    | Node 20 is documented as supported but better-sqlite3 segfaults on Node 20.19.0          | OPEN   | GitHub Copilot project review 2026-10-26 | T-001   |
| B-014 | S3  | etl    | CLI accepts malformed numeric options and unknown tier names                             | OPEN   | GitHub Copilot project review 2026-10-26 | T-013.b |
| B-013 | S4  | etl    | Player discovery marks every fetched tier as completed                                   | OPEN   | GitHub Copilot project review 2026-10-26 | T-012   |
| B-011 | S2  | shared | Shared reason and rank-bucket schemas diverge from SPECS §3/§7 outside the T-002.b scope | OPEN   | GitHub Copilot project review 2026-10-26 | T-002.b |

No new bugs were identified during the D-016 formula confirmation; player discovery remains within the current ETL scope.

No new bugs were identified during T-013 (match ingestion); rejected match ids are tracked by design in `match_rejects`, not as bug candidates.

No new bugs were identified while revising T-013 patch-window and rank-known-count behavior.

### B-017 — Node type definitions are visible to the pure engine and shared packages — OPEN

- Severity / Area: S3 / engine
- Steps to reproduce: add `process.cwd()` or `Buffer.from('x')` to a file in `packages/engine/src`, then run `pnpm typecheck` and `pnpm lint`.
- Expected / Actual: AGENTS.md rule 3 (no Node APIs in the engine) is enforced by tooling / the root devDependency `@types/node` is visible to every package because `packages/engine/tsconfig.json` and `packages/shared/tsconfig.json` do not set `"types": []`, and `eslint.config.mjs` has no `no-restricted-imports`, `no-restricted-globals` or `no-restricted-properties` rules for the engine (`node:*`, `Date.now`, `Math.random`). Such code is expected to type-check and lint cleanly (not run).
- Environment (OS, Node version, patch): any.
- Logs / screenshot: `node_modules/@types/node` exists at the repository root.
- Suspected cause: D-014 assumed that `"types": ["node"]` in `packages/etl` keeps Node types out of the engine; TypeScript loads every visible `@types` package when `types` is not set.
- Fix (commit/ticket): pending — set `"types": []` in the engine and shared tsconfigs and add ESLint restrictions for `packages/engine/**` before T-020.

### B-016 — Bug ID B-007 is used for two different fixed bugs — OPEN

- Severity / Area: S4 / docs
- Steps to reproduce: search `docs/BUGS.md` for `### B-007`.
- Expected / Actual: every bug has a unique ID / "Seed rank was excluded from rank reliability counts" and "Invalid match responses left the ingestion cursor stuck" both use B-007.
- Environment (OS, Node version, patch): n/a.
- Logs / screenshot: n/a.
- Suspected cause: two parallel branches (PR B and PR C) each picked the next free ID.
- Fix (commit/ticket): pending — renumber one entry and update any commit or PROGRESS references.

### B-015 — Node 20 is documented as supported but better-sqlite3 segfaults on Node 20.19.0 — OPEN

- Severity / Area: S3 / etl
- Steps to reproduce: on Node 20.19.0, run `pnpm test` (any test that opens SQLite).
- Expected / Actual: AGENTS.md ("Node.js 20+"), SETUP.md ("Node.js 20 LTS+") and root `engines` (`>=20.0.0`) promise Node 20 support / PROGRESS (T-013 pitfalls) reports a segfault in `napi_module_register_by_symbol` while loading `better-sqlite3` on Node 20.19.0; Node 22 works. CI only runs Node 22, so the regression is invisible.
- Environment (OS, Node version, patch): Devin VM, Node 20.19.0, `better-sqlite3` 13.0.3. Not yet reproduced on Windows.
- Logs / screenshot: see the T-013 session log in PROGRESS.md.
- Suspected cause: `better-sqlite3` prebuilt binary / N-API mismatch for this Node 20 build. AGENTS.md rule 4 requires this to be logged here; it was only recorded as a PROGRESS pitfall.
- Fix (commit/ticket): pending — reproduce on Windows + Node 20 LTS; then either add Node 20 to the CI matrix and fix, or raise `engines` and the docs to Node 22 (DECISIONS.md entry).

### B-014 — CLI accepts malformed numeric options and unknown tier names — OPEN

- Severity / Area: S3 / etl
- Steps to reproduce:
  1. `pnpm etl matches --per-player=20abc --limit=1.5 --queue=420x`
  2. `pnpm etl players --tiers=DIAMND --quota=DIAMND:100`
- Expected / Actual: T-013.b acceptance says malformed ingestion options fail as usage errors (exit 2) / `matches` parses numbers with `Number.parseInt`, so `20abc` becomes 20, `1.5` becomes 1 and `1e3` becomes 1; `players` accepts unknown tier names, gives them quota 0 and reports them as `skipped`, and silently ignores quota entries for unknown tiers.
- Environment (OS, Node version, patch): any.
- Logs / screenshot: `packages/etl/src/cli.ts` (`parsePositiveInt` in `runMatches`, tier/quota parsing in `runPlayers`).
- Suspected cause: only `--quota` values got strict validation in T-013.b; the `matches` numeric flags and the tier names were not covered.
- Fix (commit/ticket): pending — validate with `/^\d+$/` + `Number.isSafeInteger`, validate tier names against the rank enum, and add CLI usage-error tests.

### B-013 — Player discovery marks every fetched tier as completed — OPEN

- Severity / Area: S4 / etl
- Steps to reproduce: call `discoverPlayersByTier` for a tier whose pages return fewer players than its quota (for example an early empty page) and inspect `ingest_state`.
- Expected / Actual: `completed` reflects whether the quota was reached or the league was exhausted, and `status: 'partial'` is reachable / `completed = rankedEntries.length >= quota || pageCount > 0` is always true because `pageCount` is at least 1 after any fetch (apex tiers always return 1), so `partial` is dead code and the tier is skipped for `maxAgeDays` (7) whatever was collected.
- Environment (OS, Node version, patch): any.
- Logs / screenshot: `packages/etl/src/players.ts` (`const completed = ...`).
- Suspected cause: tautological condition; reported in the PR B review ("player-discovery completion is marked after any page") but never logged here.
- Fix (commit/ticket): pending — define completion explicitly (quota reached or last page shorter than the page size) and test the partial path.

### B-011 — Shared reason and rank-bucket schemas diverge from SPECS §3/§7 outside the T-002.b scope — OPEN

- Severity / Area: S2 / shared
- Steps to reproduce: compare `reasonSchema`, `manifestSchema.rankBuckets` and `supportPairEntrySchema` in `packages/shared/src/index.ts` with SPECS §3 and §7, then with the T-002.b scope in TICKETS.md.
- Expected / Actual:
  - SPECS §7: `Reason.with: ChampionId[]` (a `lane` reason references the lane-group champions, two for `lane_vs` and three for `lane_full`) and `Reason.lowData: boolean` / the schema has a single optional `with: ChampionId` and no `lowData`.
  - SPECS §3: rank buckets merge MASTER, GRANDMASTER and CHALLENGER into one bucket / `rankBuckets` and the pair-entry bucket use the 10-value `rankSchema`.
  - T-002.b adds the `lane` reason type, `games_w2`, `insufficientData` and the pool fields, but none of the above, so the engine (T-023) cannot emit a valid `lane` reason even after T-002.b.
  - To clarify in SPECS: `Reason.n` and `reliability.games` are integers in the schema, while every threshold uses a real-valued `n_eff`; state whether these fields carry raw games or `n_eff`.
- Environment (OS, Node version, patch): n/a (contract).
- Logs / screenshot: n/a.
- Suspected cause: T-002 predates D-021; the T-002.b parity list (D-011) was written from the new export layout, not from SPECS §7.
- Fix (commit/ticket): pending — extend the T-002.b acceptance with `with: ChampionId[]`, `lowData`, a `rankBucketSchema` that follows SPECS §3, and the `n` semantics.

## Template (copy below the table when detailed)

```
### B-001 — Title
- Severity / Area (engine|etl|web|desktop|vision|docs)
- Steps to reproduce:
- Expected / Actual:
- Environment (OS, Node version, patch):
- Logs / screenshot:
- Suspected cause:
- Fix (commit/ticket):
```

## Fixed

### B-012 — ETL file paths depend on the current working directory — FIXED

- Severity / Area (engine|etl|web|desktop|vision|docs): S3 / etl
- Steps to reproduce: see above.
- Expected / Actual: every default path resolves from resolveRepoRoot().
- Environment (OS, Node version, patch): any.
- Logs / screenshot: n/a.
- Suspected cause: CLI duplicated path logic; modules defaulted to process.cwd().
- Fix (commit/ticket): B-012 — route defaults through config/paths.ts.

### B-010 — API key redaction leaks most of a real `RGAPI-<uuid>` key — FIXED

- Severity / Area (engine|etl|web|desktop|vision|docs): S2 / etl (security)
- Steps to reproduce: `new RiotApiError('x', 400, 'https://euw1.api.riotgames.com/x', 'Invalid request: RGAPI-1a2b3c4d-1234-5678-9abc-def012345678')`, then inspect `message` and `responseBody`.
- Expected / Actual:
  - Expected: the whole key is replaced by `[REDACTED]`.
  - Actual: `redactSensitiveText()` first runs `redactPuuid()`, which truncates every run of 8+ hex characters and appends `…`. The key regex `/RGAPI-[A-Za-z0-9_-]+/` then stops at the inserted `…`, so the result is `[REDACTED]…-1234-5678-9abc-def01234…`: 20 of the 32 hex characters of the key leak. The 401/403 path (`redactPuuid(bodyText)` in `client.ts`) has the same problem.
- Environment (OS, Node version, patch): any; key format as in `.env.example` (`RGAPI-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).
- Logs / screenshot: `packages/etl/src/riot/types.ts` (`redactSensitiveText`). The regression tests use `RGAPI-test-api-key-12345`, which has no 8-character hex run, so they cannot detect this.
- Suspected cause: the redaction order. Also, `redactPuuid()` only matched hex runs, while Riot PUUIDs are base64url-like strings, so it did not redact PUUIDs and mangled unrelated hex values.
- Fix (commit/ticket): B-010 — redact key patterns before any other transformation, renamed `redactPuuid` to `shortenPuuids` and fixed it to match whole 78-character base64url tokens (the verified PUUID length from fixture data), removed the redundant `redactPuuid()` call from the 401/403 path in `client.ts`, and added regression tests with a UUID-shaped key and a 78-character PUUID.

### B-006 — ETL review hardening gaps — FIXED

- Severity / Area (engine|etl|web|desktop|vision|docs): S2 / etl
- Steps to reproduce:
  1. Return an error response that echoes a Riot API key.
  2. Run an ingestion command with a misspelled option, malformed quota, or unsupported CLI platform.
  3. Call match or player ingestion directly without supplying a database handle.
- Expected / Actual:
  - Expected: credentials are redacted, transient per-player listing failures do not block later players, invalid CLI input stops before ingestion, and internally owned SQLite connections close on every exit path.
  - Actual: untrusted error bodies could retain credentials; CLI validation duplicated the platform list and accepted unknown flags/partial numeric quotas; direct ETL calls retained their database handles.
- Environment (OS, Node version, patch): macOS, Node 22, review follow-up to T-013.
- Logs / screenshot: `pnpm check` passed (10 files, 90 tests); CLI smoke tests returned usage exit code 2 for unknown flags, excess positionals, unsupported platforms, and malformed quotas.
- Suspected cause:
  - Error serialization, command argument validation, and database ownership were not consistently enforced at their boundaries.
- Fix (commit/ticket): T-013.b — recursively redact Riot key patterns in error fields, reuse the shared platform list, make ingestion argument parsing strict, validate quotas completely, isolate transient ID-listing failures, and close only internally owned SQLite connections in `finally`. Updated the documented schema-error policy and ignore coverage for raw ETL data.
- Follow-up (2026-10-26): redaction is incomplete for real UUID-shaped keys (B-010), and some malformed `matches` and `players` options are still accepted (B-014).

### B-007 — Seed rank was excluded from rank reliability counts — FIXED

- Severity / Area (engine|etl|web|desktop|vision|docs): S2 / etl
- Steps to reproduce:
  1. Ingest a match whose participant ranks are absent from `players`.
  2. Inspect `matches.rank_known_count`.
  3. Observe the seed player's rank is used for `avg_rank_score` but the count is zero.
- Expected / Actual:
  - Expected: the seed rank is included, so a stored match has `rank_known_count >= 1`; 1 means only the seed rank is known.
  - Actual: the fallback rank was omitted from the count, making the `unknownRankFactor` rule unreachable under the documented meaning.
- Environment (OS, Node version, patch): macOS, Node 20+, ETL ingestion.
- Logs / screenshot: `pnpm exec vitest run packages/etl/src/matches.test.ts` passes.
- Suspected cause:
  - The rank summary counted only database rows returned for match participants and reported zero when the fallback seed rank was used.
- Fix (commit/ticket): C3 — include the seed player's PUUID and fallback rank in `rankSummary`; regression coverage asserts every ingested match has at least one known rank.

### B-007 — Invalid match responses left the ingestion cursor stuck — FIXED

- Severity / Area (engine|etl|web|desktop|vision|docs): S2 / etl
- Steps to reproduce:
  1. Return a persistent HTTP 404 for a match id in a player's snapshot.
  2. Rerun ingestion and inspect the player's cursor.
- Expected / Actual:
  - Expected: record the missing match as invalid, advance the cursor, and continue to later ids.
  - Actual: the failed id could remain at the cursor and block subsequent matches on every rerun.
- Environment (OS, Node version, patch): macOS, Node 20+, match ingestion.
- Logs / screenshot: `packages/etl/src/matches.test.ts` — “rejects persistent 404 match responses and continues to the next match”.
- Suspected cause:
  - Match fetch exceptions were not handled as permanent invalid responses in the cursor transaction.
- Fix (commit/ticket): B2 — classify HTTP 400/404 as invalid and transactionally persist the rejection with cursor advancement.

### B-008 — Riot schema failures returned untyped raw payloads — FIXED

- Severity / Area (engine|etl|web|desktop|vision|docs): S2 / etl
- Steps to reproduce:
  1. Provide a successful HTTP response with a payload that fails the supplied Zod schema.
  2. Call `RiotClient.request()` with that schema.
- Expected / Actual:
  - Expected: throw `RiotSchemaError` with the response URL and bounded issue details.
  - Actual: return the unvalidated payload through a generic type assertion.
- Environment (OS, Node version, patch): macOS, Node 20+, Riot client.
- Logs / screenshot: `packages/etl/src/riot/client.test.ts` — “throws RiotSchemaError when schema validation fails”.
- Suspected cause:
  - The response parser treated schema validation failure as a reason to return the original payload.
- Fix (commit/ticket): B1 — remove the raw-payload fallback and throw `RiotSchemaError` for schema mismatches.

### B-009 — Match participant payloads were discarded after ingestion — FIXED

- Severity / Area (engine|etl|web|desktop|vision|docs): S2 / etl
- Steps to reproduce:
  1. Ingest a valid ranked match.
  2. Inspect `participants` for that match.
- Expected / Actual:
  - Expected: persist all ten role-valid participant rows with the match.
  - Actual: the match row was stored but the participant payload was discarded.
- Environment (OS, Node version, patch): macOS, Node 20+, match ingestion.
- Logs / screenshot: `packages/etl/src/participants.test.ts` and `packages/etl/src/matches.test.ts` cover extracted rows, wins, transaction rollback, incomplete-match repair, and invalid layouts.
- Suspected cause:
  - Match ingestion stored summary metadata without extracting participant details.
- Fix (commit/ticket): C4 — extract participants and insert them atomically with the match.

### B-005 — ETL workspace build regression — FIXED

- Severity / Area (engine|etl|web|desktop|vision|docs): S1 / etl
- Steps to reproduce:
  1. Run `pnpm typecheck` on branch B.
  2. Observe unresolved ETL imports, missing exports, and a CLI import targeting absent `src/cli/main`.
- Expected / Actual:
  - Expected: the ETL package typechecks and the CLI starts.
  - Actual: the Riot client, match ingestion, and player discovery implementations were in the wrong source modules, and the CLI entrypoint targeted a missing module.
- Environment (OS, Node version, patch): macOS, branch B.
- Logs / screenshot: `pnpm check` passes after the repair (9 files, 85 tests).
- Suspected cause:
  - ETL source files were displaced during the recent refactor; match payloads also needed to be revalidated after the Riot client returned an unrecognized raw payload.
- Fix (commit/ticket): T-005 — restored the CLI and module placement, fixed relative imports, revalidated match payloads, and kept tier quotas distributed across divisions.

### B-004 — Migration transaction safety & lock hygiene — FIXED

- Severity / Area (engine|etl|web|desktop|vision|docs): S2 / etl
- Steps to reproduce:
  1. Run `migrate(db)` against a database with multiple migration files.
  2. Observe the old loop pattern that wrapped every migration in `BEGIN IMMEDIATE` even when already applied.
  3. Trigger a failure inside a migration or let a database error occur while a transaction is active.
- Expected / Actual:
  - Expected: pending migrations are checked under a write lock only when needed, original errors are preserved, and already-applied migrations do not cause needless write contention.
  - Actual: the old code could trigger `ROLLBACK` after the real error had already been lost, and it spent a write lock on every migration in the normal no-op path.
- Environment (OS, Node version, patch): macOS, Node 20+, repo baseline after T-011 work.
- Logs / screenshot: `pnpm test -- --run && pnpm typecheck && pnpm lint` passes.
- Suspected cause:
  - Transaction management was done with explicit `BEGIN IMMEDIATE` / `ROLLBACK` around every migration, including applied ones, and the catch path attempted a rollback even after the transaction had already closed.
- Fix (commit/ticket): T-011 — migrated the runner to a `db.transaction()` guard with a single re-check under lock, removed the useless `INSERT OR IGNORE` + `result.changes` pattern, centralized `_migrations` table creation, and moved `busy_timeout` to `openDb()`.

### B-003 — Migration status incorrectly counted pending versions — FIXED

- Severity / Area (engine|etl|web|desktop|vision|docs): S2 / etl
- Steps to reproduce:
  1. Apply a migration version to the SQLite `_migrations` table.
  2. Remove or rename the corresponding `.sql` file from `packages/etl/migrations/`.
  3. Call `getMigrationStatus(db)` and inspect `pending`.
- Expected / Actual:
  - Expected: `pending` should be computed from the migration files actually on disk, and applied versions missing from disk should be reported clearly.
  - Actual: `migrations.length - applied.length` produced a false result and could go negative if the disk set was smaller than the database set.
- Environment (OS, Node version, patch): macOS, Node 20+, repo baseline after T-011 work.
- Logs / screenshot: `pnpm vitest run packages/etl/src/db/migrate.test.ts` passed after the fix.
- Suspected cause:
  - The implementation assumed that every applied migration still existed on disk, which is not true when migrations are deleted or renamed during rollout.
- Fix (commit/ticket): T-011 — `getMigrationStatus()` now computes `pending` as the set difference between disk migrations and applied versions, and exposes `missingVersions` for database entries with no corresponding SQL file on disk.

### B-002 — Incomplete shared schemas vs DATA_MODEL.md contract — FIXED

- Severity / Area (engine|etl|web|desktop|vision|docs): S1 / shared
- Steps to reproduce:
  1. Compare the exported schemas in `packages/shared/src/index.ts` to the contract in `docs/DATA_MODEL.md`.
  2. Check the acceptance criteria for `T-002` and the expected static JSON files for ETL.
  3. Note that the package tests pass even though the required model shapes for ETL/export are absent.
- Expected / Actual:
  - Expected: shared package exports schemas for all data files and tables referenced by `DATA_MODEL.md`, including aggregate JSON contracts and manual-data schemas.
  - Actual: a subset of models exists, but the required schemas for role probabilities, pair aggregates, rune contexts, builds/item tags, and manifest semantics are absent or only partially represented.
- Environment (OS, Node version, patch): macOS, Node >=20, repo baseline after T-001/T-002 scaffolding.
- Logs / screenshot: `pnpm test && pnpm typecheck && pnpm lint` passed, but the validation suite was incomplete relative to the data contract.
- Suspected cause:
  - The ticket closed on happy-path unit tests without an explicit diff against `DATA_MODEL.md`.
  - The validation suite validated only a narrow subset of the public API, not the full contract required by `T-003` and downstream ETL.
- Fix (commit/ticket): T-002 — added schemas and types for `ItemId`, `Item`, `ItemsMap`, `ItemTags`, `ItemTagsMap`, `RuneTree`, `RunePerk`, `RunePage`, `SupportBaselineEntry`, `SupportBaselineTable`, `SupportPairTable`; fixed `PlayerState.items` to use `itemIdSchema`; removed loose `.rest()` from `supportPairEntrySchema`. All 12 unit tests passing.

### B-001 — Shared schema package validation dependency — FIXED

- Severity / Area: docs|shared
- Steps to reproduce: install the workspace and attempt to import `zod`-based shared schemas without a dependency declaration.
- Expected / Actual: valid compile-time schemas and tests should run; actual issue was a missing `zod` dependency in the shared package.
- Environment (OS, Node version, patch): macOS, Node 20+, repo baseline.
- Logs / screenshot: not applicable
- Suspected cause: the required validation library was not added when the schema file was created.
- Fix (commit/ticket): T-002 — added `zod` to `packages/shared/package.json` and implemented the shared schema suite.
