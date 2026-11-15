# AGENTS.md — Read this first (all AI assistants)

Project: **DraftOrb** — a personal Windows 11 companion for one player (KiriToc, Diamond, EUW): champion pick during draft, then runes/summoners/starters, then in-game item advice. Roles: Support, Top and Jungle in full; ADC and Mid minimal (D-097). Source of truth: `docs/GOALS.md`.

## Language rule

**Everything in the repository is in English**: code, identifiers, comments, commit messages, docs, tickets, bug reports, test names, log messages, error messages and UI text. Never write French (or any other language) in files. In the chat, reply in the language the owner uses, but anything that is written to a file stays in English.

## Mandatory reading order (every session)

1. `docs/GOALS.md` and `docs/DECISIONS_AMENDMENTS.md` — what we build and the latest approved decisions
2. `docs/PROGRESS.md` — current state and last session handoff
3. `docs/TICKETS.md` — pick ONE ticket (status `TODO`, dependencies done)
4. `docs/SPECS.md` — the relevant section for that ticket
5. `docs/CONVENTIONS.md` and `docs/WORKFLOW.md` — rules of work
   Other docs on demand: `ARCHITECTURE.md`, `DATA_MODEL.md`, `RIOT_API.md`, `TESTING.md`, `DECISIONS.md`, `GLOSSARY.md`, `BUGS.md`, `SETUP.md`, `PROMPTS.md`.

## Golden rules (never break)

1. **100% free.** No paid API, no paid LLM at runtime, no paid hosting. No scraping third-party stats sites (u.gg, op.gg...).
2. **Language: TypeScript (strict) for `packages/shared`, `packages/engine`, `packages/etl` and tooling.** Node.js 22+, pnpm workspaces. The Windows desktop shell language is decided after the code audit (D-098/D-099) — do not assume TypeScript there.
3. **`packages/engine` is pure**: no DOM, no Node APIs, no network, no file I/O, no randomness without a seed. It takes data objects in, returns results out. It must run in the browser, Node and the desktop shell.
4. **Windows-first, minimal setup.** Only Node + pnpm required for `packages/shared`, `packages/engine`, `packages/etl` and tooling. No bash-only scripts (use Node scripts), use `path.join`, no symlinks, and no native deps that need a compiler in those packages/tooling (prefer `better-sqlite3` prebuilt binaries; if it fails, log it in BUGS.md). The Windows desktop shell may require the Rust toolchain for Tauri (D-110); that exception applies only to `apps/desktop` build tooling, never to the engine/ETL runtime.
5. **No secrets in git.** Riot key goes in `.env` (gitignored). `.env.example` stays up to date.
6. **One ticket per session.** Do not refactor unrelated code. Do not add dependencies without noting it in `docs/DECISIONS.md`.
7. **Tests first for the engine.** Every engine change needs/updates tests (see `docs/TESTING.md`).
8. **Never invent data.** If stats are insufficient, return "insufficient data" (with sample size), not a fake number.
9. **Spec unclear?** Do not guess silently: write the question + your assumption in `docs/DECISIONS.md` (status `PROPOSED`), then proceed with the assumption.
10. **Before ending a session**: update `PROGRESS.md`, `TICKETS.md`, `BUGS.md` (see `docs/WORKFLOW.md` > End of session).

## Product invariants (D-024, apply to every UI/engine change)

- The recommendation screen **always shows a "Best overall" list**, even when the user has no pool.
- The user can keep a **personal champion pool** (stored by the program, per role, champion x roles — D-101). When it is non-empty a **"From your pool"** list is shown too. The pool **never changes `score(c)`**; pool champions join the candidate set (`offRole` below the roleProb threshold). Overall `rank` numbers can shift only because extra pool-only candidates appear; the relative order of the original roleProb set is unchanged (SPECS §2.1, §5, §7.1).
- Both lists are **paginated with "Show more"**: first 5, then the next 5, until the list is exhausted. The engine always returns complete lists; the UI slices them.

## Commands

```
pnpm install
pnpm dev            # web app
pnpm test           # all unit tests (vitest)
pnpm typecheck
pnpm lint
pnpm check          # typecheck + lint + format check + tests (what CI runs)
pnpm etl <command>  # data pipeline (see docs/SETUP.md)
```

## Repo layout

```
packages/shared   types + zod schemas (single source of truth)
packages/engine   pure scoring/recommendation logic
packages/etl      Riot API client, SQLite, aggregation, JSON export
apps/web          Vite + React + Tailwind (static site)
apps/desktop      Electron shell (phase 2, not created yet)
data/             generated JSON (public), hand-written tags (manual) + raw/sqlite (gitignored)
docs/             all project docs
```
