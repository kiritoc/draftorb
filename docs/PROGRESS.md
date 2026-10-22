# PROGRESS

## Current status
- Phase: 1 (Support / Diamond)
- Current milestone: M0 Foundations (Complete) -> M1 ETL
- Last updated: 2026-10-22 by Gemini (T-004)

## Epic status
| Epic | Status | Notes |
|---|---|---|
| E0 Foundations | DONE | T-001..T-004 DONE |
| E1 ETL | NOT STARTED | Ready to start T-010 |
| E2 Engine | NOT STARTED | Ready to start T-020 |
| E3 Web MVP | NOT STARTED | |
| E4 Runes | NOT STARTED | |
| E5 Items | NOT STARTED | |
| E6 Live | NOT STARTED | |
| E7 Vision | NOT STARTED | |

## Data collection status
- Riot key: (valid until ...)
- Games collected: 0 | Diamond: 0 | Patch: 16.21 (static imported)
- Last aggregation: -

## Next recommended ticket
T-010 (or T-020)

## Open questions for the owner
- (none)

---
## Session log (newest first)
### Template
```
### YYYY-MM-DD — <AI name/model> — Ticket T-xxx
- Done:
- Files touched:
- Tests: (command + result)
- State left: DONE / REVIEW / WIP
- Next step:
- Pitfalls / notes for next AI:
```

### 2026-10-22 — Gemini — Ticket T-004
- Done:
  - Created `data/manual/champion-tags.json` with 70 champions: all 43 support champions from Data Dragon (100% coverage) plus 27 common and off-meta flex picks.
  - Exported `damageTypeSchema`, `DamageType`, `championRangeSchema`, and `ChampionRange` in `@draftorb/shared`.
  - Added key-to-championId match refinement in `championTagsMapSchema` in `@draftorb/shared` to enforce ID integrity.
  - Implemented pure coverage evaluator (`evaluateChampionTagsCoverage`), report formatter (`formatCoverageReport`), and file validator (`validateChampionTagsFile`) in `packages/etl/src/tags.ts`.
  - Added `validate-tags` command to ETL CLI (`packages/etl/src/cli.ts`) and `"validate:tags"` script in root and ETL package.json.
  - Added unit test suite in `packages/etl/src/tags.test.ts` (5 tests covering pure coverage logic, missing supports detection, report formatting, real file validation, and error handling) and updated shared schema tests.
- Files touched:
  - `data/manual/champion-tags.json`
  - `packages/shared/src/index.ts`
  - `packages/shared/src/index.test.ts`
  - `packages/etl/src/tags.ts`
  - `packages/etl/src/tags.test.ts`
  - `packages/etl/src/index.ts`
  - `packages/etl/src/cli.ts`
  - `packages/etl/package.json`
  - `package.json`
  - `docs/TICKETS.md`
  - `docs/PROGRESS.md`
- Tests: `pnpm test && pnpm typecheck && pnpm lint` (4 test files, 24 tests passed), and `pnpm validate:tags` (100% support coverage, 70 champions tagged, untagged champions listed).
- State left: DONE
- Next step: T-010 (Riot client + rate limiter) or T-020 (Rank weighting module)
- Pitfalls / notes for next AI:
  - Thresh and Rakan are ranged in game mechanics (range 450 and 300 respectively); tagged as `RANGED`.
  - `championTagsMapSchema` enforces that dictionary keys match the inner `championId` as strings.
  - `pnpm validate:tags` enforces 100% coverage of champions tagged with `SUPPORT` in `champions.json`; if any support champion is missing in the future, the validation script exits with code 1.

### 2026-10-22 — Gemini — Ticket T-003
- Done:
  - Added `championsMapSchema` and `runeTreesSchema` in `@draftorb/shared`.
  - Implemented Data Dragon importer in `packages/etl/src/ddragon.ts` with pure transformers, version patch extractor (`getPatchFromVersion`), tag-to-role mapper (`mapChampionTagsToRoles`), and fetch functions with optional injection for unit testing.
  - Implemented ETL CLI in `packages/etl/src/cli.ts` supporting `pnpm etl static [version]`.
  - Added root and package script mappings for `etl` and `static`.
  - Recorded ADRs `D-013` (tsx) and `D-014` (@types/node) in `docs/DECISIONS.md`.
  - Wrote comprehensive unit tests in `packages/etl/src/ddragon.test.ts` (7 tests covering edge cases, transformers, mock fetch, and disk file emission).
  - Executed `pnpm etl static` and verified downloaded data for patch 16.21: 173 champions, 859 items, 5 rune trees, all validated by Zod schemas in `data/public/16.21/`.
- Files touched:
  - `packages/shared/src/index.ts`
  - `packages/shared/src/index.test.ts`
  - `packages/etl/src/ddragon.ts`
  - `packages/etl/src/ddragon.test.ts`
  - `packages/etl/src/cli.ts`
  - `packages/etl/src/index.ts`
  - `packages/etl/package.json`
  - `packages/etl/tsconfig.json`
  - `package.json`
  - `docs/DECISIONS.md`
  - `docs/TICKETS.md`
  - `docs/PROGRESS.md`
  - `data/public/16.21/champions.json`
  - `data/public/16.21/items.json`
  - `data/public/16.21/runes.json`
- Tests: `npm test && npm run typecheck && npm run lint` (3 test files, 19 tests passed), and `pnpm etl static` (live import + Zod validation).
- State left: DONE
- Next step: T-004 (Support champion tags)
- Pitfalls / notes for next AI:
  - Data Dragon contains obsolete/internal items with empty `name` (e.g. `2008`, `226660`); `transformItems` filters them out because `itemSchema` requires `name.min(1)`.
  - Data Dragon `runesReforged.json` contains extra fields (`longDesc`); `transformRunes` maps only the fields defined in `runePerkSchema` to comply with `.strict()`.
  - `data/public/<patch>/*.json` files are committed as public assets according to `DATA_MODEL.md`.


### 2026-10-22 — Claude Opus 4.6 (Thinking) — Ticket T-001
- Done: Full monorepo scaffold with pnpm workspaces (shared, engine, etl, web), TypeScript strict config, Vitest, ESLint (flat config), Prettier, Vite + React + Tailwind for web app
- Files touched:
  - Root: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `.prettierrc`, `vitest.config.ts`, `eslint.config.mjs`
  - `packages/shared/`: `package.json`, `tsconfig.json`, `src/index.ts`
  - `packages/engine/`: `package.json`, `tsconfig.json`, `src/index.ts`, `src/hello.ts`, `src/hello.test.ts`
  - `packages/etl/`: `package.json`, `tsconfig.json`, `src/index.ts`
  - `apps/web/`: `package.json`, `tsconfig.json`, `vite.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`
- Tests: `pnpm install && pnpm test && pnpm typecheck && pnpm lint` — all green (3/3 tests pass)
- State left: DONE
- Next step: T-002 (Shared types + zod schemas)
- Pitfalls / notes for next AI:
  - Web tsconfig uses `rootDir: "."` and `noEmit: true` (no composite) to include config files at project root
  - ESLint uses flat config (`eslint.config.mjs`) with `allowDefaultProject` for root config files
  - `postcss.config.mjs` (ESM, not CJS) to avoid lint errors in ESM project
  - Engine has a placeholder `add()` function + test — replace with real code in T-020+
  - Tailwind v3 is used (v4 was still beta-ish at time of scaffold)

### 2026-10-22 — Claude Opus 4.6 (Thinking) — Ticket T-002
- Done: Implemented the shared Zod schemas and exported TypeScript types for rank, roles, champion IDs, draft inputs, recommendations, game state, manifest data, and static champion metadata. Added focused tests covering valid and invalid payloads.
- Files touched:
  - `packages/shared/src/index.ts`
  - `packages/shared/src/index.test.ts`
  - `packages/shared/package.json`
- Tests: `pnpm test && pnpm typecheck && pnpm lint` — all green (2 test files, 9 tests passed)
- State left: DONE
- Next step: T-003 (Data Dragon importer)
- Pitfalls / notes for next AI:
  - `zod` is the single validation dependency in the shared package
  - Keep runtime logic out of shared package; this ticket is schema-only
  - `DraftInput`/`GameState` are intentionally strict but permissive on optional fields such as `role` and `pool`

### 2026-10-22 — Session note — Governance review / blocker
- Done: Recorded the blocking semantic bug and the governance drift discovered after T-002.
- Files touched:
  - `docs/BUGS.md`
  - `docs/DECISIONS.md`
- State left: REVIEW / BLOCKED
- Next step:
  - Re-open the T-002 acceptance gate and compare `packages/shared/src/index.ts` against every contract in `docs/DATA_MODEL.md` before declaring any future ticket done.
  - Add the missing schemas required by the data model before continuing to `T-003`.
  - Require schema parity tests that fail if an exported model is absent from the public API.
- Pitfalls / notes for next AI:
  - Green tests do not equal contract coverage.
  - Acceptance must be checked against the canonical docs, not only against the narrow happy path used in the first tests.
  - Project governance requires explicit parity checks and bug logs before ticket closure.

### 2026-10-22 — Gemini — Ticket T-002 remediation & completion
- Done:
  - Fixed semantic bug in `PlayerState.items` (was using `championIdSchema`, now uses `itemIdSchema`).
  - Added missing shared models to achieve full parity with `DATA_MODEL.md`: `itemIdSchema`, `itemSchema`, `itemsMapSchema`, `itemTagsSchema`, `itemTagsMapSchema`, `runePerkSchema`, `runeTreeSchema`, `runePageSchema`, `supportBaselineEntrySchema`, `supportBaselineTableSchema`, `supportPairTableSchema`.
  - Removed loose `.rest(z.number())` on `supportPairEntrySchema` to strictly enforce the 6-element tuple contract.
  - Recorded ADR `D-012` for `zod` in `docs/DECISIONS.md`.
  - Resolved and closed `B-002` in `docs/BUGS.md`.
  - Extended unit tests in `packages/shared/src/index.test.ts` (12 tests total, all passing).
- Files touched:
  - `packages/shared/src/index.ts`
  - `packages/shared/src/index.test.ts`
  - `docs/DECISIONS.md`
  - `docs/BUGS.md`
  - `docs/PROGRESS.md`
- Tests: `npx vitest run && npx tsc -b && npx eslint .` all green.
- State left: DONE
- Next step: T-003 (Data Dragon importer)
- Pitfalls / notes for next AI:
  - All static and aggregated formats needed for T-003 and E1 now have validation schemas in `@draftorb/shared`.
  - File length for `packages/shared/src/index.ts` is 291 lines (< 300 lines rule). If adding more schemas, consider modularizing into domain files (e.g. `draft.ts`, `items.ts`, `runes.ts`).
