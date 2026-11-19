import { describe, expect, it } from 'vitest';
import { championIconUrl, resolveIconVersion } from './champion-icons';

describe('resolveIconVersion', () => {
  const versions = ['16.22.1', '16.21.1', '16.2.1'];

  it('matches a full version of the patch label', () => {
    expect(resolveIconVersion('16.22', versions)).toBe('16.22.1');
  });

  it('matches an exact label', () => {
    expect(resolveIconVersion('16.22', ['16.22'])).toBe('16.22');
  });

  it('does not match 16.2 against 16.22.1', () => {
    expect(resolveIconVersion('16.2', ['16.22.1'])).toBeNull();
    expect(resolveIconVersion('16.2', versions)).toBe('16.2.1');
  });

  it('returns null when missing', () => {
    expect(resolveIconVersion('15.1', versions)).toBeNull();
  });
});

describe('championIconUrl', () => {
  it('is null without a version', () => {
    expect(championIconUrl(null, 'Annie.png')).toBeNull();
  });

  it('builds the CDN URL and encodes the file name', () => {
    expect(championIconUrl('16.22.1', 'Annie.png')).toBe(
      'https://ddragon.leagueoflegends.com/cdn/16.22.1/img/champion/Annie.png',
    );
    expect(championIconUrl('16.22.1', "Kai'Sa x.png")).toBe(
      'https://ddragon.leagueoflegends.com/cdn/16.22.1/img/champion/Kai\'Sa%20x.png',
    );
  });
});
