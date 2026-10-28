# AGENTS.md — Read this first (all AI assistants)

Project: **DraftOrb** — a free League of Legends tool that (1) recommends a champion (+ runes) during draft with partial information, and (2) recommends items in-game depending on game state and who is fed. Phase 1 scope: **Support role, Diamond rank.**

## Language rule

**Everything in the repository is in English**: code, identifiers, comments, commit messages, docs, tickets, bug reports, test names, log messages, error messages and UI text. Never write French (or any other language) in files. In the chat, reply in the language the owner uses, but anything that is written to a file stays in English.

## Mandatory reading order (every session)

1. `docs/PROGRESS.md` — current state and last session handoff
2. `docs/TICKETS.md` — pick ONE ticket (status `TODO`, dependencies done)
3. `docs/SPECS.md` — the relevant section for that ticket
4. `docs/CONVENTIONS.md` and `docs/WORKFLOW.md` — rules of work
   Other docs on demand: `ARCHITECTURE.md`, `DATA_MODEL.md`, `RIOT_API.md`, `TESTING.md`, `DECISIONS.md`, `GLOSSARY.md`, `BUGS.md`, `SETUP.md`, `PROMPTS.md`.

## Golden rules (never break)

1. **100% free.** No paid API, no paid LLM at runtime, no paid hosting. No scraping third-party stats sites (u.gg, op.gg...).
2. **Language: TypeScript (strict) everywhere.** Node.js 20+, pnpm workspaces.
3. **`packages/engine` is pure**: no DOM, no Node APIs, no network, no file I/O, no randomness without a seed. It takes data objects in, returns results out. It must run in browser, Node and Electron.
4. **Windows-first, minimal setup.** Only Node + pnpm required. No bash-only scripts (use Node scripts), use `path.join`, no symlinks, no native deps that need a compiler (prefer `better-sqlite3` prebuilt binaries; if it fails, log it in BUGS.md).
5. **No secrets in git.** Riot key goes in `.env` (gitignored). `.env.example` stays up to date.
6. **One ticket per session.** Do not refactor unrelated code. Do not add dependencies without noting it in `docs/DECISIONS.md`.
7. **Tests first for the engine.** Every engine change needs/updates tests (see `docs/TESTING.md`).
8. **Never invent data.** If stats are insufficient, return "insufficient data" (with sample size), not a fake number.
9. **Spec unclear?** Do not guess silently: write the question + your assumption in `docs/DECISIONS.md` (status `PROPOSED`), then proceed with the assumption.
10. **Before ending a session**: update `PROGRESS.md`, `TICKETS.md`, `BUGS.md` (see `docs/WORKFLOW.md` > End of session).

## Product invariants (D-024, apply to every UI/engine change)

- The recommendation screen **always shows a "Best overall" list**, even when the user has no pool.
- The user can keep a **personal champion pool** (browser-only, per role). When it is non-empty a **"From your pool"** list is shown too. The pool **never changes `score(c)`**; pool champions join the candidate set (`offRole` below the roleProb threshold). Overall `rank` numbers can shift only because extra pool-only candidates appear; the relative order of the original roleProb set is unchanged (SPECS §2.1, §5, §7.1).
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
