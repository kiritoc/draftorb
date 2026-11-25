# AGENTS.md — Read this first (all AI assistants)

Project: **DraftOrb** — a personal Windows 11 companion for one player (KiriToc, Diamond, EUW): champion pick during draft, then runes/summoners/starters, then in-game item advice. Roles: Support, Top and Jungle in full; ADC and Mid minimal (D-097). Source of truth: `docs/GOALS.md`.

## Language rule

**Everything in the repository is in English**: code, identifiers, comments, commit messages, docs, tickets, bug reports, test names, log messages, error messages and UI text. Never write French (or any other language) in files. Owner quotes are recorded translated into English and marked "translated from French". In the chat, reply in the language the owner uses, but anything that is written to a file stays in English.

## Mandatory reading order (every session)

1. `docs/GOALS.md` and `docs/DECISIONS_AMENDMENTS.md` — what we build and the latest approved decisions
2. The chosen GitHub issue/project item and the matching `docs/SPECS.md` section
3. `docs/CONVENTIONS.md` and `docs/WORKFLOW.md` — rules of work
   Other docs on demand: `ARCHITECTURE.md`, `DATA_MODEL.md`, `RIOT_API.md`, `TESTING.md`, `DECISIONS.md`, `GLOSSARY.md`, `BUGS.md`, `SETUP.md`.

## Tickets

Before any work, read the ticket: `gh issue view <n> --comments`. If you cannot read it, stop and ask. The acceptance criteria in the issue are the contract; do not change them; comment and ask the owner. Decisions go into `docs/DECISIONS.md` as PROPOSED in the PR, never only in issue comments.

## Golden rules (never break)

1. **100% free.** No paid API, no paid LLM at runtime, no paid hosting. No scraping third-party stats sites (u.gg, op.gg...).
2. **Language: TypeScript (strict) for `packages/shared`, `packages/engine`, `packages/etl` and tooling.** Node.js 22+, pnpm workspaces. The Windows desktop program is a Tauri shell around the TypeScript engine (D-115), pending the Windows spike; its native layer is thin Rust glue; do not write the shell in another language without a decision.
3. **`packages/engine` is pure**: no DOM, no Node APIs, no network, no file I/O, no randomness without a seed. It takes data objects in, returns results out. It must run in the browser, Node and the desktop shell.
4. **Windows-first, minimal setup.** Only Node + pnpm required. No bash-only scripts (use Node scripts), use `path.join`, no symlinks, no native deps that need a compiler (prefer `better-sqlite3` prebuilt binaries; if it fails, log it in BUGS.md). Exception: the Windows desktop shell may require the Rust toolchain for Tauri (D-115); the exception never applies to `packages/shared`, `packages/engine`, `packages/etl` or tooling.
5. **No secrets in git.** Riot key goes in `.env` (gitignored). `.env.example` stays up to date.
6. **One task per session.** Do not refactor unrelated code. Do not add dependencies without noting it in `docs/DECISIONS.md`.
7. **Tests first for the engine.** Every engine change needs/updates tests (see `docs/TESTING.md`).
8. **Never invent data.** If stats are insufficient, return "insufficient data" (with sample size), not a fake number.
9. **Spec unclear?** Do not guess silently: write the question + your assumption in `docs/DECISIONS.md` (status `PROPOSED`), then proceed with the assumption.
10. **Before ending a session**: update `BUGS.md`, the linked GitHub issue/project status, and leave a clear commit message / PR description (see `docs/WORKFLOW.md` > End of session).

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
apps/web          legacy Vite + React static site, frozen until deleted (D-121)
apps/desktop      Tauri shell around the TypeScript engine (D-115)
data/             generated JSON (public), hand-written tags (manual) + raw/sqlite (gitignored)
docs/             all project docs
```

## Agent skills

### Issue tracker

Issues live as GitHub issues in `kiritoc/draftorb`, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context layout. Domain vocabulary lives in `docs/GLOSSARY.md`, decisions in `docs/DECISIONS.md` + `docs/DECISIONS_AMENDMENTS.md`. See `docs/agents/domain.md`.
