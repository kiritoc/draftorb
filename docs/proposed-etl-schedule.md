# Proposed ETL schedule change (NOT applied — owner decision required)

Status: **PROPOSAL ONLY**. The scheduled workflow `.github/workflows/etl.yml`
on `main` is unchanged by this branch. This document records what Phase 2
would change and why it was not applied automatically.

## Why nothing was applied

Decision-rule guard 5.2 evaluated against measured facts (Phase 0,
`docs/reports/model-review-baseline.md` §g):

1. `kiritoc/draftorb` is **PRIVATE** → private-repo Actions minutes apply.
2. Current `etl.yml` runs ~1–3.5 h × 2/day ≈ **5,400–11,400 min/month**;
   the free-plan allowance (~2,000 min/month) and the actual plan are
   **UNVERIFIED** (billing API needs a scope we do not have).
3. Any ingest-volume increase raises monthly minutes proportionally —
   guard (iv) fails while the plan is unverified.
4. The state release is already near the storage cap: gzipped DB ≈ 475 MiB
   vs 512 MiB (25% of the verified 2 GiB per-asset limit). Ingest volume
   must be capped regardless of schedule.

## Proposed change (for the owner to apply manually if desired)

Keep the every-12h cadence but bound each run explicitly so a run can never
exceed the job limit or the monthly budget:

```yaml
# etl.yml — matches step only (rest of the pipeline unchanged)
- run: pnpm etl matches --refresh --limit 100 --call-budget 4000 --time-budget 300
```

Rationale:

- `--call-budget 4000`: at the measured 0.833 req/s app limit this is
  ~80 min of API time; ~2 calls/match stored → ~2,000 matches/run ceiling.
- `--time-budget 300` (minutes): hard stop inside the 6 h job limit with
  margin for aggregate/export/publish; completed cursors are saved, so the
  next run resumes where this one stopped (budgets are checked at player
  boundaries; per-player overrun ≤ ~perPlayer match calls).
- Both flags are new in this branch (`matches --call-budget`,
  `--time-budget`); without them the command behaves exactly as before.

## Backfill runs (one-off, owner-run)

Timeline/detail backfills should run locally with explicit budgets, e.g.:

```
pnpm etl backfill-timelines --call-budget 8000
pnpm etl matches --refresh --call-budget 8000 --time-budget 240
```

`localCallBudget` default remains 8000 calls per session (RIOT_API.md).
