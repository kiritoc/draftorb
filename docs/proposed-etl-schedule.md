# Local ETL runbook — primary ingestion path (D-091, owner decision 2026-11-12)

The GitHub Actions schedule is **disabled** (`etl.yml` keeps only
`workflow_dispatch`). Ingestion, aggregation and export run locally; the
private state repo receives (a) small `public-exports.tar.gz` releases after
each pipeline run and (b) `DraftOrb.sqlite.gz` only as **periodic backups**
(~475 MiB gzipped — near the 512 MiB asset cap, never every run). Actions
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

## Publishing (until `pnpm etl publish` lands — T-128)

State repo: private `draftorb-state` (or `$DRAFTORB_STATE_REPO`).

1. **Exports release** (every run, small):

   ```bash
   tar -czf /tmp/public-exports.tar.gz -C data/public .
   gh release create "state-$(date -u +%Y%m%dT%H%MZ)" \
     --repo kiritoc/draftorb-state /tmp/public-exports.tar.gz \
     --title "state-$(date -u +%Y%m%dT%H%MZ)" --notes "exports only"
   ```

   Note: `pickNewestStateTagWithAssets` requires `public-exports.tar.gz`,
   so exports releases keep `pnpm etl pull` working.

2. **DB backup** (periodic — weekly or before risky operations):

   ```bash
   pnpm etl migrate
   # checkpoint + integrity check + VACUUM (see former etl.yml steps), then:
   gzip -9 -n -c data/DraftOrb.sqlite > /tmp/DraftOrb.sqlite.gz
   gh release create "state-$(date -u +%Y%m%dT%H%MZ)-backup" \
     --repo kiritoc/draftorb-state /tmp/DraftOrb.sqlite.gz \
     --title "state-…-backup" --notes "DB backup"
   ```

   A DB-only release is safe: pull skips releases without the exports
   asset. Keep total release count bounded (the old workflow kept 7;
   prune old `state-*` releases manually or via `gh release delete`).

3. The app reads exports via `pnpm etl pull` (unchanged).

## If a manual Actions run is ever needed

`workflow_dispatch` still works on `main` and follows the same pipeline,
including the DB asset upload (`if: always()`). It costs Actions minutes —
use sparingly; the local path above is the default.
