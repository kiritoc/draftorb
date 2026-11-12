# Prerequisites missing — prompt 2 aborted per decision rule 5.1

Date: 2026-11-12. Checked `origin/main` at `668e459` (merge of PR #57).

## What the prerequisite requires

Prompt 2 states: "a separate first prompt ('Fix D-082') is already merged into
`main`. It delivers the item taxonomy, path decisions, raw item and kill
events, starter bundles, the state scale, the lane archetype hierarchy and the
timeline backfill command."

## What was actually merged

PR #57 (`t-051-timeline-item-builds`) contains only:

- T-051 implementation: `item_events` purchase/sold extraction,
  `item_build` aggregation under the **old** D-082 interpretations (still
  PROPOSED), `pnpm etl timeline`.
- `docs/reports/d082-audit.md` — the **Phase A audit only** of the first
  prompt.

The first prompt's **Phase B was never implemented**: the session stopped at
the mandated Phase A STOP report and Phase B was not resumed.

## Artifact checklist (all ABSENT on main)

| Required artifact                                                              | Status                                |
| ------------------------------------------------------------------------------ | ------------------------------------- |
| `data/manual/item-classes.generated.json` pipeline + `pnpm etl classify-items` | MISSING                               |
| `item_build.decision_kind` with `path` rows                                    | MISSING (no `decision_kind` anywhere) |
| `item_events` with `event_type` undo/sold/destroyed rows                       | MISSING (stores `type='purchase'      | 'sold'` only) |
| `kill_events` table                                                            | MISSING                               |
| `participant_starters` + `starterBundleKey()`                                  | MISSING                               |
| `item_state_scale` + `stateBucket()` `stateBucketMode`                         | MISSING                               |
| `laneArchKey()` + extended back-off                                            | MISSING                               |
| `pnpm etl backfill-timelines` + `TimelineExtractor` registry                   | MISSING                               |
| `netPurchasedItems()` / `ownedItemsAt()`                                       | MISSING                               |
| D-082 amendment ADRs (D-083+)                                                  | MISSING (last ADR is D-082)           |

Only file mentioning these names is `docs/reports/d082-audit.md` (the audit
that _proposed_ them).

## Consequence

Per decision rule 5.1, no other work was performed. The first prompt's Phase B
must be completed (and merged) before this prompt can run: Phases 3, 5 and 6
of prompt 2 depend directly on the missing artifacts (kill events for the
win-probability model, item classes/path rows for the items engine, starter
bundles, state scale, backfill registry).
