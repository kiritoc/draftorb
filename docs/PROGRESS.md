# PROGRESS

## Current status
- Phase: 1 (Support / Diamond)
- Current milestone: M0 Foundations
- Last updated: 2026-10-22 by Claude Opus 4.6

## Epic status
| Epic | Status | Notes |
|---|---|---|
| E0 Foundations | IN PROGRESS | T-001 DONE |
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
T-002

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
