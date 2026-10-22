# BUGS
Severity: S1 blocker, S2 major, S3 minor, S4 cosmetic. Status: OPEN, INVESTIGATING, FIXED, WONTFIX. Add newest on top of the open list.

## Open
| ID | Sev | Area | Title | Status | Found by/date | Ticket |
|---|---|---|---|---|---|---|
| – | – | – | – | – | – | – |

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
