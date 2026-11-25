#!/usr/bin/env node
/**
 * SessionStart hook (BL-048): print the mandatory reading order so every
 * session sees it, not just whatever the agent remembers from AGENTS.md.
 * Stdout is injected into the session context.
 */

console.log(`Mandatory reading before any work (docs/WORKFLOW.md + AGENTS.md):
1. docs/GOALS.md and docs/DECISIONS_AMENDMENTS.md
2. The GitHub issue/project item for the task + the matching docs/SPECS.md section
3. docs/CONVENTIONS.md and docs/WORKFLOW.md
Other docs on demand: ARCHITECTURE.md, DATA_MODEL.md, RIOT_API.md, TESTING.md, DECISIONS.md, GLOSSARY.md, BUGS.md, SETUP.md.

Before creating a PR: the title must carry exactly one work item id (BL-xxx or B-xxx)
and the body must follow .github/pull_request_template.md (see docs/agents/issue-tracker.md).`);
