# WORKFLOW (multi-AI, docs-driven)

Goal: any AI (Claude, ChatGPT, Gemini, Cursor, Copilot, local model...) can pick up the project with zero chat history. **The repo is the memory.**

## Roles

- **Owner (human)**: chooses priorities, reviews, runs the app, pastes the session prompt (`PROMPTS.md`).
- **AI**: implements ONE ticket per session, keeps docs in sync.

## Start of session

1. Read `AGENTS.md`, `docs/PROGRESS.md` (latest handoff), then the chosen ticket in `TICKETS.md` and the matching `SPECS.md` section.
2. Check `docs/BUGS.md` for open bugs related to the area.
3. Run `pnpm install && pnpm test && pnpm typecheck`. If red BEFORE you start, log it in BUGS.md and tell the owner.
4. Set ticket status `DOING` (one at a time). Restate the acceptance criteria in your own words.

## During session

- Small, focused changes. Do not touch files unrelated to the ticket.
- Write/adjust tests with the code (engine: tests first).
- No new dependency without a line in `DECISIONS.md` (name, why, size, license, free).
- Found a bug outside scope -> add it to `BUGS.md`, do not fix it now.
- Spec gap -> log in `DECISIONS.md` as `PROPOSED` with your assumption.
- Keep the engine pure (AGENTS.md rule 3).

## Definition of Done

- [ ] Acceptance criteria met
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint` all green
- [ ] Works on Windows (paths, scripts)
- [ ] No secrets, no generated junk committed
- [ ] Docs updated if behavior/format changed (SPECS, DATA_MODEL, SETUP...)
- [ ] TICKETS status set (`REVIEW` if owner must check, else `DONE`)
- [ ] PROGRESS.md handoff written

## End of session (mandatory)

1. Update `TICKETS.md` status.
2. Add a **Session log entry** in `PROGRESS.md` (template inside): what was done, files touched, state of tests, what is next, pitfalls.
3. Update `BUGS.md` (new bugs, fixed bugs).
4. Commit with Conventional Commits: `feat(engine): add role inference (T-021)`. Types: feat, fix, test, docs, refactor, chore.
5. Tell the owner a short summary + next recommended ticket (chat language follows the owner; anything written to files is English).

## Git

- Branch per ticket: `t-021-role-inference`. Merge to `main` only when DoD is met.
- Commit often; never rewrite history on shared branches.
- Data files: `data/public/` can be committed (small JSON); raw data / sqlite never.

## Switching AI mid-ticket

The leaving AI must: commit WIP on the ticket branch, set status `DOING`, and write in PROGRESS.md a "WIP handoff" (what is done/left, failing tests, exact next step). The next AI must not restart from scratch.

## Quality gates for AI output

- Never claim tests pass without running them.
- Never fabricate stats, API fields or URLs: check `RIOT_API.md` / real responses; if unsure, say so and log it.
- If a task is too large for one session, split the ticket and stop at a clean state.

## Weekly (owner)

Review PROGRESS and BUGS, reprioritize TICKETS, bump data to the new patch (`pnpm etl ...`), re-run golden tests.
