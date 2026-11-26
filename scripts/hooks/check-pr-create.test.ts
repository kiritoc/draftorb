/**
 * PR-create hook tests (BL-049): `gh pr create` is validated only when it is
 * the actual command (not a mention inside another command's arguments), the
 * title must carry exactly one work item id, and the body must follow
 * .github/pull_request_template.md with a work item link.
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { checkPrCreateCommand } from './check-pr-create.mjs';

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-pr-create.mjs');

const VALID_BODY = [
  '## Summary',
  'does a thing',
  '## Acceptance criteria',
  '- [x] it works',
  '## Verified / Not verified',
  'verified locally',
  '## Owner decision needed',
  'Needed: no',
  '## Tracking',
  'Closes #145',
  '## Checklist',
  '- [x] done',
].join('\n');

const ok = () => VALID_BODY;
const failRead = () => {
  throw new Error('ENOENT');
};

describe('checkPrCreateCommand', () => {
  it.each([
    'git status',
    'git commit -m "docs: mention gh pr create in a message"',
    'echo "run gh pr create --title x when ready"',
    'make release && echo "gh pr create"',
    'pnpm check',
  ])('passes non-PR commands: %s', (command) => {
    expect(checkPrCreateCommand(command)).toBeNull();
  });

  it('validates gh pr create chained after another command', () => {
    const error = checkPrCreateCommand('git push && gh pr create');
    expect(error).toContain('--title');
  });

  it('validates gh pr create after a pipe or semicolon', () => {
    expect(checkPrCreateCommand('pnpm build; gh pr create --title "x"')).toContain('work item id');
    expect(checkPrCreateCommand('cat f | gh pr create --title "feat: x (BL-049)"')).toContain(
      '--body',
    );
  });

  it('accepts a fully valid command', () => {
    const command = `gh pr create --title "feat(agents): hooks (BL-049)" --body-file body.md`;
    expect(checkPrCreateCommand(command, ok)).toBeNull();
  });

  it('accepts short flags and --flag=value forms', () => {
    expect(
      checkPrCreateCommand(
        `gh pr create -t "fix: x (B-070)" -b '${VALID_BODY.replace('Closes #145', 'Fixes B-070')}'`,
        failRead,
      ),
    ).toBeNull();
    expect(
      checkPrCreateCommand(`gh pr create --title="fix: y (BL-049)" --body-file=body.md`, ok),
    ).toBeNull();
    expect(checkPrCreateCommand(`gh pr create -t"fix: z (BL-049)" -Fbody.md`, ok)).toBeNull();
  });

  it('handles escaped quotes inside the title', () => {
    const command = `gh pr create --title "feat: say \\"hi\\" (BL-049)" --body "${VALID_BODY}"`;
    expect(checkPrCreateCommand(command)).toBeNull();
  });

  it('rejects a missing title', () => {
    expect(checkPrCreateCommand(`gh pr create --body "${VALID_BODY}"`)).toContain('--title');
  });

  it('rejects a title without a work item id', () => {
    const error = checkPrCreateCommand(`gh pr create --title "no ticket" --body "${VALID_BODY}"`);
    expect(error).toContain('work item id');
  });

  it('rejects a title with two work item ids', () => {
    const error = checkPrCreateCommand(
      `gh pr create --title "x (BL-049) (B-070)" --body "${VALID_BODY}"`,
    );
    expect(error).toContain('exactly one');
  });

  it('rejects a missing or --fill body', () => {
    expect(checkPrCreateCommand(`gh pr create --title "x (BL-049)"`)).toContain('--body');
    expect(checkPrCreateCommand(`gh pr create --title "x (BL-049)" --fill`)).toContain('--fill');
  });

  it('rejects an unreadable --body-file', () => {
    const error = checkPrCreateCommand(
      `gh pr create --title "x (BL-049)" --body-file missing.md`,
      failRead,
    );
    expect(error).toContain('could not be read');
  });

  it('rejects a body missing template sections', () => {
    const error = checkPrCreateCommand(
      `gh pr create --title "x (BL-049)" --body "## Summary\nhi\nCloses #145"`,
    );
    expect(error).toContain('missing required template sections');
  });

  it('rejects a body without a work item link', () => {
    const body = VALID_BODY.replace('Closes #145', 'no link here');
    const error = checkPrCreateCommand(`gh pr create --title "x (BL-049)" --body "${body}"`);
    expect(error).toContain('must link the work item');
  });

  it('does not let the title satisfy body requirements', () => {
    const error = checkPrCreateCommand(
      `gh pr create --title "x (BL-049) ## Summary ## Acceptance criteria ## Verified / Not verified ## Owner decision needed ## Tracking ## Checklist Closes #145"`,
    );
    expect(error).toContain('--body');
  });

  it('ignores a work item link hidden in an HTML comment', () => {
    const body = VALID_BODY.replace('Closes #145', '<!-- Closes #145 -->');
    const error = checkPrCreateCommand(`gh pr create --title "x (BL-049)" --body "${body}"`);
    expect(error).toContain('must link the work item');
  });

  it('does not treat a <!-- inside inline or fenced code as a comment opener', () => {
    const inline = VALID_BODY.replace(
      'Closes #145',
      'Detects the `<!--` opener.\n\nCloses #145\n\n<!-- template note -->',
    );
    const command = 'gh pr create --title "x (BL-049)" --body-file b.md';
    expect(checkPrCreateCommand(command, () => inline)).toBeNull();
    const fenced = VALID_BODY.replace(
      'Closes #145',
      '```\n<!--\n```\n\nCloses #145\n\n<!-- template note -->',
    );
    expect(checkPrCreateCommand(command, () => fenced)).toBeNull();
  });

  it('accepts a body file that starts with a UTF-8 BOM', () => {
    const command = 'gh pr create --title "x (BL-049)" --body-file b.md';
    expect(checkPrCreateCommand(command, () => `\uFEFF${VALID_BODY}`)).toBeNull();
  });

  it('expands $env:TEMP (PowerShell) and $TMPDIR (POSIX) in --body-file', () => {
    const seen: string[] = [];
    const read = (path: string) => {
      seen.push(path);
      return VALID_BODY;
    };
    process.env.DRAFTORB_HOOK_TEST_DIR = '/tmp/hooktest';
    checkPrCreateCommand(
      'gh pr create --title "x (BL-049)" --body-file "$env:DRAFTORB_HOOK_TEST_DIR/pr-body.md"',
      read,
    );
    checkPrCreateCommand(
      'gh pr create --title "x (BL-049)" --body-file "$DRAFTORB_HOOK_TEST_DIR/pr-body.md"',
      read,
    );
    delete process.env.DRAFTORB_HOOK_TEST_DIR;
    expect(seen).toHaveLength(2);
    for (const path of seen) expect(path).toContain(join('hooktest', 'pr-body.md'));
  });

  it('keeps backslashes of a quoted Windows path', () => {
    let seen = '';
    const command = 'gh pr create --title "x (BL-049)" --body-file "C:\\Temp\\pr-body.md"';
    checkPrCreateCommand(command, (path) => {
      seen = path;
      return VALID_BODY;
    });
    expect(seen).toContain('C:\\Temp\\pr-body.md');
  });

  it('follows bash and PowerShell line continuations', () => {
    const bash = 'gh pr create \\\n  --title "fix: hooks (BL-049)" \\\n  --body-file body.md';
    expect(checkPrCreateCommand(bash, ok)).toBeNull();
    const pwsh = 'gh pr create `\r\n  --title "fix: hooks (BL-049)" `\r\n  --body-file body.md';
    expect(checkPrCreateCommand(pwsh, ok)).toBeNull();
    expect(checkPrCreateCommand('git push\ngh pr create --title "x"')).toContain('work item id');
  });

  it('requires the body link to match the title work item', () => {
    const bugBody = VALID_BODY.replace('Closes #145', 'Fixes B-071');
    const command = 'gh pr create --title "fix: x (B-070)" --body-file b.md';
    expect(checkPrCreateCommand(command, () => bugBody)).toContain('Fixes B-070');
    expect(checkPrCreateCommand(command, ok)).toContain('Fixes B-070');
    const blCommand = 'gh pr create --title "feat: x (BL-049)" --body-file b.md';
    expect(checkPrCreateCommand(blCommand, () => bugBody)).toContain('Closes #');
  });

  it('requires section headings at line start, not mid-line mentions', () => {
    const body = VALID_BODY.replace(/^## /gm, 'text ## ');
    const error = checkPrCreateCommand(`gh pr create --title "x (BL-049)" --body "${body}"`);
    expect(error).toContain('missing required template sections');
  });
});

describe('check-pr-create CLI', () => {
  const run = (payload: string) =>
    spawnSync('node', [script], { encoding: 'utf8', input: payload });

  it('exits 0 on malformed JSON (fail-open)', () => {
    expect(run('not json').status).toBe(0);
  });

  it('exits 0 for non-PR commands', () => {
    const payload = JSON.stringify({ tool_input: { command: 'git status' } });
    expect(run(payload).status).toBe(0);
  });

  it('exits 2 when gh pr create violates the rules', () => {
    const payload = JSON.stringify({
      tool_input: { command: 'gh pr create --title "no id" --body "x"' },
    });
    const result = run(payload);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('blocked');
  });
});
