# PROMPTS — copy/paste for any AI

## A. Start a session (generic)

```
You are working on the DraftOrb repo. First read AGENTS.md, then docs/PROGRESS.md, docs/TICKETS.md and docs/WORKFLOW.md.
Work on ticket <T-xxx> only. Follow the Definition of Done. Everything written to the repo must be in English (code, comments, docs, commits, UI text).
Before coding, restate the acceptance criteria and list the files you will touch. Run tests before declaring done.
At the end, update TICKETS.md, PROGRESS.md (session log) and BUGS.md, and propose a commit message.
```

## B. Let the AI choose the ticket

```
Read AGENTS.md and docs/PROGRESS.md. Propose the next ticket (respect dependencies in TICKETS.md) and wait for my OK before coding.
```

## C. Code review by another AI

```
Review the last changes on branch <name> against AGENTS.md rules, SPECS.md and CONVENTIONS.md. List: violations, bugs, missing tests, spec mismatches. Do not rewrite code; output a prioritized list and add real bugs to docs/BUGS.md.
```

## D. Fix a bug

```
Read AGENTS.md and docs/BUGS.md. Fix bug <B-xxx>: reproduce it, write a failing regression test first, then fix, then run all tests. Update BUGS.md and PROGRESS.md.
```

## E. Weekly data refresh

```
Follow docs/SETUP.md: run etl static, matches (resume), aggregate, export for the latest patch. Report counts per rank bucket and any pair tables with too little data. Update docs/PROGRESS.md (data collection status).
```

## F. Spec clarification

```
I will describe a behavior change. Update docs/SPECS.md accordingly, add a DECISIONS.md entry, list the tickets impacted (modify/add in TICKETS.md). Do not write code.
```

## G. Context-limited AI (small window)

```
Only read: AGENTS.md (golden rules), the ticket <T-xxx>, and the SPECS section it references. Do not read other docs unless needed. Keep changes under ~200 lines per step and stop for my review after each step.
```
