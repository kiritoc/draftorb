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
- Branch/PR: `docs/github-issue-tracking` / PR #115
- State: REVIEW
- Done: process docs and GitHub issues aligned after the backlog moved to GitHub issues + the Draftorb project board; ticket issue form added; missing plan issues created; project fields (Status/Milestone/Size/Owner decision needed) set up.
- Files touched: `AGENTS.md`, `.github/ISSUE_TEMPLATE/ticket.yml`, `.github/pull_request_template.md`, `docs/{REVIEW_CHECKLIST,PROGRESS,TICKETS,PROMPTS,PROGRESS_ARCHIVE}.md`.
- Tests: docs-only; run `pnpm check` before merge.
- Blockers / next step: owner reviews the PR; then BL-001 (#67) writes D-110..D-114.
- Pitfalls: `docs/TICKETS.md`, `docs/PROMPTS.md`, `docs/PROGRESS.md`, `docs/PROGRESS_ARCHIVE.md` and `docs/BACKLOG.md` were deleted by the merge of PR #66; this PR restores the four tracking files (BACKLOG stays deleted — GitHub issues are the tracker). Issue bodies still pointing at `docs/BACKLOG.md` are reported as non-conforming in the PR description.

## Session log (newest first)

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
