---
name: create-pr
description: Create a GitHub pull request for this repo following .github/pull_request_template.md and the BL-xxx/B-xxx title rule. Use whenever asked to open a PR, instead of the generic pr skill.
---

# Create PR (DraftOrb)

Repo-specific PR process. The generic `pr` skill does NOT apply here — the repo template and CI title check win.

## Before writing anything

1. Read `docs/WORKFLOW.md` (end-of-session rules) and the linked GitHub issue (`gh issue view <n> --comments`).
2. The PR covers **exactly one work item** (D-120): one `BL-xxx` backlog ticket or one `B-xxx` bug. If the change spans two, split it or ask the owner.
3. Run `pnpm check` (typecheck + lint + format + tests) and keep it green.

## Title

`<type>(<scope>): <summary> (BL-xxx)` — e.g. `feat(engine): bans in draft input (BL-012)`.
For bug fixes: `fix(<scope>): <summary> (B-xxx)`. Exactly one work item id, enforced by `scripts/check-pr-title.mjs` in CI (`safety` job) and by the PreToolUse hook `scripts/hooks/check-pr-create.mjs`.

## Body

Use `.github/pull_request_template.md` verbatim as the body — write it to a temp file and pass `--body-file`. Pick a temp path for the OS you are on (`$env:TEMP\pr-body.md` on Windows, `/tmp/pr-body.md` on macOS/Linux):

```bash
gh pr create --title "..." --body-file "$env:TEMP/pr-body.md"
```

Required content:

- `Closes #<issue>` for a BL ticket (or `Fixes B-xxx` + the `docs/BUGS.md` entry for a bug)
- Every acceptance criterion from the issue copied into "Acceptance criteria" and ticked with evidence
- The checklist section filled honestly (mark n/a where it does not apply)

## After creating

- Update the linked issue/project status if the workflow requires it.
- If CI fails on the title check, fix the title and push an empty commit to retrigger (`pull_request` workflows do not fire on title edits).
