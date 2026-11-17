/**
 * PR title check tests (BL-008): a backlog ticket id `BL-<digits>[a-z]` is required.
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { checkPrTitle } from './check-pr-title.mjs';

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-pr-title.mjs');

describe('checkPrTitle', () => {
  it.each([
    'BL-002: Windows 11 Tauri spike',
    'feat(engine): bans (BL-012)',
    'BL-013a — Evidence rule',
    'chore: BL-008',
  ])('accepts %s', (title) => {
    expect(checkPrTitle(title)).toBeNull();
  });

  it.each(['fix(etl): torn snapshot (B-070)', 'XBL-012', 'BL-', 'BL-12ab', 'bl-012', ''])(
    'rejects %j',
    (title) => {
      expect(checkPrTitle(title)).toContain('BL-012');
    },
  );
});

describe('check-pr-title CLI', () => {
  const run = (title: string | undefined) => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.PR_TITLE;
    if (title !== undefined) env.PR_TITLE = title;
    return spawnSync('node', [script], { encoding: 'utf8', env });
  };

  it('exits 0 for a valid title from PR_TITLE', () => {
    expect(run('BL-008: CI safety automation').status).toBe(0);
  });

  it('exits 1 with the rule for an invalid title', () => {
    const result = run('no ticket here');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('PR title must contain a backlog ticket id');
  });

  it('exits 2 when PR_TITLE is not set', () => {
    expect(run(undefined).status).toBe(2);
  });
});
