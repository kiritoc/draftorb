/**
 * State-repo privacy check tests (BL-007, D-122): the state repository must
 * stay private; the check resolves it like the ETL and fails on anything else.
 */

import { describe, expect, it } from 'vitest';

import { parseArgs, parseOriginOwner, resolveStateRepo } from './check-state-repo-private.mjs';

describe('parseArgs', () => {
  it('parses --repo', () => {
    expect(parseArgs(['--repo', 'octo/draftorb-state'])).toEqual({ repo: 'octo/draftorb-state' });
  });

  it('rejects unknown arguments', () => {
    expect(() => parseArgs(['--nope'])).toThrow('Unknown or incomplete argument');
  });
});

describe('parseOriginOwner', () => {
  it.each([
    'https://github.com/kiritoc/draftorb.git',
    'git@github.com:kiritoc/draftorb.git',
    'https://github.com/kiritoc/draftorb',
  ])('extracts owner from %s', (url) => {
    expect(parseOriginOwner(url)).toBe('kiritoc');
  });
});

describe('resolveStateRepo', () => {
  it('prefers --repo over env and default', () => {
    expect(resolveStateRepo({ repo: 'a/b' }, { DRAFTORB_STATE_REPO: 'c/d' }, 'owner')).toBe('a/b');
  });

  it('uses DRAFTORB_STATE_REPO when it contains a slash', () => {
    expect(resolveStateRepo({ repo: null }, { DRAFTORB_STATE_REPO: 'c/d' }, 'owner')).toBe('c/d');
  });

  it('prefixes a bare name with the origin owner', () => {
    expect(resolveStateRepo({ repo: null }, {}, 'kiritoc')).toBe('kiritoc/draftorb-state');
  });

  it('honors DRAFTORB_STATE_REPO as a bare name too', () => {
    expect(
      resolveStateRepo({ repo: null }, { DRAFTORB_STATE_REPO: 'other-state' }, 'kiritoc'),
    ).toBe('kiritoc/other-state');
  });

  it('fails without an owner for a bare name', () => {
    expect(() => resolveStateRepo({ repo: null }, {}, undefined)).toThrow(
      'Cannot determine the repository owner',
    );
  });
});
