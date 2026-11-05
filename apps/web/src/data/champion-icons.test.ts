import { describe, expect, it } from 'vitest';

import { championIconUrl, resolveIconVersion } from './champion-icons.js';

describe('resolveIconVersion', () => {
  const versions = ['16.23.1', '16.22.1', '16.21.2', '16.21.1'];

  it('maps a major.minor patch label to its newest full version', () => {
    expect(resolveIconVersion('16.22', versions)).toBe('16.22.1');
    expect(resolveIconVersion('16.21', versions)).toBe('16.21.2');
  });

  it('accepts an already-full version', () => {
    expect(resolveIconVersion('16.22.1', versions)).toBe('16.22.1');
  });

  it('returns null when no version matches', () => {
    expect(resolveIconVersion('99.99', versions)).toBeNull();
    expect(resolveIconVersion('16.2', versions)).toBeNull();
  });
});

describe('championIconUrl', () => {
  it('builds the Data Dragon CDN URL', () => {
    expect(championIconUrl('16.22.1', 'Annie.png')).toBe(
      'https://ddragon.leagueoflegends.com/cdn/16.22.1/img/champion/Annie.png',
    );
  });

  it('returns null without a resolved version', () => {
    expect(championIconUrl(null, 'Annie.png')).toBeNull();
  });

  it('encodes the icon file name', () => {
    expect(championIconUrl('16.22.1', 'a/b.png')).toContain('a%2Fb.png');
  });
});
