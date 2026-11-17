#!/usr/bin/env node
/**
 * PR title check (BL-008): one ticket = one PR, so the title must carry a
 * backlog ticket id such as `BL-012` or `BL-013a`. The title is read from the
 * PR_TITLE environment variable (never interpolated into a shell command).
 *
 * Usage: PR_TITLE="BL-012: ..." node scripts/check-pr-title.mjs
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TICKET_ID = /(?<![A-Za-z0-9])BL-\d+[a-z]?(?![A-Za-z0-9])/;

/**
 * @param {string} title
 * @returns {string | null} an error message, or null when the title is valid
 */
export function checkPrTitle(title) {
  if (TICKET_ID.test(title)) return null;
  return 'PR title must contain a backlog ticket id such as BL-012 (one ticket = one PR)';
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
