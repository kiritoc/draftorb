/**
 * State-repo privacy check tests (BL-007, D-122). Repo resolution itself is
 * covered by pull.test.ts (shared resolveStateRepo).
 */

import { describe, expect, it } from 'vitest';

import { assertPrivate, parseCheckStatePrivateArgs } from './commands/check-state-private';

describe('parseCheckStatePrivateArgs', () => {
  it('parses --repo=owner/name', () => {
    expect(parseCheckStatePrivateArgs(['--repo=octo/draftorb-state'])).toEqual({
      repo: 'octo/draftorb-state',
    });
  });

  it('parses --repo owner/name', () => {
    expect(parseCheckStatePrivateArgs(['--repo', 'octo/draftorb-state'])).toEqual({
      repo: 'octo/draftorb-state',
    });
  });

  it('defaults to no repo override', () => {
    expect(parseCheckStatePrivateArgs([])).toEqual({ repo: undefined });
  });

  it('rejects unknown arguments', () => {
    expect(() => parseCheckStatePrivateArgs(['--nope'])).toThrow('Usage: etl check-state-private');
  });
});

describe('assertPrivate', () => {
  it('passes on PRIVATE', () => {
    expect(() => assertPrivate('octo/draftorb-state', 'PRIVATE')).not.toThrow();
  });

  it.each(['PUBLIC', 'INTERNAL', ''])('fails on %s', (visibility) => {
    expect(() => assertPrivate('octo/draftorb-state', visibility)).toThrow('expected "PRIVATE"');
  });
});
