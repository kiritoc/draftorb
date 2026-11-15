# REVIEW CHECKLIST

Use this for every PR in the rework. Source of truth: `docs/GOALS.md`, accepted decisions in `docs/DECISIONS.md` (D-096..D-109 plus anything the owner approves later), and the linked GitHub issue/project item for scope and status.

## Goal alignment

- [ ] The PR delivers exactly one issue, and the PR description links it with `Closes #n`; every acceptance criterion is ticked with evidence.
- [ ] The change moves the product toward GOALS.md (pick screen → runes/summoners/starters → in-game items) and respects the version scope (D-100, D-097).
- [ ] Product invariants hold (AGENTS.md): "Best overall" always shown; "From your pool" above it when the pool is non-empty; both lists paginated with "Show more"; pool never changes `score(c)`; champion portraits next to names; "unvalidated" label until the D-023 gate passes.

## Decisions

- [ ] Only ACCEPTED decisions are implemented. Any PROPOSED decision — exact current list: D-081..D-090, D-092, D-092a, D-093, D-095 — is either untouched or explicitly approved by the owner; approval is quoted in the PR.
- [ ] New dependencies are recorded in `docs/DECISIONS.md` (name, why, size, license, free).
- [ ] Spec gaps were logged as PROPOSED in `docs/DECISIONS.md` with the assumption used, not silently guessed.

## Data honesty

- [ ] Every displayed statistic shows its sample size (`n_eff` and/or distinct players where D-102 applies).
- [ ] Thin data falls back to a broader labeled statistic (picks/runes) or a labeled rule (items) — never an invented or prior-only number (golden rule 8, D-103).
- [ ] Win rate and pick share are shown separately where D-102 applies; "Master+ only" is off by default.
- [ ] Rankings remain deterministic: same input → same output.

## Evidence, live data and pipeline scope

- [ ] PRs that change a parameter or any number cite a backtest report (D-023).
- [ ] Live-data code (LCU / Live Client Data API) lands only after the Riot-policy ticket has a GO verdict recorded in DECISIONS.md; never memory reading or input injection (SPECS §9).
- [ ] No database or pipeline changes outside the ticket's stated scope.

## Tests and specs

- [ ] Tests were added or updated; engine changes are test-first where applicable (golden rule 7).
- [ ] `pnpm check` is green (typecheck + lint + format + tests).
- [ ] `docs/SPECS.md` (or the relevant spec section) is updated in the same PR when behavior or formats changed.
- [ ] Contract parity checked against `docs/DATA_MODEL.md` for any shared/export format change (D-011).

## Secrets and data hygiene

- [ ] No secrets, tokens, API keys, PUUIDs, match ids, or foreign player names committed.
- [ ] Shared aggregates contain no profile data; `profiles/` and the SQLite DB are never part of a public artifact (D-111).
- [ ] `.env.example` stays up to date if env vars changed.

## Windows impact

- [ ] Paths use `path.join`; no bash-only scripts; no symlinks. The native-dependency rule stays as is until D-110 is merged; the amendment (Rust toolchain allowed only for the Tauri desktop shell) is made by BL-001 — do not apply it earlier.
- [ ] Windows CI job (`windows-latest`) stays green; Windows-specific behavior is called out in the PR.
- [ ] better-sqlite3 continues to use prebuilt binaries on Windows Node 22.

## Process

- [ ] The reviewer reads the linked issue and checks each acceptance criterion, and lists the files actually read.
- [ ] Linked GitHub issue/project status updated; `docs/BUGS.md` updated for new/fixed bugs.
- [ ] Commit messages follow Conventional Commits and reference the issue/ticket id.
