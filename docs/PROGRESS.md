# PROGRESS

Live handoff log for DraftOrb. Newest entries first. Historical session logs live in `docs/PROGRESS_ARCHIVE.md`; the authoritative backlog is `docs/BACKLOG.md`.

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
- Branch/PR: `docs/rework-backlog` / PR #66
- State: REVIEW
- Done: B-000 backlog and review process; PR #66 review fixes (D-114 moved into B-001, statuses added, docs pointed to BACKLOG, PROGRESS reset).
- Files touched: `AGENTS.md`, `README.md`, `docs/{AUDIT,BACKLOG,DECISIONS,PROGRESS,PROGRESS_ARCHIVE,PROMPTS,REVIEW_CHECKLIST,SETUP,TICKETS,WORKFLOW}.md`.
- Tests: docs-only; `pnpm check` green (111 files / 1237 tests; lint 0 errors, 120 pre-existing warnings; Prettier clean).
- Blockers / next step: owner reviews and merges PR #66; then start B-001, which writes D-110..D-114.
- Pitfalls: D-110 does not exist yet, so AGENTS.md rule 4 must stay unchanged until B-001 lands. D-114 is owner-approved text inside B-001, not yet a DECISIONS.md entry.

## Session log (newest first)

### 2026-11-15 — Devin — B-000 backlog and review process

- Done:
  - Added `docs/BACKLOG.md` as the authoritative rework backlog with B-000 marked DONE and explicit `Status` fields for every ticket/sub-ticket.
  - Moved the owner-approved D-114 pool-versioning text into B-001 so B-001 writes D-110..D-114 without a numbering gap; removed the premature D-114 entry from `docs/DECISIONS.md`.
  - Reverted the premature AGENTS.md rule-4/Rust amendment; B-001 now owns that edit when D-110 is written.
  - Updated live docs (`AGENTS.md`, `README.md`, `docs/WORKFLOW.md`, `docs/SETUP.md`, `docs/REVIEW_CHECKLIST.md`, `docs/AUDIT.md`) to point to `docs/BACKLOG.md`; marked `docs/TICKETS.md` and `docs/PROMPTS.md` OBSOLETE with deletion deferred.
  - Archived the previous PROGRESS.md content into `docs/PROGRESS_ARCHIVE.md` and restarted this file as the live handoff log.
  - Tightened B-005's deletion grep and B-014's D-023 validation-gate acceptance criteria.
- Files touched: `AGENTS.md`, `README.md`, `docs/{AUDIT,BACKLOG,DECISIONS,PROGRESS,PROGRESS_ARCHIVE,PROMPTS,REVIEW_CHECKLIST,SETUP,TICKETS,WORKFLOW}.md`.
- Tests: docs-only change; `pnpm check` green (111 files / 1237 tests; lint 0 errors, 120 pre-existing warnings; Prettier clean).
- State left: REVIEW — awaiting owner review of PR #66.
- Next step: owner merges PR #66, then B-001 writes D-110..D-114.
- Pitfalls / notes for next AI: `docs/BACKLOG.md` is authoritative for ticket status; GitHub issues are snapshots and any project board is a view only. Do not implement D-110..D-114 before B-001 records them.
