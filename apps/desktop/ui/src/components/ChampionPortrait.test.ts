import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChampionPortrait, championInitials, shouldShowImage } from './ChampionPortrait';

describe('shouldShowImage', () => {
  it('shows the image when a URL is present and has not failed', () => {
    expect(shouldShowImage('https://x/a.png', null)).toBe(true);
  });

  it('falls back after the URL failed to load', () => {
    expect(shouldShowImage('https://x/a.png', 'https://x/a.png')).toBe(false);
  });

  it('retries when the URL changes after a failure', () => {
    expect(shouldShowImage('https://x/b.png', 'https://x/a.png')).toBe(true);
  });

  it('falls back without a URL', () => {
    expect(shouldShowImage(null, null)).toBe(false);
  });
});

describe('championInitials', () => {
  it.each([
    ['Miss Fortune', 'MF'],
    ["Kai'Sa", 'K'],
    ['annie', 'A'],
    ['Lee Sin Extra', 'LS'],
    ['  ', '?'],
    ['', '?'],
  ])('%j -> %s', (name, expected) => {
    expect(championInitials(name)).toBe(expected);
  });
});

describe('ChampionPortrait', () => {
  it('renders an img with alt when the URL is present', () => {
    const html = renderToStaticMarkup(
      createElement(ChampionPortrait, { name: 'Annie', iconUrl: 'https://x/Annie.png' }),
    );
    expect(html).toContain('<img');
    expect(html).toContain('alt="Annie"');
    expect(html).toContain('src="https://x/Annie.png"');
  });

  it('renders the initials fallback when the URL is null', () => {
    const html = renderToStaticMarkup(
      createElement(ChampionPortrait, { name: 'Miss Fortune', iconUrl: null }),
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('>MF<');
    expect(html).toContain('aria-label="Miss Fortune"');
  });
});
