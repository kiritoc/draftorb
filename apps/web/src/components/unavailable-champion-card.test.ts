import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Champion } from '@draftorb/shared';
import type { PoolUnavailableItem } from '../pool/unavailable.js';
import { UnavailableChampionCard } from './UnavailableChampionCard.js';

const champions: Champion[] = [
  { id: 89, name: 'Leona', icon: 'Leona.png', roles: ['SUPPORT'] },
  { id: 16, name: 'Soraka', icon: 'Soraka.png', roles: ['SUPPORT'] },
];

function render(item: PoolUnavailableItem): string {
  return renderToStaticMarkup(createElement(UnavailableChampionCard, { item, champions }));
}

describe('UnavailableChampionCard', () => {
  it('shows the not-recommended badge, reason and win rate for insufficient data', () => {
    const markup = render({
      championId: 89,
      reason: 'insufficientData',
      sample: { championId: 89, nEff: 20.867837, rawGames: 32, winRate: 0.523 },
    });

    expect(markup).toContain('Leona');
    expect(markup).toContain('Not recommended');
    expect(markup).toContain('Insufficient data');
    expect(markup).toContain('n_eff 20.9');
    expect(markup).toContain('32 games');
    expect(markup).toContain('Win rate 52.3%');
  });

  it('shows a missing win rate when the baseline has no weighted evidence', () => {
    const markup = render({
      championId: 16,
      reason: 'insufficientData',
      sample: { championId: 16, nEff: 0 },
    });

    expect(markup).toContain('Soraka');
    expect(markup).toContain('Win rate');
    expect(markup).toContain('—');
    expect(markup).not.toContain('games');
  });

  it('shows the picked reason without a win rate', () => {
    const markup = render({ championId: 89, reason: 'picked' });

    expect(markup).toContain('Already picked');
    expect(markup).not.toContain('Win rate');
  });

  it('shows the unknown-champion reason', () => {
    const markup = render({ championId: 999, reason: 'unknownChampion' });

    expect(markup).toContain('Champion 999');
    expect(markup).toContain('Not in the champion catalogue');
  });
});
