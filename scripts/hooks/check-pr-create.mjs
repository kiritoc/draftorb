#!/usr/bin/env node
/**
 * PreToolUse hook (BL-049): validate `gh pr create` commands before they run.
 *
 * Reads the hook payload JSON from stdin (Claude-format: tool_name +
 * tool_input.command). If the command does not actually run `gh pr create`
 * (a mention inside a commit message or echo argument does not count), exits 0
 * silently. Otherwise checks, in order:
 *
 *   1. --title/-t is present and carries exactly one work item id
 *      (BL-xxx / B-xxx) via scripts/check-pr-title.mjs — the same rule CI
 *      enforces in the `safety` job.
 *   2. A body is supplied via --body/-b or --body-file/-F (--fill* cannot be
 *      validated and is blocked) and it follows
 *      .github/pull_request_template.md: the required section headings are
 *      present and it links the work item (`Closes #n` or `Fixes B-xxx`).
 *
 * Exit code 2 blocks the tool call and shows stderr to the agent; any
 * other exit code lets it through. Unparseable payloads are let through
 * (fail-open) so a hook bug never bricks the session.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkPrTitle } from '../check-pr-title.mjs';

const REQUIRED_SECTIONS = [
  '## Summary',
  '## Acceptance criteria',
  '## Verified / Not verified',
  '## Owner decision needed',
  '## Tracking',
  '## Checklist',
];

const BODY_LINK = /Closes\s+#\d+|Fixes\s+B-\d{3,}/;
const FILL_FLAGS = new Set(['--fill', '--fill-first', '--fill-verbose']);
const HTML_COMMENT = /<!--[\s\S]*?-->/g;

const REQUIRED_SECTION_PATTERNS = REQUIRED_SECTIONS.map(
  (section) => new RegExp(`^${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm'),
);

/**
 * Split a shell command line into top-level segments on `;`, `&`, `|` and
 * newlines, ignoring separators inside single or double quotes. Backslash
 * escapes the next character inside double quotes.
 *
 * @param {string} command
 * @returns {string[]}
 */
function splitSegments(command) {
  const segments = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote === "'") {
      current += ch;
      if (ch === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      current += ch;
      if (ch === '\\') {
        i += 1;
        if (i < command.length) current += command[i];
      } else if (ch === '"') {
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ';' || ch === '\n' || ch === '|' || ch === '&') {
      segments.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  segments.push(current);
  return segments;
}

/**
 * Tokenize one command segment on whitespace, honoring single/double quotes.
 * Quote characters are stripped; `\"` inside double quotes yields `"`.
 *
 * @param {string} segment
 * @returns {string[]}
 */
function tokenize(segment) {
  const tokens = [];
  let current = '';
  let quote = null;
  let hasToken = false;
  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      else current += ch;
      continue;
    }
    if (quote === '"') {
      if (ch === '\\' && i + 1 < segment.length) {
        i += 1;
        current += segment[i];
      } else if (ch === '"') {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      hasToken = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (hasToken || current !== '') {
        tokens.push(current);
        current = '';
        hasToken = false;
      }
      continue;
    }
    if (ch === '\\' && i + 1 < segment.length) {
      i += 1;
      current += segment[i];
      hasToken = true;
      continue;
    }
    current += ch;
    hasToken = true;
  }
  if (hasToken || current !== '') tokens.push(current);
  return tokens;
}

const LONG_FLAGS = new Map([
  ['--title', 'title'],
  ['--body', 'body'],
  ['--body-file', 'bodyFile'],
]);
const SHORT_FLAGS = new Map([
  ['t', 'title'],
  ['b', 'body'],
  ['F', 'bodyFile'],
]);

/**
 * Extract flag values from the tokens of a `gh pr create` segment.
 * Supports `--flag value`, `--flag=value`, `-f value`, `-f=value` and `-fvalue`.
 * Parsing stops at `--` or the first non-flag token after the subcommand words.
 *
 * @param {string[]} tokens tokens of the segment, starting at `gh`
 * @returns {{ title: string | null, body: string | null, bodyFile: string | null, fill: boolean }}
 */
function parseFlags(tokens) {
  const result = { title: null, body: null, bodyFile: null, fill: false };
  for (let i = 3; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === '--') break;
    if (FILL_FLAGS.has(token)) {
      result.fill = true;
      continue;
    }
    let key;
    let inlineValue = null;
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      const name = eq === -1 ? token : token.slice(0, eq);
      inlineValue = eq === -1 ? null : token.slice(eq + 1);
      key = LONG_FLAGS.get(name);
    } else if (token.startsWith('-') && token.length > 1) {
      const rest = token.slice(2);
      inlineValue = rest.startsWith('=') ? rest.slice(1) : rest === '' ? null : rest;
      key = SHORT_FLAGS.get(token[1]);
    } else {
      continue;
    }
    if (key === undefined) {
      // Unknown flags are ignored; their values (if any) are just extra tokens.
      continue;
    }
    const value = inlineValue ?? tokens[i + 1] ?? null;
    if (inlineValue === null && value !== null) i += 1;
    if (value === null) continue;
    if (key === 'title') result.title = value;
    else if (key === 'body') result.body = value;
    else result.bodyFile = value;
  }
  return result;
}

/**
 * Validate a shell command that runs `gh pr create`.
 *
 * @param {string} command the full shell command string
 * @param {(path: string) => string} [readFile] file reader for --body-file
 * @returns {string | null} an error message, or null when the command is valid
 */
export function checkPrCreateCommand(command, readFile = (path) => readFileSync(path, 'utf8')) {
  const segment = splitSegments(command).find((part) => {
    const tokens = tokenize(part);
    return tokens[0] === 'gh' && tokens[1] === 'pr' && tokens[2] === 'create';
  });
  if (segment === undefined) return null;

  const flags = parseFlags(tokenize(segment));

  if (flags.title === null) {
    return (
      '`gh pr create` without --title cannot be validated (and CI requires a work item id in the title anyway).\n' +
      'Pass --title "<type>(<scope>): <summary> (BL-xxx)" or "... (B-xxx)".'
    );
  }
  const titleError = checkPrTitle(flags.title);
  if (titleError !== null) {
    return `${titleError}\nTitle was: ${flags.title}`;
  }

  let rawBodyText;
  if (flags.bodyFile !== null) {
    try {
      rawBodyText = readFile(resolve(flags.bodyFile));
    } catch {
      return `--body-file ${flags.bodyFile} could not be read.`;
    }
  } else if (flags.body !== null) {
    rawBodyText = flags.body;
  } else {
    return (
      '`gh pr create` has no readable body (--body or --body-file). --fill* bodies cannot be ' +
      'validated against .github/pull_request_template.md; pass --body-file with the rendered template.'
    );
  }

  // HTML comments are template scaffolding, not content: a closing reference
  // or heading hidden inside one must not satisfy the checks below, and a
  // heading only counts at the start of a line.
  const bodyText = rawBodyText.replace(HTML_COMMENT, '');
  const missing = REQUIRED_SECTIONS.filter(
    (_, index) => !REQUIRED_SECTION_PATTERNS[index].test(bodyText),
  );
  if (missing.length > 0) {
    return (
      `PR body is missing required template sections: ${missing.join(', ')}.\n` +
      'Use .github/pull_request_template.md as the body (--body-file is easiest).'
    );
  }
  if (!BODY_LINK.test(bodyText)) {
    return 'PR body must link the work item: "Closes #<issue>" for a BL ticket or "Fixes B-xxx" for a bug.';
  }
  return null;
}

function block(message) {
  console.error(`PR create blocked by scripts/hooks/check-pr-create.mjs:\n${message}`);
  process.exit(2);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    process.exit(0);
  }

  const command = payload?.tool_input?.command ?? payload?.tool_input?.cmd ?? '';
  if (typeof command !== 'string') {
    process.exit(0);
  }

  const error = checkPrCreateCommand(command);
  if (error !== null) block(error);
  process.exit(0);
}
