# BUGS

Severity: S1 blocker, S2 major, S3 minor, S4 cosmetic. Status: OPEN, INVESTIGATING, FIXED, WONTFIX. Add newest on top of the open list.

## Open

| ID  | Sev | Area | Title | Status | Found by/date | Ticket |
| --- | --- | ---- | ----- | ------ | ------------- | ------ |

## Duplicate bug IDs (not renumbered)

Three IDs each label two distinct bugs (per owner instruction, IDs are never renumbered; the duplicates are documented here):

- **B-026**: two FIXED entries in the Fixed section — "`blindSafety` approximates `pickShare(e)` with roleProb (no pick-rate export)" and "Engine `shrink()` returns NaN for empty contexts with zero prior strength".
- **B-027**: FIXED in the Fixed section — "Recommendation constants injectable via `RecommendConfig`" — and also FIXED in the Fixed section — "Transient enrichment failures become permanent gaps (no retry on duplicates)".
- **B-035**: FIXED in the Fixed section — "Export removes static catalogs and role-derivation snapshots" — and also FIXED in the Fixed section — "Export review findings (role-prob rounding, empty builds, publish cleanup, static catalogs)".

Review notes that predate the bug log live in [Review history](#review-history) at the end of this file.

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

### B-059 — All-unscored backtest report dropped evaluated fallback counts — FIXED

- Severity / Area: S3 / etl
- Steps to reproduce: run `pnpm etl backtest draft` when every holdout pick is an unscored baseline fallback; the insufficient-data report showed `predictions: 0` and `unscored: 0` even though fallback points were evaluated.
- Expected / Actual: an insufficient report may keep loss metrics null, but it should preserve the evaluated sample size (`predictions`/`unscored`, and per-role counts) so the JSON still shows how many fallback evaluations happened; the shared `insufficient()` helper zeroed those counts for every early exit.
- Environment (OS, Node version, patch): any; patch-independent.
- Suspected cause: the all-unscored branch reused `insufficient()`, which is correct before evaluation but resets counts after `points` were collected.
- Fix (commit/ticket): added `insufficientWithFallbackCounts()` for the all-unscored branch; it keeps metrics null and `insufficientData: true` while setting `predictions`/`unscored` to `points.length` and populating `perRole` prediction/unscored counts.
- Verification: `backtest/draft.test.ts` all-unscored case now asserts `predictions: 24`, `unscored: 24`, and TOP/SUPPORT per-role counts of 12/12 with null loss metrics. `pnpm check` green (75 files, 855 tests).

### B-057 — Draft backtest evaluated holdout players at participant rank, not match rank — FIXED

- Severity / Area: S2 / etl
- Steps to reproduce: run `pnpm etl backtest draft` on matches whose participants have `rank_score NULL` while `matches.avg_rank_score` is known; the holdout evaluation bucketed those players as IRON.
- Expected / Actual: per D-023 the holdout `userRank` is the game's rank bucket, and every aggregate table is keyed by `matches.avg_rank_score`; the backtest selected `participants.rank_score`, so NULL became bucket index 0 through `gameBucketIndex` and the engine/baseline lookup used the wrong rank context.
- Environment (OS, Node version, patch): any; patch-independent.
- Suspected cause: the holdout query selected `p.rank_score` while `DraftRow.rankScore` was typed as non-nullable `number`.
- Fix (commit/ticket): the query now selects `m.avg_rank_score AS matchRankScore` for every participant row, and `DraftRow.rankScore` was renamed to `matchRankScore` to match the aggregate rank context.
- Verification: new `commands/backtest.test.ts` case seeds low-rank training matches plus Diamond holdout matches with NULL participant ranks; before the fix the NULL ranks evaluated as IRON and scored, after the fix the Diamond bucket has no training evidence and the report is insufficient. `pnpm check` green (75 files, 855 tests).

### B-058 — Draft backtest published metrics when every pick was an unscored fallback — FIXED

- Severity / Area: S3 / etl
- Steps to reproduce: run `pnpm etl backtest draft` with enough matches to pass the training-count gate but too little evidence for any champion to be engine-scored; every holdout point used the champion-baseline fallback while `insufficientData` stayed false.
- Expected / Actual: a report with zero engine-scored picks is not a completed backtest; it should return the insufficient-data report. Paired fallback points remain valid when at least one pick is scored.
- Environment (OS, Node version, patch): any; patch-independent.
- Suspected cause: `runBacktestDraft` only checked `points.length === 0` and never counted `point.scored` before publishing metrics.
- Fix (commit/ticket): `runBacktestDraft` returns an insufficient-data report when every holdout point is unscored; the existing `predictions`/`unscored` paired-fallback behavior is unchanged for mixed reports.
- Verification: new `backtest/draft.test.ts` case covers the all-unscored report; the command seed was expanded to 30 training matches because the old 5-match seed was itself an all-unscored scenario. `pnpm check` green (75 files, 855 tests).

### B-052 — Sample `data/public` export below `minGames`, every draft empty — FIXED

- Severity / Area: S2 / data
- Steps to reproduce: run `recommend` (or open the app) against the committed `data/public/16.21` export: `roles/SUPPORT/baseline.json` held a single row `[412,"IRON",6,10,10,3]` (n_eff 10 < `minGames` 25) and `role-prob.json` a single champion, so every candidate failed the baseline gate and `recommendations` was empty for every draft.
- Expected / Actual: the published sample must be exported from real aggregates so drafts return recommendations; it had been produced from a nearly empty database.
- Environment (OS, Node version, patch): any; data bug, patch-independent.
- Suspected cause: `pnpm etl export` ran before real match ingestion/aggregation, publishing the degenerate tables.
- Fix (commit/ticket): ran `pnpm etl aggregate` on `data/DraftOrb.sqlite` (883 matches, euw1, patches 16.19–16.22; role_prob 430 rows/173 champions, baseline 3440 rows, pair tables, rune_ctx 42816 rows) then `pnpm etl export` (patch 16.22) and `pnpm etl export 16.21`. `latest.json` now points to 16.22 (the D-051 newer-pointer guard kept it); both committed patch dirs carry real aggregates plus `pick-rate.json` and rune files.
- Verification: new `packages/etl/src/export/sample-export.test.ts` loads the published export through the same schemas as the web loader and asserts `recommend` returns a non-empty "Best overall" list per exported role at Diamond — failed before the re-export (0 recommendations), passes now. `pnpm check` green (75 files, 853 tests).

### B-026 — `blindSafety` approximates `pickShare(e)` with roleProb — FIXED

- Severity / Area: S3 / engine (+ etl, shared, web)
- Steps to reproduce: pick-rate export absent, so `blindSafety` used `roleProb[e][role]` — the share of champion `e`'s own games played in `role` — as the opponent distribution instead of the share of `role`'s picks won by `e`.
- Expected / Actual: `pickShare(e)` must be the per-role pick share; until now it was approximated by normalized roleProb, which ranks dedicated one-trick picks differently from real pick rates (e.g. a 0.04-roleProb flex picked in 90% of ADC games was filtered out by `blindOpponentMinShare`).
- Environment (OS, Node version, patch): any; engine-level bug, patch-independent.
- Suspected cause: no pick-rate export existed (D-030 item 1 recorded the approximation).
- Fix (commit/ticket): new global `pick-rate.json` export (`export/pick-rate.ts`): per-role shares computed from `role_prob.games_w`, gated per cell by `n_eff >= exportMinGames`, renormalized per role to sum 1 (round6, largest share absorbs residual — B-049 rule). New `pickRateSchema`/`PickRate` in `@draftorb/shared`; `RecommendData.pickRate` is optional so pre-existing exports keep working. `blindOpponents`/`computeBlindSafety` take an optional `pickRate` and use `pickRate[role][e]` when present, falling back to `roleProb[e][role]` otherwise; `recommend` passes `data.pickRate`. The web loader reads `pick-rate.json` when the manifest lists it; the draft backtest's `RecommendData` always carries real pick rates. Semantics recorded as D-052 (PROPOSED).
- Verification: `recommend-terms.test.ts` "blind opponent pick share (B-026)" (pickRate precedence, roleProb fallback, changed blindSafety value — failed before the fix), `recommend-blind-comp.test.ts` recommend-level regression, `export/pick-rate.test.ts` (gate, renormalization, residual, unknown role, manifest listing), `apps/web` loader tests, `shared` schema tests.

### B-053 — Draft backtest scored a per-champion win-rate model, not `recommend` — FIXED

- Severity / Area: S2 / etl
- Steps to reproduce: `pnpm etl backtest draft` on a database with at least 5 training matches and a holdout patch; inspect the written `backtest-draft.json`.
- Expected / Actual: per D-023 the report must measure the deployed engine (`recommend` from `@draftorb/engine`); instead T-027.a trained a private per-champion win-rate model on raw participant rows and predicted blue-team win probability, so its log-loss said nothing about the shipped scorer.
- Environment (OS, Node version, patch): any; patch-independent.
- Suspected cause: the baseline harness implemented a standalone win-rate model instead of wiring the pure engine.
- Fix (commit/ticket): `runBacktestDraft(rows, engine)` now runs `recommend` once per holdout participant on the full draft (all nine other picks known with fixed roles, `blindPick: false`) and reads the score of the champion actually picked; picks the engine cannot score fall back to the champion's baseline-only prior so the comparison stays paired. New `backtest/recommend-data.ts` rebuilds per-role `RecommendData` from aggregates computed in a throwaway in-memory database holding only matches before the holdout patch (same aggregators, `exportMinGames` gate and role-prob renormalization as the JSON export), wired by `commands/backtest.ts`. The report gains `predictions`/`unscored` and per-role log-loss/Brier/mean-prediction metrics; the old `perRole` matchup effects were specific to the win-rate model and are replaced. Masked drafts, rolling validation, fixed-Diamond report, layer/slot ablation and the paired-bootstrap gate remain outstanding — the report stays `unvalidated` (T-027.a).
- Verification: `backtest/draft.test.ts` rewritten — engine evaluation, matchup-layer regression (an enemy-pair term beats the champion baseline, impossible for a win-rate model), unscored fallback and insufficient-data cases; `backtest/recommend-data.test.ts` covers gating, role-prob renormalization and loud tags failure; `commands/backtest.test.ts` covers the seeded-DB report path.

### B-056 — Web production build fails on clean checkout (TS6305) and PR CI never ran it — FIXED

- Severity / Area: S2 / web+ci
- Steps to reproduce: from a clean checkout (no `packages/*/dist`, no `*.tsbuildinfo`), run `pnpm --filter @draftorb/web build`.
- Expected / Actual: the production build should succeed; instead `tsc --noEmit` failed with TS6305 ("Output file '.../packages/{shared,engine}/dist/index.d.ts' has not been built from source file") plus cascading type errors, so the deploy workflow failed after merge even though PR checks were green.
- Environment (OS, Node version, patch): any; Node.js 22, pnpm workspace.
- Suspected cause: `apps/web/tsconfig.json` references the composite `packages/shared` and `packages/engine` projects, so module resolution redirects their `src/index.ts` entry points to `dist/*.d.ts`; `tsc --noEmit` (non-build mode) requires those outputs to exist. Root `pnpm typecheck` (`tsc --build`) builds them, which is why local checks passed, and CI never ran the web build command.
- Fix (commit/ticket): `apps/web` `build` and `typecheck` scripts now run `tsc -b .` (build mode builds the referenced projects' declarations, then type-checks the app with `noEmit` preserved); `.github/workflows/ci.yml` runs `pnpm --filter @draftorb/web build` so the production build is gated on PRs (T-036).
- Verification: reproduced the TS6305 cascade on a clean state before the fix; `pnpm --filter @draftorb/web build` succeeds after; regression test `apps/web/src/build-script.test.ts` pins the build-mode ordering.

### B-021 — `types: []` does not isolate the engine type-checker from Node globals — FIXED

- `types: []` in `packages/engine/tsconfig.json` and `packages/shared/tsconfig.json` only disables `@types` auto-inclusion; it does not stop type inclusion that arrives via a module-import chain. Test files living in `src/` imported `vitest`, whose declarations import `node:*` modules, pulling all of `@types/node` (including the ambient `process`/`Buffer` globals) into the production program — so `process.cwd()` in engine sources passed `pnpm typecheck` (S3, engine).
- Fixed: every engine/shared unit test moved from `src/` to `packages/engine/test/` and `packages/shared/test/` (vitest types transitively require Node types, so all of them are "Node-dependent" per CONVENTIONS.md), relative imports rewritten to `../src/...`, a new `packages/shared/test/tsconfig.json` added, and `pnpm typecheck` now runs `tsc -p packages/shared/test` next to `tsc -p packages/engine/test`. Both production tsconfigs keep `"exclude": ["src/**/*.test.ts"]` as a guard so a stray test file cannot silently reintroduce the leak (the ESLint project service would also reject it as not belonging to any project).
- Verification: reproduced with `export const probe = process.cwd();` in `packages/engine/src/` — `pnpm typecheck` exited 0 before the fix and fails with TS2591 after. New regression test `packages/engine/test/typecheck-isolation.test.ts` builds both production programs through the TypeScript API and asserts no `@types/node` file is loaded; it failed before the move and passes now.

### B-055 — PR #46 third-pass review findings — FIXED

- `exportJson` guarded the `latest.json` pointer only against the database's latest patch, so after a database reset or restore an explicit older `--patch` export could overwrite a newer published pointer and move the web app backwards (S3, etl). Follow-up: the published pointer is protected only while intact — a dangling pointer (missing or mismatched manifest, e.g. after a partial restore) does not block an eligible export from replacing it.
- `ChampionPicker` Escape dismissal unmounted the autofocused search input without returning focus to the trigger button, so keyboard navigation restarted from the document (S4, web).
- Fixed on `feature/t-029-to-t-034`: the exporter reads and validates the existing `latest.json` in `publicDir` (pointer plus referenced manifest) and preserves it (with a warning) when it references a newer intact patch; the picker refocuses its button on Escape. Regression coverage in `export/atomic.test.ts`.

### B-054 — Draft flow second-pass review findings — FIXED

- `pnpm etl backtest draft --out=<path>` was unreachable: strict `parseArgs` rejected the flag before the manual scan ran (S2, etl).
- `exportJson` wrote `latest.json` for any exported patch, so re-exporting an older patch moved the web pointer backwards (S2, etl).
- Web: rank selector emitted the invalid `MASTER_PLUS` bucket as a `Rank`; duplicate champion picks across slots were allowed; the user slot showed a dead role select; pool champions in "Best overall" lacked the "In your pool" tag (SPECS §7.1); `poolUnavailable` reasons rendered as raw codes; `ChampionPicker` had a dangling `aria-controls` id and no dismiss handling; list titles were duplicated; pool import validation was untested.
- Fixed on `feature/t-029-to-t-034` with regression coverage (`parsePoolImport`, `championsForSlot`, `--out` and `latest.json` guard tests, card pool-tag render tests).

### B-051 — Draft flow data and validation review findings — FIXED

- The web loader used incorrect paths for patch-relative manifest files and did not publish manual champion tags in all runtime/deploy paths.
- Recommendation data was not schema-validated or fully wired; pool edits were not persisted, all role pools could affect Support, and storage/engine failures were not clearly surfaced.
- Pagination did not reset with draft changes, and unavailable pool entries did not display their effective sample size.
- The unvalidated-model banner could disappear based on a raw loss comparison before the D-023 paired-bootstrap gate passed.
- The backtest baseline included holdout information and its game thresholds/counts used participant rows rather than matches.
- Fixed in T-035 with regression coverage. Backtest reports remain `unvalidated` until the paired-bootstrap gate is implemented.

### B-050 — Reserved-role ally reappears through an unfixed duplicate slot — FIXED

- Severity / Area: S3 / engine
- Steps to reproduce: `userRole = SUPPORT`, allies `[{ championId: 235 }, { championId: 235, role: 'SUPPORT' }]` (either order) with roleProb `{SUPPORT: 0.6, ADC: 0.4}`, then call `resolveKnownSlots(..., ['SUPPORT'])`.
- Expected / Actual: the champion is fixed to the user's role, so it must give no pair or lane effect; instead the unfixed copy survived and was inferred ADC.
- Environment (OS, Node version, patch): any; engine-level bug, patch-independent.
- Suspected cause: the B-043 fix filtered reserved-role fixed slots before `dedupeTeamSlots`, which reversed its fixed-role-wins priority.
- Fix (commit/ticket): `resolveKnownSlots` dedupes first, then drops slots fixed to a reserved role (D-050).
- Verification: `packages/engine/src/recommend-slots.test.ts` — "drops a reserved-role ally even when an unfixed duplicate exists" (both orders); fails with the old filter order and passes now.

### B-049 — Role-prob export residual can go to a tiny role; duplicate validation; name clash — FIXED

- Severity / Area: S4 / etl
- Steps to reproduce: export role probabilities for a champion whose last surviving role (row order) is tiny while rounding produces a nonzero residual, e.g. `{SUPPORT: 0.7, TOP: 0.1500005, ADC: 0.1499995}`.
- Expected / Actual: the largest surviving role should absorb the rounding residual; instead the residual always went to the last surviving role, which could push a marginal role to <= 0 or make a tiny role the residual target. `computeRoleProb` also clashed by name with `aggregate.ts`'s `computeRoleProb`, and `roleProbFile` re-validated the map a second time.
- Environment (OS, Node version, patch): any; export-layer bug.
- Suspected cause: the residual was assigned positionally (`index === entries.length - 1`) instead of by magnitude.
- Fix (commit/ticket): renamed to `exportRoleProbabilities`; the largest surviving probability (first in row order on ties) absorbs the residual; removed the duplicate schema validation in `roleProbFile`.
- Verification: `region-and-config.test.ts` — "assigns the rounding residual to the largest surviving role (B-049)" fails with the old positional rule and passes now; the equal-thirds rounding test updated to the largest-role residual.

### B-048 — DB-reading commands bypass `openDb` and duplicate path logic — FIXED

- Severity / Area: S3 / etl
- Steps to reproduce: run `pnpm etl aggregate` or `pnpm etl derive-roles` on a database whose `_migrations` table is behind the migration files.
- Expected / Actual: the command should refuse and tell the user to migrate first; instead it ran on a stale schema. Each DB-reading command also re-implemented path resolution instead of using `config/paths.ts`.
- Environment (OS, Node version, patch): any.
- Suspected cause: local `resolveDbPath()` copies and ad-hoc `new Database(...)` calls in `commands/aggregate.ts`, `commands/derive-roles.ts`, `commands/export.ts`, `commands/status.ts`.
- Fix (commit/ticket): `config/paths.ts` gained `DB_ENV_VAR`, `DEFAULT_DB_FILENAME` and `dbPathFromEnv()`; commands share it. `aggregate` opens via `openDb` and `derive-roles` opens read-only; both throw a `CliError` when `getMigrationStatus(db).pending > 0` ("Database schema is out of date (N pending migration(s)); run `pnpm etl migrate` first."). The aggregate output prints one summary line `Aggregated role probabilities: X row(s) for Y champion(s) written to role_prob.` instead of per-row lines.
- Verification: `commands/aggregate.test.ts` — "refuses to run on a database with pending migrations (B-048)" fails before (resolved instead of rejecting) and passes now.

### B-047 — Rune aggregation silently ignores a missing/invalid tags file — FIXED

- Severity / Area: S3 / etl
- Steps to reproduce: run `pnpm etl aggregate` with `data/manual/champion-tags.json` missing, unparseable, or failing `championTagsMapSchema`.
- Expected / Actual: the aggregation should fail loudly; instead `loadChampionTags()` swallowed every error and returned an empty map, degrading every enemy damage mix to `mixed` silently.
- Environment (OS, Node version, patch): any.
- Suspected cause: a bare `try { JSON.parse(readFileSync(...)) } catch { return new Map(); }`.
- Fix (commit/ticket): `AggregateRunesOptions.tagsPath` (default `data/manual/champion-tags.json`); the file is parsed and validated with `championTagsMapSchema`, and any failure throws `Cannot load champion tags from <path>: <reason>`.
- Verification: `aggregate-runes.test.ts` — "champion tags loading (B-047)": nonexistent path, invalid JSON and schema-invalid content all threw nothing before and throw now.

### B-046 — `derive-roles` keeps any role with probability > 0 — FIXED

- Severity / Area: S3 / etl
- Steps to reproduce: `deriveChampionRoles({ '412': { SUPPORT: 0.97, TOP: 0.03 } })`.
- Expected / Actual: roles should match the engine's candidate threshold; instead any probability > 0 kept the role (`['TOP', 'SUPPORT']` for a 3% TOP pick).
- Environment (OS, Node version, patch): any.
- Suspected cause: the derivation used `> 0` instead of the shared `roleProbThreshold`.
- Fix (commit/ticket): `deriveChampionRoles`/`applyDerivedRoles` keep roles with `prob >= minProb` (default `DEFAULT_RECOMMEND_CONFIG.roleProbThreshold`), canonical order; a champion with no qualifying role keeps its single highest-probability role.
- Verification: `derive-roles.test.ts` — "drops roles below the role-probability threshold (B-046)", "keeps the single highest-probability role when none reaches the threshold", "honors an explicit minimum probability"; all failed before and pass now.

### B-045 — CLI help lists `export` as planned and pads to ~117 chars — FIXED

- Severity / Area: S3 / etl
- Steps to reproduce: `pnpm etl help`.
- Expected / Actual: implemented commands should not appear under "Target state commands"; instead `export` (already implemented) was listed as planned, and the single-line layout padded every row to the longest usage (~117 chars).
- Environment (OS, Node version, patch): any.
- Suspected cause: stale `PLANNED_COMMANDS` entry and width-computed `padEnd` layout.
- Fix (commit/ticket): `PLANNED_COMMANDS` now lists only `backtest`; `formatHelp` uses a two-line layout (usage line, then a 6-space-indented description line) with no width computation. Stale `cli.ts` header: `DRAFTORB_DB_PATH` overrides the SQLite path for every database command.
- Verification: `commands/shared.test.ts` (new) — planned section lists `backtest` and not `export`, every implemented command appears, and each description sits on its own indented line.

### B-044 — Retry pass for unenriched matches is not awaited — FIXED

- Severity / Area: S2 / etl
- Steps to reproduce: seed a stored match with `enriched = 0` and 10 participants, call `await ingestMatches(...)`, and check `enriched` immediately after it resolves.
- Expected / Actual: the retry pass should finish before `ingestMatches` returns; instead `void reprocessUnenrichedMatches(...)` floated, so the match was still `enriched = 0` right after the await — and when `ingestMatches` owns the DB, the `finally` closes the connection under the running pass after its first network await.
- Environment (OS, Node version, patch): any.
- Suspected cause: fire-and-forget `void` on the async retry pass inside the `try`/`finally`.
- Fix (commit/ticket): `await reprocessUnenrichedMatches(...)` inside the `try`. Hard-coded `minChampGames` defaults (`30` in two places in `matches.ts`, `DEFAULT_MIN_CHAMP_GAMES` in `enrichment.ts`) now use `DEFAULT_CONFIG.minChampGames` from `@draftorb/engine`.
- Verification: `matches.test.ts` — "awaits the unenriched-match reprocess pass before returning (B-044)": `expected +0 to be 1` before the fix, passes now.

### B-043 — Ally role inference can assign the user's own role — FIXED

- Severity / Area: S2 / engine
- Steps to reproduce: `userRole = SUPPORT`, an unfixed ally whose roleProb prefers SUPPORT (e.g. Senna, `{SUPPORT: 0.6, ADC: 0.4}`), then call `recommend` and inspect the candidate's reasons.
- Expected / Actual: the ally must be inferred to its best non-user role (ADC) and produce its synergy reason; instead it was inferred SUPPORT, the ally self-role influence is `null` -> 0, and the synergy vanished (verified ~+9.26pp lost).
- Environment (OS, Node version, patch): any; engine-level bug, patch-independent.
- Suspected cause: `recommend` called `resolveKnownSlots(input.allies, ...)` -> `inferRoles` with all 5 roles available, so the user's occupied role was assignable to allies.
- Fix (commit/ticket): `inferRoles`/`resolveViableSubset`/`resolveKnownSlots` accept excluded/reserved roles; `recommend` passes `[userRole]` for the ally team (D-050). An ally fixed to `userRole` is dropped from role-dependent layers but still counts for comp and stays excluded from candidates.
- Verification: new unit tests in `roles.test.ts` and `recommend-slots.test.ts`, a recommend-level regression in `recommend-pairs.test.ts`, and golden fixture `support_ally_flex_reserved_role.json`; all failed before the fix and pass after.

### B-042 — Explicit patch exports can mislabel aggregates — FIXED

- Severity / Area: S3 / etl
- Expected / Actual: an explicit patch different from the latest stored match patch must warn that the aggregate data may not represent the requested patch; the exporter previously accepted the label silently.
- Fix (commit/ticket): exporter warns on the mismatch (T-019 review).

### B-041 — Backup cleanup failure reports a successful publish as failure — FIXED

- Severity / Area: S2 / etl
- Expected / Actual: once the new patch directory is published, a failure deleting the previous backup must not make the export appear unpublished; the backup must be retained and the cleanup issue surfaced as a warning.
- Fix (commit/ticket): `publishTempDir` returns a warning and keeps the backup; deterministic failure-injection test (T-019 review).

### B-040 — Explicit region suppresses mixed-platform warning — FIXED

- Severity / Area: S3 / etl
- Expected / Actual: aggregates combine all platforms regardless of the manifest region label, so the exporter must warn about mixed-platform data even when `--region` is explicit.
- Fix (commit/ticket): mixed-platform warning now explains that region labels do not filter data (T-019 review).

### B-039 — Role probability rounding can violate the sum invariant — FIXED

- Severity / Area: S3 / etl
- Expected / Actual: independently rounding each probability to six decimals could produce a sum outside the schema tolerance.
- Fix (commit/ticket): rounding residual is applied to the largest probability and the result is validated against the shared schema (T-019 review).

### B-038 — Rune exports merge rank buckets — FIXED

- Severity / Area: S2 / etl
- Expected / Actual: rank-weighted rune contexts must retain their source bucket; grouping only by context key and level combined distinct populations.
- Fix (commit/ticket): `rankBucket` is included in each context and its grouping key; manifest schema version is 3 (T-019 review, D-049 PROPOSED).

### B-037 — Pair exports serialize the row owner's role — FIXED

- Severity / Area: S2 / etl
- Expected / Actual: pair tuple role means the paired champion's role, but the exporter previously serialized `my_role`.
- Fix (commit/ticket): pair SQL selects and serializes `other_role` for ally and enemy tuples (T-019 review).

### B-036 — Catalog updates leave stale manifest checksums — FIXED

- Severity / Area: S2 / etl
- Steps to reproduce: export a patch, then run `pnpm etl static` or `pnpm etl derive-roles` for that patch.
- Expected / Actual: consumers must not see a manifest whose catalog hashes describe older content; catalog writers previously changed listed files without updating or invalidating the manifest.
- Environment (OS, Node version, patch): any, Node.js 22.
- Logs / screenshot: regression tests assert that static import and role derivation remove the existing manifest before updating catalogs.
- Suspected cause: catalog writers operated independently of the manifest created by export.
- Fix (commit/ticket): both catalog-writing paths now invalidate the patch manifest before changing catalog files (T-019 review).

### B-035 — Export removes static catalogs and role-derivation snapshots — FIXED

- Severity / Area: S2 / etl
- Steps to reproduce: import static data, run `derive-roles`, then export the same patch.
- Expected / Actual: exports must retain the Data Dragon catalogs and derivation snapshots; atomic publication previously replaced the whole patch directory with only statistical export files.
- Environment (OS, Node version, patch): any, Node.js 22.
- Logs / screenshot: exporter regression verifies catalog retention, catalog checksums, and preservation of bootstrap/derived snapshots.
- Suspected cause: staged export contents omitted pre-existing catalog and derivation files.
- Fix (commit/ticket): export copies available `champions.json`, `items.json`, and `runes.json` into the published tree and hashes them in the manifest; role snapshots are retained but are not manifest entries (T-019 review).

### B-034 — Export stale-file test assumes POSIX recursive path separators — FIXED

- Severity / Area: S3 / etl
- Steps to reproduce: run `pnpm vitest run packages/etl/src/export/atomic.test.ts` on Windows.
- Expected / Actual: the stale-file regression should compare the same relative file paths on every platform; Windows `readdirSync(..., { recursive: true })` returns backslash-separated relative paths, so the POSIX expected paths did not match.
- Environment (OS, Node version, patch): Windows, Node.js 22.
- Suspected cause: the test compared recursive `readdirSync` paths directly to slash-separated literals.
- Fix (commit/ticket): normalize recursive relative paths to forward slashes before asserting the exported file layout (T-019 verification follow-up).
- Verification: focused `atomic.test.ts` and `pnpm check`.

### B-035 — Export review findings (role-prob rounding, empty builds, publish cleanup, static catalogs) — FIXED

- Severity / Area: S2 / etl
- Steps to reproduce: export a champion with three equal role probabilities; export a champion whose build items all fail `exportMinGames`; make backup removal fail after publish; run `pnpm etl static <patch>` then `pnpm etl export <patch>`.
- Expected / Actual: probabilities should sum to 1 within 1e-6 (three `0.333333` values failed the shared schema); no build file for unqualified champions (an empty `contexts` file was emitted); a live publish should not be reported as failed (backup `rmSync` errors propagated); static catalogs should survive and be listed in the manifest (publishing replaced the patch directory and deleted them).
- Environment (OS, Node version, patch): any OS, Node.js 22.
- Suspected cause: independent rounding per role; no empty-contexts check in builds; backup removal inside `finally`; whole-directory publish ignored files owned by `pnpm etl static`.
- Fix (commit/ticket): residual assignment + schema validation in `role-prob.ts`; skip empty build files; post-publish cleanup returns a warning; static catalogs carried into the temp tree. Also added warnings for mixed-platform data with `--region` and for exporting a patch other than the database's latest (T-019 review follow-up).
- Verification: new tests in `atomic.test.ts`, `builds.test.ts`, `region-and-config.test.ts`; `pnpm check`.

### B-033 — Baseline `games` column not populated by ETL aggregation — FIXED

- Severity / Area: S3 / engine
- Steps to reproduce: run `pnpm etl aggregate` and inspect `baseline.games` — defaults to 0, `insufficientData.rawGames` never reported.
- Expected / Actual: the raw match count per baseline row should be populated so `insufficientData` can report sample size (SPECS §7, D-030 item 9).
- Fix (commit/ticket): T-016 — `aggregateBaseline` populates `wins_w`, `games_w`, `games_w2` and `games` (raw contributing match count) per (champion, my_role, rank_bucket) row; `games` defaults to 0 on empty tables and is exported as the 6th baseline column (migration 008).
- Verification: `packages/etl/src/aggregate-baseline.test.ts` asserts weighted counts and `n_eff` on toy data.

### B-032 — Reason level mapping drops strong positive effects and badges empty samples — FIXED

- Severity / Area: S3 / engine
- Steps to reproduce: call `mapDeltaPpToLevel(4.5, 50)` and `mapDeltaPpToLevel(1.1, 0)`.
- Expected / Actual:
  - Expected: `4.5@50` falls back to L1 (L2/L3 need `n_eff >= 100`); `1.1@0` is lowData and maps to 0 (SPECS §5).
  - Actual: `4.5@50` returned 0 (the L2/L3 branches exited before the L1 check); `1.1@0` returned +1 (the positive L1 branch ignored `n_eff`).
- Environment (OS, Node version, patch): any.
- Logs / screenshot: regression tests in `packages/engine/src/levels.test.ts` (`mapDeltaPpToLevel`).
- Suspected cause: early returns on the L2/L3 thresholds; no `minGames` input to the mapper.
- Fix (commit/ticket): T-022 review — `mapDeltaPpToLevel(deltaPp, nEff, minGames)` returns 0 for lowData (both signs), and positive deltas below 100 `n_eff` fall back to L1.

### B-031 — Pair and lane terms below `minGames` still alter scores — FIXED

- Severity / Area: S2 / engine
- Steps to reproduce: call `pairTerm(10, 10, 40, 0.5, eps)` with `minGames = 25`.
- Expected / Actual:
  - Expected: 0 (SPECS §5 low-data rule: a term with `n_eff < minGames` is 0).
  - Actual: a positive correction; only `gamesE <= 0` was gated.
- Environment (OS, Node version, patch): any.
- Logs / screenshot: regression tests in `packages/engine/src/levels.test.ts` (`pairTerm` at `minGames - 1` / `minGames`, TOP chain lowData fallback).
- Suspected cause: `pairTerm` had no `minGames` parameter; no gated lane-term helper existed.
- Fix (commit/ticket): T-022 review — added `isLowData`, a `minGames` parameter on `pairTerm`, and a gated `laneTerm`.

### B-030 — Enriched ranks not persisted to participant rows — FIXED

- Severity / Area: S2 / etl
- Steps to reproduce: run enrichment on a match with an unknown bot-lane participant whose rank is fetched via league-v4.
- Expected / Actual:
  - Expected: `participants.rank_score` for the fetched player is updated to the new rank_score.
  - Actual: only `players.rank_score` was updated; the `participants` row stayed NULL, leaving match-level rank averages inconsistent with per-participant rank data.
- Fix (commit/ticket): T-014 — added `updateParticipantRank` statement in `enrichment.ts`; `enrichBotLaneRanks` now writes the fetched rank_score (or NULL for unranked) into the corresponding participant row.

### B-029 — Champion game counts not refreshed on earlier match rows — FIXED

- Severity / Area: S3 / etl
- Steps to reproduce: ingest two matches with the same (puuid, champion) pair.
- Expected / Actual:
  - Expected: both participant rows for that (puuid, champion_id) have `champion_games` = 2 after the second match is stored.
  - Actual: the first row kept its stale count (1) because only the current match's row was updated.
- Fix (commit/ticket): T-014 — added `updateChampionGamesAll` statement; after the mastery loop, `enrichMasteryForParticipants` refreshes `champion_games` on every row for each (puuid, champion_id) pair.

### B-028 — Unranked players selected as ingestion seeds corrupt rank averages — FIXED

- Severity / Area: S2 / etl
- Steps to reproduce: cache an unranked bot-lane player (rank_score NULL in `players`), then run match ingestion.
- Expected / Actual:
  - Expected: unranked players are excluded from the seed list for match listing and their NULL score is never used in `rankSummary`.
  - Actual: the seed query selected all players regardless of NULL rank_score; a NULL score flowing into `rankSummary` was treated as 0, skewing `avg_rank_score` and inflating `rank_known_count` (and listing matches for players outside the ranked pool).
- Fix (commit/ticket): T-014 — the seed query in `matches.ts` now filters `rank_score IS NOT NULL`; `createRankLoader` (already in `matches-store.ts`) skips NULL entries when building the rank map, and `rankSummary` only counts known ranks.

### B-027 — Recommendation constants injectable via `RecommendConfig` — FIXED

- Severity / Area: S3 / engine
- Expected / Actual: `W_COMP`, `W_BLIND`, `BLIND_WORST_CASE_FACTOR`, `HARD_COUNTER_DELTA_PP` and `LANE_GROUPS` were module constants; they must be injectable via `RecommendConfig` for T-027.a tuning.
- Fix (commit/ticket): T-023 — all five moved to `RecommendConfig`/`DEFAULT_RECOMMEND_CONFIG`. (Moved here from the Open table where it was already marked FIXED; see the duplicate-ID note above.)

### B-027 — Transient enrichment failures become permanent gaps (no retry on duplicates) — FIXED

- Severity / Area: S2 / etl
- Steps to reproduce: store a match, then have a mastery or rank HTTP call fail transiently (429/5xx) during `enrichParticipants`.
- Expected / Actual:
  - Expected: the next ingestion run re-attempts enrichment for the stored match.
  - Actual: `persistAcceptedMatch` committed the match and cursor before enrichment; on retry the match hit the duplicate branch which skipped enrichment entirely, so NULL `mastery_points`/`rank_score` were never recovered.
- Fix (commit/ticket): T-014 — migration 007 adds an `enriched` flag to `matches` (default 0); `processMatch` runs enrichment after storing and marks the match enriched only when `summary.failures === 0`; the duplicate path checks `enriched` and re-runs enrichment (loading participants from storage) for any match that was not fully enriched.

### B-026 — Engine `shrink()` returns NaN for empty contexts with zero prior strength — FIXED

- Severity / Area: S3 / engine
- Steps to reproduce: call `shrink(0, 0, 0, 0.55)` (or any zero-prior-strength empty context).
- Expected / Actual:
  - Expected: returns the prior `q` (0.55), the sensible fallback when there is no evidence and no prior strength.
  - Actual: `shrink` computed `(0 + 0 * 0.55) / (0 + 0) = 0 / 0 = NaN`; a valid zero-strength config could poison predictions for empty contexts.
- Environment (OS, Node version, patch): any.
- Logs / screenshot: regression test added in `packages/engine/src/weighting.test.ts` — "returns the prior q when both evidence and prior strength are zero".
- Fix (commit/ticket): T-020 — `shrink` now returns `q` when `gamesE + k <= 0` before dividing. No other bugs were identified during T-020 session.

### B-016 — Bug ID B-007 is used for two different fixed bugs — FIXED

- Severity / Area: S4 / docs
- Steps to reproduce: search `docs/BUGS.md` for `### B-007`.
- Expected / Actual:
  - Expected: every bug has a unique ID.
  - Actual: "Seed rank was excluded from rank reliability counts" and "Invalid match responses left the ingestion cursor stuck" both used B-007.
- Environment (OS, Node version, patch): n/a.
- Logs / screenshot: n/a.
- Suspected cause: two parallel branches (PR B and PR C) each picked the next free ID.
- Fix (commit/ticket): B-016 — kept B-007 for "Seed rank was excluded from rank reliability counts"; renumbered the duplicate to B-025 ("Invalid match responses left the ingestion cursor stuck") with the title note "(formerly a duplicate B-007)"; removed B-016 from the Open table and Open detailed section. `pnpm check` not affected (docs-only change).

### B-011 — Shared reason and rank-bucket schemas diverge from SPECS §3/§7 (T-002.b scope expanded to include them) — FIXED

- Severity / Area: S2 / shared
- Steps to reproduce: compare `reasonSchema`, `manifestSchema.rankBuckets` and `supportPairEntrySchema` in `packages/shared/src/index.ts` with SPECS §3 and §7, then with the T-002.b scope in TICKETS.md.
- Expected / Actual:
  - SPECS §7: `Reason.with` should be `ChampionId[]` (a `lane` reason references the lane-group champions, two for `lane_vs` and three for `lane_full`) and `Reason.lowData: boolean` should be present; the schema has a single optional `with: ChampionId` and no `lowData`.
  - SPECS §3: rank buckets merge MASTER, GRANDMASTER and CHALLENGER into one bucket; `rankBuckets` and the pair-entry bucket use the 10-value `rankSchema` instead of the 8 buckets.
  - T-002.b adds the `lane` reason type, `games_w2`, `insufficientData` and the pool fields, but none of the above, so the engine (T-023) cannot emit a valid `lane` reason even after T-002.b.
  - To clarify in SPECS: `Reason.n` and `reliability.games` are integers in the schema, while every threshold uses a real-valued `n_eff`; state whether these fields carry raw games or `n_eff`.
- Environment (OS, Node version, patch): n/a (contract).
- Logs / screenshot: n/a.
- Suspected cause: T-002 predates D-021; the T-002.b parity list (D-011) was written from the new export layout, not from SPECS §7.
- Fix (commit/ticket): spec + T-002.b scope; implementation in T-002.b. Resolved three owner choices (D-027): `Reason.n` and `Recommendation.reliability.games` carry `n_eff` (a real number); the merged apex bucket is `MASTER_PLUS`; `role-prob.json` is sparse (`z.partialRecord` in zod 4) with probabilities summing to 1 per champion (tolerance 1e-6). SPECS §3 now defines the 8 buckets and states exports + manifest use them; SPECS §7 states `n`/`games` carry `n_eff`; DATA_MODEL documents the sparse role-prob shape, zod-4 `z.partialRecord` requirement, and the sum-to-1 invariant; T-002.b scope and acceptance now include `Reason.with: ChampionId[]`, `Reason.lowData`, `rankBucketSchema`, the role-prob shape, and the sum check.

### B-015 — Node 20 is documented as supported but better-sqlite3 segfaults on Node 20 — FIXED

- Severity / Area: S3 / etl
- Steps to reproduce: on Node 20, run `pnpm test` (any test that opens SQLite) or directly load `better-sqlite3`: `node -e "require('better-sqlite3')"` from the `packages/etl` directory.
- Expected / Actual: before this fix, the project documents Node 20 as supported (AGENTS.md "Node.js 20+", SETUP.md "Node.js 20 LTS+", root `engines` `>=20.0.0`) / on Node 20.20.2, loading `better-sqlite3@13.0.3` segfaults with exit code 139 (`SIGSEGV`). The `better-sqlite3` 13.x release declares `engines.node: >=22` and ships no prebuilt binary compatible with Node 20. Node 22 works correctly: `pnpm check` passes all 141 tests.
- Environment (OS, Node version, patch): macOS, Node 20.20.2 and Node 22.23.4, `better-sqlite3` 13.0.3.
- Logs / screenshot: direct `node -e "require('better-sqlite3')"` from `packages/etl` exits with code 139 on Node 20; `pnpm check` passes on Node 22 (15 test files, 141 tests passed).
- Suspected cause: `better-sqlite3` 13.x prebuilt binary / N-API mismatch for Node 20.
- Fix (commit/ticket): B-015 — Applied the owner's Node policy [B] (require Node 22): raised `engines.node` to `>=22.0.0` in `package.json`; updated AGENTS.md rule 2 to "Node.js 22+"; updated docs/SETUP.md (Prerequisites, Troubleshooting) and docs/ARCHITECTURE.md (Stack); aligned `@types/node` from `^26.x` to `^22.x` to match the Node 22 minimum; kept CI on Node 22 only with `node-version: ${{ matrix.node-version }}`; recorded D-026 and the D-025 correction in DECISIONS.md. Verified `pnpm check` passes on Node 22. Node 20 is no longer a supported runtime.

### B-024 — Engine purity ESLint guard has no regression test — FIXED

- Severity / Area (engine|etl|web|desktop|vision|docs): S4 / engine, docs
- Steps to reproduce: remove a restricted global (e.g. `process`) from the `no-restricted-globals` rule in `eslint.config.mjs`, then run `pnpm lint` and `pnpm test`.
- Expected / Actual:
  - Expected: an automated test catches the regression and fails CI.
  - Actual: no test exercised the ESLint purity guards, so CI stayed green even after the temporary `process.cwd()` probe was removed during the B-017 fix session.
- Environment (OS, Node version, patch): any.
- Logs / screenshot: none prior to this fix.
- Suspected cause: the B-017 fix verified purity by hand with a throwaway probe in `packages/engine/src/hello.ts` that was deleted before commit, leaving no automated regression test.
- Fix (commit/ticket): B-024 — added `packages/engine/src/lint-regression.test.ts`, a vitest suite that writes fixture files into `packages/engine/src/__lint_test__/`, lints them via the ESLint Node API, and asserts the specific `ruleId` of each error: `no-restricted-imports` for bare `crypto`/`net`/`node:crypto` imports (B-022, with the imported symbols used to avoid false positives from `no-unused-vars`); `no-restricted-syntax` for `Date()` and `new Date()` (B-023); `no-restricted-globals` for `process.cwd()` and `no-restricted-properties` for `Math.random()` (B-017); and a pure `add(a, b)` function produces zero errors (guards against overblocking). Added ESLint test-file overrides so `*.test.ts` files in engine/shared are not subject to the production purity rules. `pnpm check` — 15 test files, 141 tests passed.

### B-023 — Unseeded `Date()` call escapes the engine lint guard — FIXED

- Severity / Area (engine|etl|web|desktop|vision|docs): S3 / engine
- Steps to reproduce: add `export const probe = Date();` to a file in `packages/engine/src`, then run `pnpm lint`.
- Expected / Actual:
  - Expected: `Date()` (a call expression returning the current time as a string) is rejected by the engine purity rules.
  - Actual: the `no-restricted-syntax` rule only matched `NewExpression[callee.name='Date'][arguments.length=0]` (i.e. `new Date()`), so the zero-argument `Date()` call passed both lint and typecheck, allowing non-deterministic time access in an engine that must produce identical outputs for identical inputs.
- Environment (OS, Node version, patch): any.
- Logs / screenshot: before the fix, `Date()` produced no lint error; `new Date()` was already rejected.
- Suspected cause: the selector only covered the `new Date()` form, not the `Date()` call form.
- Fix (commit/ticket): B-023 — added a `CallExpression[callee.name='Date'][arguments.length=0]` selector with the same purity message to the `no-restricted-syntax` rule in `eslint.config.mjs`. Verified by the regression test in B-024. `pnpm check` — green.

### B-022 — Bare Node built-in imports escape the engine guard — FIXED

- Severity / Area (engine|etl|web|desktop|vision|docs): S2 / engine
- Steps to reproduce: add `import { createHash } from "crypto";` to a file in `packages/engine/src`, then run `pnpm lint`.
- Expected / Actual:
  - Expected: any bare Node built-in import specifier (e.g. `crypto`, `net`, `tls`, `events`) and any `node:*` import is rejected by `no-restricted-imports`.
  - Actual: the pattern list only covered `node:*` (the `node:` prefix form) plus a handful of manually listed bare names (`fs`, `fs/*`, `path`, `os`, `child_process`, `http`, `https`, `better-sqlite3`). A bare `crypto` import was not in the list, so `import { createHash } from "crypto"` passed lint while also type-checking (Node typings reach the engine through Vitest, see B-021).
- Environment (OS, Node version, patch): any.
- Logs / screenshot: before the fix, `import { createHash } from "crypto"` produced no lint error; after the fix it reports `no-restricted-imports`.
- Suspected cause: the pattern list was a manual subset, not the complete set of Node built-in modules.
- Fix (commit/ticket): B-022 — replaced the manual subset with a comprehensive list of every Node built-in module specifier in both forms (`module` and `module/*` for subpaths, plus `node:*` for the prefix form) in the `no-restricted-imports` rule for both `packages/engine/**/*.ts` and `packages/shared/**/*.ts`. The list covers `assert`, `async_hooks`, `buffer`, `child_process`, `cluster`, `console`, `constants`, `crypto`, `dgram`, `diagnostics_channel`, `dns`, `domain`, `events`, `fs`, `http`, `http2`, `https`, `inspector`, `module`, `net`, `os`, `path`, `perf_hooks`, `process`, `punycode`, `querystring`, `readline`, `repl`, `stream`, `string_decoder`, `sys`, `timers`, `tls`, `trace_events`, `tty`, `url`, `util`, `v8`, `vm`, `wasi`, `worker_threads`, `zlib`, and `better-sqlite3`. Verified by the regression test in B-024. `pnpm check` — green.

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

### B-025 — Invalid match responses left the ingestion cursor stuck (formerly a duplicate B-007) — FIXED

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

## Review history

Review notes moved verbatim from the top of this file (docs audit cleanup, 2026-11-04).

T-023 review (2026-10-30) fixed in-PR: blind safety firing on every 1v1 role, blind safety re-scoring known enemies, unknown pool ids being scored, role-inference failure dropping a whole team, raw-winrate hard-counter warning, missing `W_comp`/`W_blind`, engine magic numbers outside `config.ts`, missing level 0 for lowData reasons (`reasonLevelSchema` now includes 0, SPECS §7), board-picked pool champions now reported as `poolUnavailable` `picked`, hard-counter warnings emitted as codes (`counteredBy:<ROLE>:<id>`), `rawGames` optional (omitted when unknown instead of a fake 0).

T-018 review (2026-11-01) fixed in-PR: lane `context_level` now depends only on the slot count (TOP 1-slot and partial-lane keys get level 3, same as 1-slot back-offs; no match-order dependence); migration 010 backfills `context_level` from `context_key` for existing rows. Mastery fallback (`minMasteryPoints`) and rank-based `expertWeight` per user rank bucket (migration 011 adds `rune_ctx.rank_bucket`) are now applied (D-036 update).

T-017 review (2026-11-01) fixed in-PR: `aggregatePairTables` buffered every stored match's participants before aggregating; it now streams rows ordered by `match_id` and aggregates each match as soon as it is complete. A ten-player match test was added. No other new bugs were identified during T-017.

T-015 review (2026-10-31) fixed in-PR: `role_prob` mixed participants from all stored patches; aggregation now filters by a target patch (default: the patch of the most recent match). No other new bugs were identified during T-015.

No new bugs were identified during the D-016 formula confirmation; player discovery remains within the current ETL scope.

No new bugs were identified during T-013 (match ingestion); rejected match ids are tracked by design in `match_rejects`, not as bug candidates.

No new bugs were identified while revising T-013 patch-window and rank-known-count behavior.

T-019 review follow-up found export regressions in paired-role serialization, rank-specific rune grouping, probability rounding, warnings, and post-publish backup cleanup; these are recorded as B-037 through B-042 below and fixed in this pass.
