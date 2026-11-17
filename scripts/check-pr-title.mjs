#!/usr/bin/env node
/**
 * PR title check (BL-008, D-120): one tracked work item = one PR, so the title
 * must carry exactly one work item id: a backlog ticket (`BL-012`, `BL-013a`,
 * GitHub issues) or a bug (`B-071`, docs/BUGS.md). Repeating the same id is
 * fine; two different ids fail. The title is read from the PR_TITLE
 * environment variable (never interpolated into a shell command).
 *
 * Usage: PR_TITLE="BL-012: ..." node scripts/check-pr-title.mjs
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORK_ITEM_ID = /(?<![A-Za-z0-9-])(?:BL-\d+[a-z]?|B-\d{3,})(?![A-Za-z0-9])/g;

/**
 * @param {string} title
 * @returns {string | null} an error message, or null when the title is valid
 */
export function checkPrTitle(title) {
  const ids = new Set(title.match(WORK_ITEM_ID) ?? []);
  if (ids.size === 1) return null;
  if (ids.size === 0) {
    return 'PR title must contain a work item id: a backlog ticket such as BL-012 or a bug such as B-071';
  }
  return `PR title must reference exactly one work item (found ${[...ids].join(', ')}): one work item = one PR`;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const title = process.env.PR_TITLE;
  if (title === undefined) {
    console.error('PR title check error: PR_TITLE environment variable is not set');
    process.exit(2);
  }
  const error = checkPrTitle(title);
  if (error !== null) {
    console.error(`PR title check FAILED: ${error}`);
    process.exit(1);
  }
  console.log('PR title check passed.');
}
