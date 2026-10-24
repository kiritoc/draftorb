# BUGS

Severity: S1 blocker, S2 major, S3 minor, S4 cosmetic. Status: OPEN, INVESTIGATING, FIXED, WONTFIX. Add newest on top of the open list.

## Open

| ID  | Sev | Area | Title | Status | Found by/date | Ticket |
| --- | --- | ---- | ----- | ------ | ------------- | ------ |
| –   | –   | –    | –     | –      | –             | –      |

No new bugs were identified during the D-016 formula confirmation; player discovery remains within the current ETL scope.

No new bugs were identified during T-013 (match ingestion); rejected match ids are tracked by design in `match_rejects`, not as bug candidates.

No new bugs were identified while revising T-013 patch-window and rank-known-count behavior.

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
