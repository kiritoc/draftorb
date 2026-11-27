/**
 * UnavailableChampionCard thin-data contract (BL-017, D-103, SPECS §7): an
 * insufficient-data champion shows the broader statistic — the baseline win
 * rate in the role — labeled as broader, with its own sample size. A champion
 * with zero evidence shows "insufficient data" with n=0 and no fabricated
 * percentage (golden rule 8).
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Champion } from '@draftorb/shared';

import { UnavailableChampionCard } from './UnavailableChampionCard';

const champions: Champion[] = [
  { id: 89, name: 'Leona', icon: 'Leona.png', roles: ['SUPPORT'] },
  { id: 4, name: 'Twitch', icon: 'Twitch.png', roles: ['ADC'] },
];

const render = (
  sample: { championId: number; nEff: number; rawGames?: number; winRate?: number } | undefined,
): string =>
  renderToStaticMarkup(
    createElement(UnavailableChampionCard, {
      championId: 4,
      reason: 'insufficientData',
      sample,
      champions,
      iconVersion: null,
    }),
  );

describe('UnavailableChampionCard thin-data fallback', () => {
  it('labels the baseline win rate as the broader statistic with its sample size', () => {
    const markup = render({ championId: 4, nEff: 18.5, rawGames: 21, winRate: 0.545 });
    expect(markup).toContain('Twitch');
    expect(markup).toContain('Not recommended');
    expect(markup).toContain('Sample 18.5');
    expect(markup).toContain('21 games');
    expect(markup).toContain('Broader win rate 54.5%');
    // The broader stat must not be mistaken for a matchup-adjusted score.
    expect(markup).not.toContain('>Win rate<');
  });

  it('omits the win rate when the sample carries no weighted evidence', () => {
    const markup = render({ championId: 4, nEff: 0 });
    expect(markup).toContain('Twitch');
    expect(markup).toContain('Sample 0.0');
    expect(markup).not.toContain('Broader win rate');
    expect(markup).not.toContain('%');
  });

  it('still renders the reason alone when no sample is attached', () => {
    const markup = render(undefined);
    expect(markup).toContain('Twitch');
    expect(markup).toContain('Not enough data');
    expect(markup).not.toContain('Broader win rate');
  });
});
