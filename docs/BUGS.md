# BUGS

Severity: S1 blocker, S2 major, S3 minor, S4 cosmetic. Status: OPEN, INVESTIGATING, FIXED, WONTFIX. Add newest on top of the open list.

## Open

| ID    | Sev | Area   | Title                                                                                                                                                      | Status | Found by/date                            | Ticket  |
| ----- | --- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------- | ------- |
| B-021 | S3  | engine | `types: []` in engine/shared tsconfigs is circumvented by test files importing vitest, so the type-checker still resolves Node globals in production files | OPEN   | B-017 fix verification 2026-10-28        | –       |
| B-016 | S4  | docs   | Bug ID B-007 is used for two different fixed bugs                                                                                                          | OPEN   | GitHub Copilot project review 2026-10-26 | –       |
| B-015 | S3  | etl    | Node 20 is documented as supported but better-sqlite3 segfaults on Node 20.19.0                                                                            | OPEN   | GitHub Copilot project review 2026-10-26 | T-001   |
| B-011 | S2  | shared | Shared reason and rank-bucket schemas diverge from SPECS §3/§7 outside the T-002.b scope                                                                   | OPEN   | GitHub Copilot project review 2026-10-26 | T-002.b |

No new bugs were identified during the D-016 formula confirmation; player discovery remains within the current ETL scope.

No new bugs were identified during T-013 (match ingestion); rejected match ids are tracked by design in `match_rejects`, not as bug candidates.

No new bugs were identified while revising T-013 patch-window and rank-known-count behavior.

### B-021 — `types: []` does not isolate the engine type-checker from Node globals — OPEN

- Severity / Area: S3 / engine
- Steps to reproduce: add `export const probe = process.cwd();` to `packages/engine/src/hello.ts` (production code, no vitest import), then run `pnpm typecheck`.
- Expected / Actual: with `"types": []` in `packages/engine/tsconfig.json`, `@types/node` is no longer auto-included by the `types` mechanism, so the type-checker is expected to reject `process` / Node globals in production files / `pnpm typecheck` still passes (exit 0): `@types/node` is loaded into the engine program because `packages/engine/src/hello.test.ts` imports `vitest`, and `vitest`'s type declarations import `node:vm`, which pulls in the whole `@types/node` package including the ambient `process`/`Buffer` globals. `types: []` only disables `@types` auto-inclusion, not type inclusion that arrives via a module-import chain. ESLint's `no-restricted-globals` does reject `process`, so `pnpm lint` fails as intended.
- Environment (OS, Node version, patch): any.
- Logs / screenshot: `pnpm exec tsc --noEmit -p packages/engine/tsconfig.json --listFiles` lists `node_modules/.../@types/node/globals.d.ts` (which declares `process`) and `vitest/dist/...` files; `pnpm typecheck` exits 0 with the probe; `pnpm lint` reports `no-restricted-globals` on `process`.
- Suspected cause: test files live in the same `tsc` program as production code and import the vitest framework, whose types depend on `node:*` modules.
- Fix (commit/ticket): not fixed in this session (out of B-017 scope per AGENTS rule 6). Candidate future fix: exclude `**/*.test.ts` from the engine and shared `tsconfig.json` `include` (or add a dedicated test type-check), so production source is type-checked without the framework's Node dependency. Not applied because it would remove type-checking coverage of test files from `pnpm check` and is a behavioral change outside B-017's prescribed fix.

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

### B-017 — Node type definitions are visible to the pure engine and shared packages — FIXED

- Severity / Area (engine|etl|web|desktop|vision|docs): S3 / engine
- Steps to reproduce: add `process.cwd()` or `Buffer.from('x')` to a file in `packages/engine/src`, then run `pnpm typecheck` and `pnpm lint`.
- Expected / Actual: AGENTS.md rule 3 (no Node APIs in the engine) is enforced by tooling / the root devDependency `@types/node` was visible to every package because `packages/engine/tsconfig.json` and `packages/shared/tsconfig.json` did not set `"types": []`, and `eslint.config.mjs` had no `no-restricted-imports`, `no-restricted-globals` or `no-restricted-properties` rules for the engine. Such code type-checked and linted cleanly (not run).
- Environment (OS, Node version, patch): any.
- Logs / screenshot: `node_modules/@types/node` exists at the repository root.
- Suspected cause: D-014 assumed that `"types": ["node"]` in `packages/etl` keeps Node types out of the engine; TypeScript loads every visible `@types` package when `types` is not set.
- Fix (commit/ticket): B-017 — added `"types": []` to the `compilerOptions` of `packages/engine/tsconfig.json` and `packages/shared/tsconfig.json` (disabling `@types` auto-inclusion, the mechanism described in the suspected cause), and added ESLint blocks in `eslint.config.mjs` for `packages/engine/**/*.ts` (`no-restricted-imports` for `node:*`, `fs`, `fs/*`, `path`, `os`, `child_process`, `http`, `https`, `better-sqlite3`; `no-restricted-globals` for `process`, `Buffer`, `__dirname`, `__filename`, `require`, `window`, `document`, `localStorage`, `fetch`; `no-restricted-properties` for `Date.now` and `Math.random` with message "engine must be pure: pass time and seeds in through config"; `no-restricted-syntax` for `new Date()`). A second block covers `packages/shared/**/*.ts` with the same `no-restricted-imports` rule. Verification: `process.cwd()` and `Math.random()` in `packages/engine/src/hello.ts` are both rejected by `pnpm lint` (`no-restricted-globals` / `no-restricted-properties`); the probe was then removed and `pnpm check` is green. Note: `pnpm typecheck` does not itself reject `process.cwd()` in engine production files because the engine test file (`hello.test.ts`) imports `vitest`, whose type declarations import `node:vm` and load `@types/node` globals into the same `tsc` program — see B-021 for this residual limitation; ESLint is the comprehensive enforcement. `pnpm check` — 14 test files, 133 tests passed.

### B-018 — B-014 was still listed in the Open section and table while its fix was complete — FIXED

- Severity / Area (engine|etl|web|desktop|vision|docs): S4 / docs
- Steps to reproduce: search `docs/BUGS.md` for `### B-014` and for `B-014` in the Open table.
- Expected / Actual:
  - Expected: a FIXED bug has its detailed entry under `## Fixed` and is absent from the Open table and `## Open` detailed section.
  - Actual: B-014 appeared in the Open table with status FIXED and retained a detailed entry under `## Open`, with no entry under `## Fixed`.
- Environment (OS, Node version, patch): n/a.
- Logs / screenshot: line 13 of the Open table and the detailed entry under `## Open`.
- Suspected cause: B-014 was fixed in the 2026-10-28 session (commit `5160711`) but was never moved from `## Open` to `## Fixed`; only its status flag in the Open table and header was changed to FIXED.
- Fix (commit/ticket): B-018 — removed B-014 from the Open table and the `## Open` detailed section, and moved its detailed entry into `## Fixed` at the top of the fixed list. Verified B-014 appears only once in BUGS.md (under `## Fixed`).

### B-014 — CLI accepts malformed numeric options and unknown tier names — FIXED

- Severity / Area (engine|etl|web|desktop|vision|docs): S3 / etl
- Steps to reproduce:
  1. `pnpm etl matches --per-player=20abc --limit=1.5 --queue=420x`
  2. `pnpm etl players --tiers=DIAMND --quota=DIAMND:100`
- Expected / Actual: malformed ingestion options fail as usage errors (exit 2)
- Environment (OS, Node version, patch): any.
- Logs / screenshot: moved parsing to `packages/etl/src/cli-args.ts` with strict validation.
- Suspected cause: only `--quota` values got strict validation in T-013.b; the `matches` numeric flags and the tier names were not covered.
- Fix (commit/ticket): B-014 — added `cli-args.ts` with `parseStrictPositiveInt` (only `/^\d+$/`, safe integers > 0), `parseTierList` (upper-cased, deduplicated, validated against `rankSchema.options`), `parseQuotaList` (nonnegative integers, tier must be in `rankSchema.options`); all errors are `UsageError` naming the flag/bad value. Wired into `cli.ts`. Added tests in `cli-args.test.ts`. Smoke tests confirm exit code 2 before network calls. (T-013.b follow-up)

### B-020 — cappedHasRejected checks unselected entries, falsely blocking tier completion — FIXED

- Severity / Area (engine|etl|web|desktop|vision|docs): S2 / etl
- Steps to reproduce: call `discoverPlayersByTier` for an EMERALD tier (quota 250) where Division I page 1 returns 100 entries — the first 63 all `EMERALD` (valid) and the remaining 37 all `GOLD` (wrong tier); Divisions II–IV return empty pages. Inspect `tierResults[0].status` and whether the second run re-fetches.
- Expected / Actual:
  - Expected: the tier is `complete` with `fetched: 63` (all selected entries are valid EMERALD), and the second run skips the tier without re-fetching.
  - Actual: `cappedHasRejected` scanned the entire `divisionEntries` array (all 100 entries) instead of only `divisionEntries.slice(0, perDivision)` (the 63 that are actually selected), so the 37 trailing GOLD entries set `cappedHasRejected = true`. This made `completed = false` → `status: 'partial'`, causing the tier to be re-fetched on every run despite collecting the full set of valid entries available.
- Environment (OS, Node version, patch): any.
- Logs / screenshot: `packages/etl/src/players.ts` — the `cappedHasRejected` check used `divisionEntries.some(...)` instead of `divisionEntries.slice(0, perDivision).some(...)`.
- Suspected cause: the B-019 fix checked all collected entries per division rather than only the `perDivision` slice that feeds into the tier filter and the final `entries` array.
- Fix (commit/ticket): B-020 — changed the `cappedHasRejected` check to `divisionEntries.slice(0, perDivision).some((e) => (e.tier ?? '').toUpperCase() !== normalizedTier)`, matching the entries that are actually retained. Regression test: mixed page with valid EMERALD entries followed by wrong-tier GOLD entries in a capped division, plus empty pages in the other divisions → `complete` with `fetched: 63` on the first run, `skipped` on the second run with no re-fetch. `pnpm check` — 14 test files, 133 tests passed.

### B-019 — Wrong-tier entries in a capped division still mark the tier complete — FIXED

- Severity / Area (engine|etl|web|desktop|vision|docs): S2 / etl
- Steps to reproduce: call `discoverPlayersByTier` for an EMERALD tier (quota 250) where Division I page 1 returns 100 entries all labeled `GOLD` (wrong tier) and Divisions II–IV return empty pages; inspect `tierResults[0].status`.
- Expected / Actual:
  - Expected: the tier is `partial` because a capped division (stopped at `perDivision` after a full page) returned entries that were rejected by the tier filter, so more valid entries may exist on subsequent pages and the tier must be retried.
  - Actual: `exhausted = divisionsExhausted > 0` was `true` (III–IV are exhausted), so `completed = rankedEntries.length >= quota || exhausted` was `true` even though `rankedEntries` was 0 after tier filtering. The tier was persisted as `complete` and skipped for `maxAgeDays` (7) despite collecting zero valid players.
- Environment (OS, Node version, patch): any.
- Logs / screenshot: `packages/etl/src/players.ts` — `getTierEntries` returned `exhausted: divisionsExhausted > 0` (line 190), and `discoverPlayersByTier` computed `completed = rankedEntries.length >= quota || exhausted` (line 298).
- Suspected cause: the B-013 fix changed `exhausted` from `divisionsExhausted === DIVISION_ORDER.length` to `divisionsExhausted > 0` to avoid endless retries when some divisions are exhausted and others are capped, but this did not account for capped divisions that returned entries later rejected by the tier/PUUID filter.
- Fix (commit/ticket): B-019 — `getTierEntries` now returns `cappedHasRejected: boolean` (true when any capped division—stopped at `perDivision`, not by an empty/short page—contributed entries later rejected by the tier filter or missing a puuid). `completed` becomes `rankedEntries.length >= quota || (exhausted && !cappedHasRejected)`, so a tier with rejected capped-division entries stays `partial` and is re-fetched on the next run. Regression test: wrong-tier full page in one division + empty pages in the rest → `partial` with `fetched: 0` on the first run, then `complete` with `fetched: 63` after the division returns right-tier entries. `pnpm check` — 14 test files, 132 tests passed.

### B-013 — Player discovery marks every fetched tier as completed — FIXED

- Severity / Area (engine|etl|web|desktop|vision|docs): S4 / etl
- Steps to reproduce: call `discoverPlayersByTier` for a tier whose pages return fewer players than its quota (for example an early empty page) and inspect `ingest_state`.
- Expected / Actual:
  - Expected: `completed` reflects whether the quota was reached or the league was exhausted, and `status: 'partial'` is reachable.
  - Actual: `completed = rankedEntries.length >= quota || pageCount > 0` is always true because `pageCount` is at least 1 after any fetch, so `partial` is dead code and the tier is skipped for `maxAgeDays` whatever was collected.
- Environment (OS, Node version, patch): any.
- Logs / screenshot: `packages/etl/src/players.ts` (`const completed = ...`).
- Suspected cause: tautological condition; reported in the PR B review ("player-discovery completion is marked after any page") but never logged here.
- Fix (commit/ticket): B-013 — `getTierEntries` now returns `{ entries, pageCount, exhausted }`; for apex tiers `exhausted` is always true, and for non-apex tiers `exhausted` is true when any division stopped on an empty or short page (the existing `< 100` rule) — meaning the league is exhausted for that division while other divisions are capped at `perDivision` and cannot contribute more. A tier is complete when its quota is reached OR any division is exhausted; otherwise it is `partial` and is re-fetched on the next run (not skipped for `maxAgeDays`). The `partial` path requires that all divisions received full pages (no exhaustion), so a tier whose pages return wrong-tier entries is still re-fetched. Added regression tests for quota reached (full pages, not exhausted), league exhausted below quota (short pages), all-divisions-capped with wrong tier → partial + re-fetch, and mixed exhausted/capped divisions → complete with no endless retries. `pnpm check` — 14 test files, 131 tests passed.

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
- Follow-up (2026-10-26): redaction is incomplete for real UUID-shaped keys (B-010). The malformed `matches` and `players` options issue was fixed as B-014.

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
