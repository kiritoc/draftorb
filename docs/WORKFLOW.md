# WORKFLOW (multi-AI, docs-driven)

Goal: any AI (Claude, ChatGPT, Gemini, Cursor, Copilot, local model...) can pick up the project with zero chat history. **The repo is the memory.**

## Roles

- **Owner (human)**: chooses priorities, reviews, runs the app.
- **AI**: implements ONE task per session, keeps docs in sync.
- **Task tracker**: GitHub issues and the Draftorb project board. Git docs hold specs and decisions, not ticket status.

## Start of session

1. Read `AGENTS.md`, `docs/GOALS.md` and `docs/DECISIONS_AMENDMENTS.md`, then the chosen GitHub issue/task and the matching `SPECS.md` section.
2. Check `docs/BUGS.md` for open bugs related to the area.
3. Run `pnpm install && pnpm test && pnpm typecheck`. If red BEFORE you start, log it in BUGS.md and tell the owner.
4. Restate the acceptance criteria / goal of the task in your own words before coding.

## During session

- Small, focused changes. Do not touch files unrelated to the task.
- Write/adjust tests with the code (engine: tests first).
- No new dependency without a line in `DECISIONS.md` (name, why, size, license, free).
- Found a bug outside scope -> add it to `BUGS.md`, do not fix it now.
- Spec gap -> log in `DECISIONS.md` as `PROPOSED` with your assumption.
- Keep the engine pure (AGENTS.md rule 3).

## Definition of Done

- [ ] Task goal / acceptance criteria met
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint` all green
- [ ] Works on Windows (paths, scripts)
- [ ] No secrets, no generated junk committed
- [ ] Docs updated if behavior/format changed (SPECS, DATA_MODEL, SETUP...)

## End of session (mandatory)

1. Update `BUGS.md` (new bugs, fixed bugs).
2. Commit with Conventional Commits: `feat(engine): add role inference`. Types: feat, fix, test, docs, refactor, chore.
3. Tell the owner a short summary + suggested next step (chat language follows the owner; anything written to files is English).

## Git

- Branch per task. Merge to `main` only when DoD is met.
- Commit often; never rewrite history on shared branches.
- Data files: `data/public/` exports are delivered via state releases, not committed; raw data / sqlite never enter git.

## Switching AI mid-task

The leaving AI must: commit WIP on the task branch and write a handoff in the commit message or PR description (what is done/left, failing tests, exact next step). The next AI must not restart from scratch.

## Quality gates for AI output

- Never claim tests pass without running them.
- Never fabricate stats, API fields or URLs: check `RIOT_API.md` / real responses; if unsure, say so and log it.
- If a task is too large for one session, split it and stop at a clean state.

## Weekly (owner)

Review BUGS and GOALS, reprioritize GitHub issues/project, bump data to the new patch (`pnpm etl ...`), re-run golden tests.
