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

- Date: 2026-11-15
- Branch/PR: `docs/bl-001-decisions-d111-d115` / BL-001 PR (this PR)
- State: REVIEW
- Done: recorded the five owner decisions of 2026-11-15 as D-111..D-115 in `docs/DECISIONS.md` (D-110 was already taken by the ETL snapshot-integrity decision, merged in PR #116 / ticket B-070); applied the D-115 AGENTS.md edits (rule 2 language, rule 4 Rust-toolchain exception scoped to the desktop shell, repo layout `apps/desktop` = Tauri); updated GOALS.md platform line and open items, REVIEW_CHECKLIST.md Windows rule; renumbered the language decision D-110 -> D-115 in issues #67, #68 and #69 after the owner confirmation comment on #67.
- Files touched: `docs/{DECISIONS,GOALS,REVIEW_CHECKLIST,PROGRESS}.md`, `AGENTS.md`; GitHub issues #67, #68, #69.
- Tests: docs-only; run `pnpm check` before merge.
- Blockers / next step: owner reviews the PR; then BL-002 (#68) runs the Windows Tauri spike that validates D-115 against owner-confirmed thresholds, and the aggregates-publishing ticket decides the public host for D-111.
- Pitfalls: D-110 is the ETL state-upload decision (PR #116, ticket B-070) — do not reuse that id; the language/shell decision is D-115. Older log entries that say "BL-001 writes D-110..D-114" are outdated: the real range is D-111..D-115 (D-110 was already taken when BL-001 ran).

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
