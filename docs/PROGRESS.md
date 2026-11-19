# PROGRESS

Live handoff log for DraftOrb. Newest entries first. Historical session logs live in `docs/PROGRESS_ARCHIVE.md`; task tracking lives in GitHub issues and the Draftorb project board.

## Handoff template

- Date:
- Branch/PR:
- State: TODO | DOING | REVIEW | DONE | BLOCKED
- Done:
- Files touched:
- Tests:
- Blockers / next step:
- Pitfalls:

## Current handoff

- Date: 2026-11-17
- Branch/PR: `feat/bl-010a-desktop-scaffold` (local only, not pushed) / BL-010a (#72), skeleton part
- State: REVIEW
- Done: `apps/desktop` is now the app skeleton: React 19 + Tailwind 3 frontend (`ui/src`), header with patch/data status placeholder, "Unvalidated model" label and theme toggle, navigation (Pick enabled, Setup/Game disabled, Settings), SUPPORT-only role selector driven by `roleAvailability`, D-107 theme plumbing, zod-validated settings stored by the program (`load_settings`/`save_settings` Rust commands, atomic write in the app config dir). Restrictive CSP in `tauri.conf.json`. `report_metrics`/`process_uptime_ms` kept for `scripts/bench.ts`. `@tauri-apps/api` recorded in D-116.
- Files touched: `apps/desktop/**`, `vitest.config.ts`, `pnpm-lock.yaml`, `docs/{SETUP,ARCHITECTURE,DECISIONS,PROGRESS}.md`.
- Tests: `pnpm check`; `cargo test` in `apps/desktop/src-tauri`.
- Blockers / next step: remaining for BL-010a: Windows 11 launch and threshold re-measure with the real app, data status and download/cache/stale notice (BL-010b, needs the BL-004 host and a `connect-src` CSP entry), BL-014 pick-screen behavior, Windows CI job (BL-003).
- Pitfalls: `gen:icon` now also writes `icons/icon.png` (non-Windows builds need it). The bench script is Windows-only (taskkill, PowerShell).

### Previous handoff

- Date: 2026-11-17
- Branch/PR: `chore/bl-008-ci-safety` (local only, not pushed) / BL-008 (#111)
- State: REVIEW
- Done: `scripts/check-secrets.mjs` gains a `PUUID-like identifier` needle (78 base64url chars with a letter and a digit, `+/=` excluded at the boundaries); the synthetic PUUID in `packages/etl/src/riot/client.test.ts` is split by concatenation. New `scripts/check-public-paths.mjs` (`profiles/` directories and SQLite files; git ls-files or `--dir`) and `scripts/check-pr-title.mjs` (`BL-<n>[a-z]` from `PR_TITLE`). New CI job `safety` (pull_request only, not Dependabot). Documented in WORKFLOW.md and TESTING.md.
- Files touched: `scripts/check-{secrets,public-paths,pr-title}.{mjs,test.ts}`, `packages/etl/src/riot/client.test.ts`, `.github/workflows/ci.yml`, `docs/{WORKFLOW,TESTING,PROGRESS}.md`.
- Tests: `pnpm check`; each script has fixture-violation tests.
- Blockers / next step: the `safety` job can only be proven green once pushed. BL-004 must run `check-public-paths.mjs --dir` on the public aggregates tree. Bug-fix PRs titled only with `B-xxx` fail the title check by design of the ticket criterion; raise with the owner.
- Pitfalls: do not wire `--dir` into `etl.yml`: the state tarball (private) intentionally contains `profiles/`.

### Previous handoff (BL-012)

- Date: 2026-11-17
- Branch/PR: `feat/bl-012-bans-engine` (local only, not pushed) / BL-012 (#75), schema + engine part
- State: REVIEW
- Done: `draftInputSchema.bans` (max 10, unique, banned-and-picked rejected with the champion id), `poolUnavailable` reason `banned`, `DRAFT_RESULT_SCHEMA_VERSION` 1 -> 2. Engine: `buildCandidateSet` excludes banned champions (picked wins over banned) and exposes `banned`; pool entries report `banned`; the unseen blind opponents exclude picked and banned champions. No scoring math or config change. SPECS §2/§4/§5/§7/§7.1 updated.
- Files touched: `packages/shared/src/schemas/{core,draft}.ts`, `packages/shared/test/{index,parity}.test.ts`, `packages/engine/src/{recommend,recommend-pool,recommend-test-utils}.ts`, `packages/engine/test/recommend-bans.test.ts`, `docs/{SPECS,PROGRESS}.md`.
- Tests: `pnpm check`; new `recommend-bans.test.ts` written red first.
- Blockers / next step: the UI part of BL-012 (manual bans input, UI test) remains for after BL-010a; legacy `apps/web` has no bans UI.
- Pitfalls: any consumer pinning `DraftResult.schemaVersion` to 1 must move to 2.

### Previous handoff (BL-005)

- Date: 2026-11-17
- Branch/PR: `chore/bl-005-delete-joint-model` (local only, not pushed) / BL-005 (#71)
- State: REVIEW
- Done: deleted the joint draft model per D-112 (gates D-092/D-092a failed, no consumer): `packages/engine/src/joint/` and its index re-export, `packages/etl/src/joint-fit.ts`, `commands/fit-model.ts` and its CLI registration, `packages/engine/test/joint.test.ts`. Fixed stale docs: ARCHITECTURE.md (status, `latest.json`, Electron -> Tauri D-115), DATA_MODEL.md (aggregates for all roles), GLOSSARY.md (`exportMinGames` default 10), PLAN_SUMMARY.md (shell language resolved by D-115), CONVENTIONS.md (theme D-107, storage D-101/D-114), proposed-etl-schedule.md (D-094 note).
- Files touched: `packages/engine/src/{index.ts,joint/}`, `packages/engine/test/joint.test.ts`, `packages/etl/src/{cli.ts,joint-fit.ts,commands/fit-model.ts}`, `docs/{ARCHITECTURE,DATA_MODEL,GLOSSARY,PLAN_SUMMARY,CONVENTIONS,proposed-etl-schedule,PROGRESS}.md`.
- Tests: `pnpm check`.
- Blockers / next step: owner review; branch is local only.
- Pitfalls: historical mentions of joint/`fit-model` remain on purpose in DECISIONS.md, AUDIT.md, PROGRESS_ARCHIVE.md, TICKETS.md, PROMPTS.md and docs/reports/.

### Previous handoff (BL-002)

- Date: 2026-11-16
- Branch/PR: `feat/bl-002-tauri-spike` / BL-002 PR (this PR)
- State: REVIEW
- Done: BL-002 Windows Tauri spike — new `apps/desktop/` (Tauri v2 shell + Vite/TS frontend running a real `recommend()` on the `full_draft_support` golden fixture), `scripts/bench.ts` benchmark, `scripts/gen-icon.ts` icon generator, report `docs/reports/bl-002-tauri-spike.md` (median cold start 362 ms external / 330 ms Rust-side after paint, engine call 0.089 ms avg, idle memory 349 MB — all inside the AUDIT §6 estimates; GO recommendation for D-115, owner confirmation lines left blank), dependency decision D-116, project board BL-001 moved to Done.
- Files touched: `apps/desktop/**`, `docs/{DECISIONS,PROGRESS,reports/bl-002-tauri-spike}.md`, `eslint.config.mjs`, `tsconfig.json`, `.gitignore`, `pnpm-lock.yaml`; project board.
- Tests: `pnpm check` green (1237 tests); benchmark numbers in the report.
- Blockers / next step: owner reviews the PR and fills the confirmation lines in the spike report (thresholds + GO/NO-GO for D-115); then BL-003 (#69) Windows CI job and BL-004 (#70) public aggregates.
- Pitfalls: plain `cargo build` produces a DEV-mode Tauri app (loads `devUrl`, ERR_CONNECTION_REFUSED without a dev server) — production binary needs `pnpm --filter @draftorb/desktop tauri build`; `tauri-build` requires `src-tauri/icons/icon.ico` on Windows even with `bundle.active: false`; Rust `target/` and `src-tauri/gen/` are gitignored; scripts are `.ts` run via `tsx` (not `.mjs`) to stay inside the TS project service.

## Session log (newest first)

### 2026-11-16 — Devin — BL-002 Windows 11 Tauri spike + benchmark report

- Done:
  - Scaffolded `apps/desktop/`: `src-tauri/` minimal Tauri v2 app (two commands: `process_uptime_ms`, `report_metrics`), `ui/` Vite + vanilla TS frontend importing `@draftorb/engine` + `@draftorb/shared`, zod-validating `ui/src/fixture.json` (input+data of golden `full_draft_support`) and rendering top-10 `recommend()` output; `scripts/bench.ts` (5-run cold-start/engine-latency/idle-memory benchmark) and `scripts/gen-icon.ts` (PNG-in-ICO generator, tauri-build requirement).
  - Installed Rust toolchain (rustup 1.100.0, MSVC via VS 2022 Community already present); release exe ~9 MB, frontend bundle 128 kB JS / 37.6 kB gzip.
  - Measurements (median of 5): external cold start 362 ms, Rust-reported start→interactive 330 ms (paint-aware via double rAF), `recommend()` avg 0.089 ms (200 iters), idle memory 349 MB across 7 processes (draftorb.exe + WebView2 children).
  - Wrote `docs/reports/bl-002-tauri-spike.md` with methodology, proposed thresholds (cold start <1.5 s, recommend <5 ms, memory <450 MB on real data), GO recommendation for D-115, and blank owner-confirmation lines; added D-116 (Tauri/vite deps) to DECISIONS.md.
  - Fixed lint/typecheck integration: desktop scripts are `.ts` via `tsx`, `**/target/**` eslint-ignored, `apps/desktop` added to root tsconfig references.
- Files touched: `apps/desktop/**`, `docs/{DECISIONS,PROGRESS,reports/bl-002-tauri-spike}.md`, `eslint.config.mjs`, `tsconfig.json`, `.gitignore`, `pnpm-lock.yaml`; GitHub project board (BL-001 → Done).
- Tests: `pnpm check` green — typecheck, lint (0 errors), prettier, 1237 vitest tests.
- State left: REVIEW — awaiting owner review of the PR and the spike report confirmation lines.
- Next step: owner confirms thresholds/GO-NO-GO in the report; then BL-003 (#69) Windows CI job, BL-004 (#70) public aggregates release.
- Pitfalls / notes for next AI: `cargo build` alone = dev-mode app (ERR_CONNECTION_REFUSED); use `pnpm tauri build`. Re-run `bench.ts` with real `data/public/` exports once available — fixture is only 6 kB.

## Session log (newest first)

### 2026-11-15 — Devin — BL-001 decisions D-111..D-115 and AGENTS.md language/shell update

- Done:
  - Appended D-111 (shared aggregates public), D-112 (delete joint draft model code), D-113 (keep raw data and ETL timeline extraction), D-114 (public versioned champion pool file `data/pool.config.json`) and D-115 (TypeScript engine + Tauri shell) to `docs/DECISIONS.md`, each ACCEPTED (owner, 2026-11-15) with an Amends line where the decision map specified one; added the status-header notes ("amended by" / "code deleted by D-112") on D-001, D-079, D-092, D-092a, D-098, D-099, D-101 and D-109 without touching any decision body.
  - AGENTS.md: golden rule 2 now states the Windows desktop program is a Tauri shell around the TypeScript engine (D-115) pending the spike; golden rule 4 keeps every ETL/engine requirement and adds the Rust-toolchain exception scoped to the desktop shell only; repo layout `apps/desktop` line updated from Electron to Tauri.
  - GOALS.md platform line and open items updated (language D-115 pending spike, aggregates location D-111, pool versioning D-114 resolved; Riot policy and patch display still open); REVIEW_CHECKLIST.md Windows bullet now states the final D-115 rule.
  - Issues #67, #68, #69 renumbered after the owner confirmation comment on #67: language/shell decision D-110 -> D-115, range D-110..D-114 -> D-111..D-115; the AGENTS.md rule-4 amendment text moved from the D-110 bullet to the D-115 bullet in #67.
- Files touched: `docs/{DECISIONS,GOALS,REVIEW_CHECKLIST,PROGRESS}.md`, `AGENTS.md`; GitHub issues #67, #68, #69.
- Tests: docs-only change; `pnpm check` run before merge.
- State left: REVIEW — awaiting owner review.
- Next step: owner merges the PR; then BL-002 (#68) Windows Tauri spike and the aggregates-publishing ticket (D-111 host).
- Pitfalls / notes for next AI: D-110 is the ETL snapshot-integrity decision (PR #116, B-070); the language decision is D-115 — older entries saying "BL-001 writes D-110..D-114" are outdated, the real range is D-111..D-115. D-114 records the owner quote "Oui, on peut versionner le pool"; D-115 records "Les perfs uniquement, mais je serai toujours à temps de changer plus tard."

### 2026-11-15 — Devin — Backlog ticket prefix `B-` → `BL-`

- Done: renamed the backlog ticket prefix from `B-xxx` to `BL-xxx` to disambiguate from bug IDs (`B-xxx` in `docs/BUGS.md`). Retitled all 48 backlog issues (#67–#114) and rewrote their bodies (`Ticket ID:`, `#nn (B-xxx)` refs, `B-xxx`/`B-id` generics); verified no bug references were touched (issue #8 keeps its bug refs). Updated `.github/ISSUE_TEMPLATE/ticket.yml`, `.github/pull_request_template.md`, `docs/PROGRESS.md`, `docs/REVIEW_CHECKLIST.md`; added the `B-`/`BL-` namespace note to `docs/BUGS.md`. Historical docs (`TICKETS.md`, `PROGRESS_ARCHIVE.md`, bug entries) keep `B-xxx` = bugs.
- Files touched: `.github/ISSUE_TEMPLATE/ticket.yml`, `.github/pull_request_template.md`, `docs/{BUGS,PROGRESS,REVIEW_CHECKLIST}.md`; GitHub issues #67–#114.
- Tests: docs-only; `pnpm check` before merge.
- State left: REVIEW.
- Pitfalls / notes for next AI: backlog ticket IDs are `BL-xxx` (GitHub issues), bug IDs are `B-xxx` (`docs/BUGS.md`). New tickets must use `BL-` in the title and `Ticket ID:` field.

### 2026-11-15 — Devin — GitHub issue/project tracking alignment

- Done:
  - Restored `docs/TICKETS.md`, `docs/PROMPTS.md`, `docs/PROGRESS.md` and `docs/PROGRESS_ARCHIVE.md` (deleted by the PR #66 merge) with OBSOLETE banners on TICKETS/PROMPTS pointing to GitHub issues; `docs/BACKLOG.md` stays deleted.
  - Added the "Tickets" section to `AGENTS.md` (read the issue first; acceptance criteria are the contract; decisions go to DECISIONS.md as PROPOSED).
  - Added `.github/ISSUE_TEMPLATE/ticket.yml`, updated `.github/pull_request_template.md` (`Closes #___`, ticked acceptance criteria with evidence) and `docs/REVIEW_CHECKLIST.md` (exact PROPOSED list, Closes #n, D-023 backtest citations, Riot-policy GO gate, reviewer file list).
  - GitHub side: created missing plan issues, set project fields (Status, Milestone, Size, Owner decision needed), edited BL-005/BL-014/BL-023/BL-018/BL-013a/BL-043a/BL-044a/BL-044b/BL-043b per owner instructions; conformity and migration-loss reports are in the PR description.
- Files touched: `AGENTS.md`, `.github/ISSUE_TEMPLATE/ticket.yml`, `.github/pull_request_template.md`, `docs/{REVIEW_CHECKLIST,PROGRESS,TICKETS,PROMPTS,PROGRESS_ARCHIVE}.md`.
- Tests: docs-only change; `pnpm check` run before merge.
- State left: REVIEW — awaiting owner review.
- Next step: owner merges the PR, then BL-001 (#67) writes D-110..D-114.
- Pitfalls / notes for next AI: GitHub issues are the ticket tracker; `docs/BACKLOG.md` is gone — issue bodies that still reference it are listed as non-conforming in the PR description. Do not implement D-110..D-114 before BL-001 records them.

### 2026-11-15 — Devin — BL-000 backlog and review process

- Done:
  - Added `docs/BACKLOG.md` as the authoritative rework backlog with BL-000 marked DONE and explicit `Status` fields for every ticket/sub-ticket.
  - Moved the owner-approved D-114 pool-versioning text into BL-001 so BL-001 writes D-110..D-114 without a numbering gap; removed the premature D-114 entry from `docs/DECISIONS.md`.
  - Reverted the premature AGENTS.md rule-4/Rust amendment; BL-001 now owns that edit when D-110 is written.
  - Updated live docs (`AGENTS.md`, `README.md`, `docs/WORKFLOW.md`, `docs/SETUP.md`, `docs/REVIEW_CHECKLIST.md`, `docs/AUDIT.md`) to point to `docs/BACKLOG.md`; marked `docs/TICKETS.md` and `docs/PROMPTS.md` OBSOLETE with deletion deferred.
  - Archived the previous PROGRESS.md content into `docs/PROGRESS_ARCHIVE.md` and restarted this file as the live handoff log.
  - Tightened BL-005's deletion grep and BL-014's D-023 validation-gate acceptance criteria.
- Files touched: `AGENTS.md`, `README.md`, `docs/{AUDIT,BACKLOG,DECISIONS,PROGRESS,PROGRESS_ARCHIVE,PROMPTS,REVIEW_CHECKLIST,SETUP,TICKETS,WORKFLOW}.md`.
- Tests: docs-only change; `pnpm check` green (111 files / 1237 tests; lint 0 errors, 120 pre-existing warnings; Prettier clean).
- State left: REVIEW — awaiting owner review of PR #66.
- Next step: owner merges PR #66, then BL-001 writes D-110..D-114.
- Pitfalls / notes for next AI: `docs/BACKLOG.md` is authoritative for ticket status; GitHub issues are snapshots and any project board is a view only. Do not implement D-110..D-114 before BL-001 records them.
