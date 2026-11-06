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

## H. Full project audit (read-only, for a large-context thinking model)

Use this to get a global "is the project heading in the right direction?" check from an AI that can hold the whole repo in context. The report it produces is self-contained: paste it as-is to a second AI that has no file access (plus the files listed in its Section 10).

How to use:

1. Provide the whole project first (concatenated files with their paths, or direct file access), then paste the prompt below.
2. Replace `[N]` with the real number of files, so the AI can detect truncation (`git ls-files | wc -l` or `(git ls-files).Count)` in PowerShell).
3. Paste the resulting report (and the files it lists in Section 10) to the second reviewer. Ask the reviewer to verify the `[FACT]` claims against the excerpts before giving an opinion.

```
# ROLE
You are a senior technical auditor with experience in TypeScript monorepos, recommendation/scoring engines, and data pipelines. You are performing a full, critical, READ-ONLY review of the project "DraftOrb" to determine whether it is heading in the right direction.

Your final report will be pasted as-is to a second reviewer (another AI) who has NO access to the files. They will only see your report. It must therefore be self-contained, dense, and evidence-based.

# MODE: AUDIT ONLY (overrides AGENTS.md workflow rules)
AGENTS.md contains session rules written for developer agents. For this task:
- Read AGENTS.md and the docs as SOURCES OF TRUTH to audit against.
- Do NOT pick a ticket, do NOT write or modify any file, do NOT update PROGRESS.md / TICKETS.md / BUGS.md, do NOT propose large patches.
- The only exception: the rules in AGENTS.md (golden rules, product invariants, language rule) are the standard you audit the project against.

# STEP 0 — INVENTORY CHECK (do this before anything else)
Count the files you actually received/can access. Expected: [N] files. State the real count and list anything missing, truncated, or unreadable. If the numbers do not match, say so in Section 11 of the report and lower the certainty of related findings.

# STEP 1 — READ IN THIS ORDER
1. AGENTS.md
2. docs/PROGRESS.md, docs/TICKETS.md, docs/SPECS.md, docs/CONVENTIONS.md, docs/WORKFLOW.md
3. Other docs: ARCHITECTURE, DATA_MODEL, RIOT_API, TESTING, DECISIONS, GLOSSARY, BUGS, SETUP, PROMPTS
4. Code: packages/shared, packages/engine, packages/etl, apps/web, data/ (hand-written tags and generated JSON samples), config files, tests
Read everything. Do not skim the middle of long files. If you cannot read something, say so explicitly.

# STEP 2 — WHAT TO VERIFY
Reconstruct what the project ACTUALLY does from the code (not from what docs claim), then compare against the stated goals: (1) champion + rune recommendation during draft with partial information, (2) in-game item recommendation based on game state and who is fed; Phase 1 scope = Support role, Diamond rank.

A. Direction and product
- Does the implementation serve the Phase 1 goal, or is there scope creep / premature work (e.g. desktop, phase 2) / missing core pieces?
- Is the recommendation logic sound for "partial information" drafts? Are the scoring formula, role probabilities, and sample-size handling coherent with SPECS?
- Product invariants (D-024): "Best overall" list always shown; personal pool never changes score(c); pool champions join the candidate set as offRole; relative order of the original roleProb set unchanged; both lists paginated 5 by 5 in the UI while the engine returns complete lists.

B. Golden rules compliance (check each, with evidence)
1. 100% free: no paid API/LLM/hosting, no scraping of third-party stats sites.
2. TypeScript strict everywhere, Node 22+, pnpm workspaces.
3. packages/engine purity: no DOM, no Node APIs, no network, no file I/O, no unseeded randomness; imports only from allowed packages.
4. Windows-first: no bash-only scripts, path.join usage, no symlinks, no native deps needing a compiler.
5. No secrets in git; .env gitignored; .env.example up to date.
6. Dependencies added without a DECISIONS.md entry; unrelated refactors.
7. Engine changes covered by tests; test quality (do they assert real behavior or just pass?).
8. Never invent data: "insufficient data" with sample size is returned instead of fake numbers. Look for hardcoded/placeholder stats, silent defaults, fabricated fallbacks.
9. Unclear specs handled via DECISIONS.md (status PROPOSED) rather than silent guesses.
10. Language rule: everything in the repo must be English (code, comments, docs, tickets, logs, errors, UI text). Flag any French or other language found in files.

C. Consistency and truthfulness of project state
- Do PROGRESS.md and TICKETS.md match reality? (tickets marked DONE but incomplete/untested; TODO items already implemented; stale handoff notes.)
- Do SPECS, ARCHITECTURE, DATA_MODEL, and the actual types/zod schemas in packages/shared agree with each other and with the code?
- BUGS.md vs bugs you can see in the code.
- Data pipeline: Riot API usage vs RIOT_API.md (rate limits, endpoints, ranking/role filtering), SQLite schema vs DATA_MODEL, aggregation correctness, JSON export vs what the web app and engine consume.

D. Engineering quality
- Bugs, dead code, duplication, orphan files, circular deps, fragile architecture, over/under-engineering.
- Statistical risks: sample sizes, selection bias, Diamond/Support filtering, patch handling, overfitting, divide-by-zero or NaN paths.
- Security or privacy issues, dependency risks.
- `pnpm check` health: would typecheck/lint/format/tests plausibly pass? Do not claim you ran anything you did not run.

# STRICT RULES
- Invent NOTHING. Every finding cites file path (plus function/line if possible) and a short quote (1–5 lines max).
- Tag every claim: [FACT] seen directly in the provided files / [HYPOTHESIS] inferred / [UNKNOWN] cannot be determined from what was provided. Never present a hypothesis as a fact.
- No generic advice ("add more tests") unless tied to a specific file/function in this project.
- Be honest: neither reassuring nor alarmist. If everything is fine, say so briefly.
- Reason as long as you need internally, but your final answer must contain ONLY the report below, in English, max ~1800 words. Prioritize the most important issues over exhaustiveness; for minor items, group them in one line.

# REQUIRED OUTPUT FORMAT

## 0. Inventory
Files expected vs files actually read; anything missing/truncated.

## 1. Verdict
ONE of: 🟢 Right direction / 🟠 Partial drift / 🔴 Wrong direction — plus 3 lines of justification.

## 2. What the project actually does
5–10 lines: architecture, main components, data flow, stack, and real implementation status per package (shared / engine / etl / web).

## 3. Annotated structure
Key folders/files with one line of role each (skip noise: node_modules, builds, lockfiles).

## 4. Issues found (sorted by severity)
For each:
- **[Critical/Major/Minor]** Title
- File(s):
- Evidence: (1–5 line quote)
- Impact:
- Certainty: FACT / HYPOTHESIS
- Rule violated (if any): e.g. "Golden rule 8", "D-024"

## 5. Compliance matrix
Table: Golden rules 1–10 + Product invariants (D-024) + Language rule | status (OK / Partial / Violated / Unknown) | evidence.

## 6. Goal vs reality
Table: intended feature (draft recommendation, runes, pool, pagination, item recommendation, ETL, etc.) | status (done / partial / missing / broken) | evidence.

## 7. Docs vs reality
Mismatches between PROGRESS/TICKETS/SPECS/DECISIONS and the code (ticket statuses that are wrong, undocumented decisions, stale docs).

## 8. Solid points
What is well done and should not be touched (3–5 max).

## 9. Open questions for the second reviewer
Max 5 precise decisions or doubts where you want a second opinion (design/statistical/architecture questions, not style).

## 10. Files/excerpts to forward to the reviewer
The 3–5 most critical files or passages the owner should paste alongside this report, with the reason for each (exact paths).

## 11. Audit limits
What you could not see or verify (truncation, code not executed, missing data files, etc.).

# FINAL REMINDER
Read-only audit. Output ONLY the report above (sections 0–11), in English, grounded exclusively in cited files, with every claim tagged [FACT] / [HYPOTHESIS] / [UNKNOWN]. Do not modify or propose to modify files.
```

## I. Implement Ticket (Autonomous, with Review)
Implements a ticket following AGENTS.md, runs two review passes with test-first bug fixes, and ends with clean commit(s). Only asks questions when truly blocked.

```
Implement ticket <T-xxx>.

## 1. Gather context first
- Read AGENTS.md (and any CLAUDE.md, CONTRIBUTING.md, README, docs/ or
  nested AGENTS.md files relevant to the areas you'll touch). Follow their
  conventions for code style, architecture, tests, commit messages, and
  tooling. If they conflict with this prompt, they win on project
  conventions; this prompt wins on workflow.
- Read the ticket in full, including comments, linked tickets, and
  acceptance criteria.
- Explore the relevant code, existing patterns, and similar past
  implementations before writing anything.
- Run the existing test suite, linter, and type checker to get a baseline,
  so you can distinguish pre-existing failures from ones you introduce.

## 2. Plan and implement
- Write a brief plan (files to touch, approach, risks) and then implement it
  without waiting for my approval.
- Follow existing patterns. Keep the change minimal and focused on the
  ticket; no unrelated refactors.
- Add tests for the new behavior as you go, following the project's testing
  conventions.

## 3. First review pass
Once the implementation is done, review your own diff as a skeptical
reviewer would:
- Correctness against every acceptance criterion in the ticket
- Edge cases, error handling, null/empty inputs, concurrency, security
- Consistency with AGENTS.md conventions and surrounding code
- Missing or weak tests, leftover debug code, dead code, naming

For every real bug you find:
1. Write a failing test that reproduces it first.
2. Fix the bug.
3. Confirm the test now passes.

Fix issues in place. Do NOT create new tickets, TODOs, or follow-up entries
for them; just fix them.

## 4. Second review pass
Do a fresh review of the full diff, including the fixes from pass 1, since
fixes can introduce new problems. Apply the same process (failing test, fix,
verify). Also run the full test suite, linter, and type checker, and make
sure nothing regressed compared to the baseline.

## 5. Commit
- Create clean, logical commit(s) following the commit conventions in
  AGENTS.md (or the repo's git history if none are documented).
- Use one commit if the change is cohesive. Use several if it splits
  naturally (e.g. refactor / feature / tests / docs), with each commit
  building and passing tests on its own.
- Don't leave review-fix noise in history: fold the fixes into the relevant
  commits rather than adding "fix review comments" commits.
- Do not push, and do not open a PR unless AGENTS.md says to.

## Autonomy rules
- Do as much as you can on your own. Make reasonable assumptions, note them,
  and keep going rather than asking me.
- Only stop if you are truly blocked: ambiguous requirements that change the
  outcome, missing access or credentials, conflicting instructions, or a
  decision that is costly to reverse.
- If you get stuck, ask me all your questions at once in a single message,
  with your recommended answer for each so I can just reply "go with your
  suggestions".

## Final report
When finished, give me a short summary:
- What you implemented and the commit(s) created
- Bugs found during review and how they were fixed
- Assumptions you made
- Anything you couldn't verify (e.g. tests you couldn't run)
```