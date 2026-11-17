## Summary

<!-- What does this PR do and why? Link the GitHub issue/project item. -->

Closes #___

<!-- Backlog ticket: link the issue (BL-xxx). Bug fix without an issue: replace the line above with `Fixes B-xxx (docs/BUGS.md)`. -->

## Acceptance criteria

<!-- Copy every acceptance criterion from the linked issue here and tick each one with evidence (command, test, screenshot). -->

- [ ] criterion — evidence:

## Verified / Not verified

- Verified:
- Not verified:

## Owner decision needed

Needed: yes/no

<!-- If yes, name the decision/ticket and what the owner must choose. -->

## Tracking

- Issues/project board created: yes/no
- Links:

<!-- If you had no access to issues or a project board, state that explicitly here. -->

## Checklist

- [ ] PR title carries exactly one work item id, `BL-xxx` (body: `Closes #n`) or `B-xxx` (body: the `docs/BUGS.md` entry) — one work item = one PR (D-120)
- [ ] Acceptance criteria of the linked issue are copied into the "Acceptance criteria" section and each one is ticked with evidence (command, test, screenshot)
- [ ] Tests added/updated and `pnpm check` is green (typecheck + lint + format + tests)
- [ ] Works on Windows 11 (paths, scripts, shell-specific behavior)
- [ ] `docs/SPECS.md` (or the relevant spec doc) updated in this PR if behavior changed
- [ ] Every new number shows its sample size; thin data is labeled, never invented
- [ ] Parameter or number changes cite a backtest report (D-023)
- [ ] Live-data code only after the Riot policy GO verdict; no memory reading or input injection
- [ ] No database schema/migration or pipeline changes outside the linked issue's stated scope
- [ ] No secrets, tokens, PUUIDs, match ids or profile data committed
- [ ] No PROPOSED decision implemented without explicit owner approval (quote it if applicable)
- [ ] Linked GitHub issue/project status updated; `docs/BUGS.md` updated for new/fixed bugs

## Notes for reviewers

<!-- Estimates, unverified facts, owner decisions needed, screenshots for UI changes. -->
