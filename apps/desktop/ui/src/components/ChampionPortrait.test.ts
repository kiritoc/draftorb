import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChampionPortrait, championInitials } from './ChampionPortrait';

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
