# Local ETL runbook — primary ingestion path (D-091, owner decision 2026-11-12)

The GitHub Actions schedule is **disabled** (`etl.yml` keeps only
`workflow_dispatch`). Ingestion, aggregation and export run locally; the
private state repo receives (a) small `public-exports.tar.gz` releases after
each pipeline run and (b) `DraftOrb.sqlite.gz` only as **periodic backups**
(~475 MiB gzipped ≈ 23% of the real 2 GiB per-file release-asset limit —
periodic cadence is an ops choice, not a storage constraint). Actions
usage is ~0 min/month.

## Routine local refresh

```bash
pnpm etl check-key euw1
pnpm etl static
pnpm etl matches euw1 --refresh --call-budget 8000 --time-budget 240
pnpm etl matches euw1 --limit 100 --call-budget 8000 --time-budget 120
pnpm etl profile-sync --publish
pnpm etl prune
pnpm etl timeline euw1 --limit 200 --call-budget 4000
pnpm etl aggregate
pnpm etl derive-roles
pnpm etl export
pnpm etl validate-export
pnpm etl status euw1
```

All commands are resumable (cursors, `extractor_runs`); budgets are checked
at player/match boundaries so a stopped run loses at most one unit of work.
`localCallBudget` default: 8000 Riot calls per session (see
`docs/RIOT_API.md`).

**Overlap guard (external review, 2026-11-12):** scheduled and manual runs
must never overlap — take a lock file before starting and release it when
the pipeline exits (the Actions `concurrency` group this replaces did the
same). Until a dedicated lock lands in the CLI, wrap the routine commands
in a small Node/PowerShell script that creates
`data/.etl.lock` (fail if it exists and is fresh, e.g. < 6 h old) and
deletes it on exit.

## Publishing

State repo: private `draftorb-state` (or `$DRAFTORB_STATE_REPO` / `--repo`).
Use `pnpm etl publish` (T-128, D-091) — pure Node, Windows-safe, uses your
own `gh auth`:

```bash
pnpm etl publish                  # exports release (small, every run)
pnpm etl publish --db --vacuum    # adds DraftOrb.sqlite.gz (periodic backup)
pnpm etl publish --keep=8         # prune old state-* releases (default 8)
```

- Exports releases always carry `public-exports.tar.gz`, so `pnpm etl pull`
  keeps working; `--db` releases carry both assets (a DB-only asset set is
  also safe — pull skips releases without the exports asset).
- `--db` runs `wal_checkpoint(TRUNCATE)` + `integrity_check` (must be `ok`)
  before gzipping; `--vacuum` compacts first (slower, smaller).
- The first real publish is owner-run; the command is unit-tested for the
  tar round-trip and arg parsing only.

## If a manual Actions run is ever needed

`workflow_dispatch` still works on `main` and follows the same pipeline,
including the DB asset upload (`if: always()`). It costs Actions minutes —
use sparingly; the local path above is the default.
