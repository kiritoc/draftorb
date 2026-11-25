/**
 * SessionStart hook tests (BL-049): stdout must be the JSON envelope Devin
 * reads — hookSpecificOutput.additionalContext — or the reminder never
 * reaches the session context.
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const script = join(dirname(fileURLToPath(import.meta.url)), 'session-start.mjs');

describe('session-start hook', () => {
  it('prints a SessionStart hookSpecificOutput envelope', () => {
    const result = spawnSync('node', [script], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout) as {
      hookSpecificOutput?: { hookEventName?: string; additionalContext?: string };
    };
    expect(output.hookSpecificOutput?.hookEventName).toBe('SessionStart');
    expect(output.hookSpecificOutput?.additionalContext).toContain('docs/GOALS.md');
    expect(output.hookSpecificOutput?.additionalContext).toContain('pull_request_template.md');
  });
});
