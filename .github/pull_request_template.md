## Summary

<!-- What does this PR do and why? Link the BACKLOG.md ticket id (B-xxx). -->

Ticket: B-___

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

- [ ] PR title contains the `B-xxx` ticket id
- [ ] Linked to a `docs/BACKLOG.md` ticket (one ticket = one PR)
- [ ] Acceptance criteria of the ticket are met
- [ ] Tests added/updated and `pnpm check` is green (typecheck + lint + format + tests)
- [ ] Works on Windows 11 (paths, scripts, shell-specific behavior)
- [ ] `docs/SPECS.md` (or the relevant spec doc) updated in this PR if behavior changed
- [ ] Every new number shows its sample size; thin data is labeled, never invented
- [ ] Parameter or number changes cite a backtest report (D-023)
- [ ] Live-data code only after the B-040 GO verdict; no memory reading or input injection
- [ ] No database schema/migration or pipeline changes outside the ticket's stated scope
- [ ] No secrets, tokens, PUUIDs, match ids or profile data committed
- [ ] No PROPOSED decision implemented without explicit owner approval (quote it if applicable)
- [ ] `docs/PROGRESS.md` handoff and `docs/BACKLOG.md`/ticket status updated

## Notes for reviewers

<!-- Estimates, unverified facts, owner decisions needed, screenshots for UI changes. -->
