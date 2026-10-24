# CONVENTIONS

## Language

All code, comments, docs, commit messages, tickets, bug reports, logs, error messages and UI strings are in **English**. UI strings go through a single `strings` module (easy to localize later, but only English ships for now).

## TypeScript

- `strict: true`, `noUncheckedIndexedAccess: true`, no `any` (use `unknown` + zod). ESM modules.
- Prefer pure functions, immutable data, small files (< 300 lines), explicit return types on exports.
- Types live in `packages/shared`; never duplicate them.
- Naming: files `kebab-case.ts`, types `PascalCase`, functions/vars `camelCase`, constants `UPPER_SNAKE`, enums as string literal unions (`'SUPPORT'`).
- Percentages: store as fractions (0.53) internally; deltas in percentage points named `...Pp`.
- Config numbers (weights, thresholds) live in `packages/engine/src/config.ts` — no magic numbers in logic.

## Engine rules

- Signature style: `fn(input, data, config) => result`. No hidden globals, no Date.now(), no Math.random().
- Return explanations alongside results (`reasons`).

## Tests

- Vitest, file `*.test.ts` next to source. See TESTING.md.

## React/Web

- Function components + hooks, Tailwind utility classes, no business logic in components (call engine).
- State: React state/Zustand if needed. Keep champion pickers keyboard accessible.
- Dark theme by default (gaming context), responsive.

## ETL

- Every command idempotent and resumable. Log progress with counts. Never print the API key.
- SQL in separate `.sql` files or tagged constants; parameterized queries only.

## Windows compatibility

- Use `node:path`, never hardcode `/`. No shell-specific npm scripts (`&&` ok, avoid `export`, `rm -rf`, `cp`) — use `cross-env`/node scripts.

## Comments & docs

- Comment the _why_. Public functions have a short JSDoc. Update docs when formats change.

## Dependencies

- Prefer few, popular, MIT/Apache libs. Record each in DECISIONS.md.
