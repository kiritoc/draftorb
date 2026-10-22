# PROGRESS

## Current status
- Phase: 1 (Support / Diamond)
- Current milestone: M0 Foundations
- Last updated: 2026-10-22 by Gemini (T-002 remediation)

## Epic status
| Epic | Status | Notes |
|---|---|---|
| E0 Foundations | IN PROGRESS | T-001 DONE, T-002 DONE |
| E1 ETL | NOT STARTED | |
| E2 Engine | NOT STARTED | |
| E3 Web MVP | NOT STARTED | |
| E4 Runes | NOT STARTED | |
| E5 Items | NOT STARTED | |
| E6 Live | NOT STARTED | |
| E7 Vision | NOT STARTED | |

## Data collection status
- Riot key: (valid until ...)
- Games collected: 0 | Diamond: 0 | Patch: -
- Last aggregation: -

## Next recommended ticket
T-003

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
