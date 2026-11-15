---
name: review-pr
description: Review a DraftOrb pull request against REVIEW_CHECKLIST.md and the linked ticket — returns a verdict with evidence. Usage: /review-pr <PR number or URL>
argument-hint: "<PR number or URL>"
agent: reviewer
triggers:
  - user
---

Review the pull request the user identified with this command (a PR number, branch name, or URL).

If the user gave no PR number, branch, or URL, ask which PR to review before doing anything else.

Spawn the `reviewer` subagent with this task: review that PR — fetch its diff and description with `gh pr view`/`gh pr diff`, verify every claim against the actual code, and check it against `docs/REVIEW_CHECKLIST.md` and the linked GitHub issue. Report its verdict, checklist results, flags, and required changes back to me verbatim — do not summarize away the evidence.
