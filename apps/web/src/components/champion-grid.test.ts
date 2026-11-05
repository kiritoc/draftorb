import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Champion } from '@draftorb/shared';

import { ChampionGrid } from './ChampionGrid.js';

const champions: Champion[] = [
  { id: 1, name: 'Zyra', icon: 'Zyra.png', roles: ['SUPPORT'] },
  { id: 2, name: 'Annie', icon: 'Annie.png', roles: ['MID', 'SUPPORT'] },
  { id: 3, name: 'Darius', icon: 'Darius.png', roles: ['TOP'] },
];

describe('ChampionGrid', () => {
  it('renders every champion with avatar URL and roles', () => {
    const markup = renderToStaticMarkup(
      createElement(ChampionGrid, {
        champions,
        role: 'SUPPORT',
        selectedIds: new Set<number>(),
        iconVersion: '16.22.1',
        onToggle: () => {},
      }),
    );

    expect(markup).toContain('Zyra');
    expect(markup).toContain('Annie');
    expect(markup).toContain('Darius');
    expect(markup).toContain('cdn/16.22.1/img/champion/Zyra.png');
    expect(markup).toContain('TOP');
  });

  it('pins selected champions first and marks them pressed', () => {
    const markup = renderToStaticMarkup(
      createElement(ChampionGrid, {
        champions,
        role: 'SUPPORT',
        selectedIds: new Set([3]),
        iconVersion: '16.22.1',
        onToggle: () => {},
      }),
    );

    expect(markup.indexOf('Darius')).toBeLessThan(markup.indexOf('Annie'));
    expect(markup.match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  it('marks off-role champions and falls back to a placeholder without icons', () => {
    const markup = renderToStaticMarkup(
      createElement(ChampionGrid, {
        champions,
        role: 'SUPPORT',
        selectedIds: new Set<number>(),
        iconVersion: null,
        onToggle: () => {},
      }),
    );

    expect(markup).toContain('off-role');
    expect(markup).not.toContain('img/champion');
    expect(markup).toContain('>D<');
  });
});
