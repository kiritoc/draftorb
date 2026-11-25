#!/usr/bin/env node
/**
 * PreToolUse hook (BL-048): validate `gh pr create` commands before they run.
 *
 * Reads the hook payload JSON from stdin (Claude-format: tool_name +
 * tool_input.command). If the command is not a `gh pr create`, exits 0
 * silently. Otherwise checks, in order:
 *
 *   1. --title is present and carries exactly one work item id
 *      (BL-xxx / B-xxx) via scripts/check-pr-title.mjs — the same rule CI
 *      enforces in the `safety` job.
 *   2. The body follows .github/pull_request_template.md: the required
 *      section headings are present and it links the work item
 *      (`Closes #n` or `Fixes B-xxx`).
 *
 * Exit code 2 blocks the tool call and shows stderr to the agent; any
 * other exit code lets it through. Unparseable payloads are let through
 * (fail-open) so a hook bug never bricks the session.
 */

import { readFileSync } from 'node:fs';
import { checkPrTitle } from '../check-pr-title.mjs';

const REQUIRED_SECTIONS = [
  '## Summary',
  '## Acceptance criteria',
  '## Verified / Not verified',
  '## Owner decision needed',
  '## Tracking',
  '## Checklist',
];

function block(message) {
  console.error(`PR create blocked by scripts/hooks/check-pr-create.mjs:\n${message}`);
  process.exit(2);
}

let payload;
try {
  payload = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}

const command = payload?.tool_input?.command ?? payload?.tool_input?.cmd ?? '';
if (typeof command !== 'string' || !/\bgh\s+pr\s+create\b/.test(command)) {
  process.exit(0);
}

// --- title -----------------------------------------------------------------

const titleMatch = command.match(/--title(?:=|\s+)("([^"]*)"|'([^']*)'|([^\s]+))/);
const title = titleMatch ? (titleMatch[2] ?? titleMatch[3] ?? titleMatch[4]) : null;
if (title === null) {
  block(
    '`gh pr create` without --title cannot be validated (and CI requires a work item id in the title anyway).\n' +
      'Pass --title "<type>(<scope>): <summary> (BL-xxx)" or "... (B-xxx)".',
  );
}
const titleError = checkPrTitle(title);
if (titleError !== null) {
  block(`${titleError}\nTitle was: ${title}`);
}

// --- body ------------------------------------------------------------------

let bodyText = command;
const bodyFileMatch = command.match(/--body-file(?:=|\s+)("([^"]*)"|'([^']*)'|([^\s]+))/);
const bodyFile = bodyFileMatch ? (bodyFileMatch[2] ?? bodyFileMatch[3] ?? bodyFileMatch[4]) : null;
if (bodyFile !== null) {
  try {
    bodyText += '\n' + readFileSync(bodyFile, 'utf8');
  } catch {
    block(`--body-file ${bodyFile} could not be read.`);
  }
}

const missing = REQUIRED_SECTIONS.filter((section) => !bodyText.includes(section));
if (missing.length > 0) {
  block(
    `PR body is missing required template sections: ${missing.join(', ')}.\n` +
      'Use .github/pull_request_template.md as the body (--body-file is easiest).',
  );
}
if (!/Closes\s+#\d+|Fixes\s+B-\d{3,}/.test(bodyText)) {
  block(
    'PR body must link the work item: "Closes #<issue>" for a BL ticket or "Fixes B-xxx" for a bug.',
  );
}

process.exit(0);
