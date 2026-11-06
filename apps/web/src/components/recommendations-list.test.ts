import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { type Champion, type Recommendation } from '@draftorb/shared';
import { RecommendationsList, pageCountReducer } from './RecommendationsList.js';

describe('recommendations pagination state', () => {
  it('reveals one page at a time and stops at the last page', () => {
    expect(pageCountReducer(1, { type: 'showMore', maxPages: 3 })).toBe(2);
    expect(pageCountReducer(3, { type: 'showMore', maxPages: 3 })).toBe(3);
  });

  it('resets to the first page when the draft input changes', () => {
    expect(pageCountReducer(4, { type: 'reset' })).toBe(1);
  });
});

describe('RecommendationsList unavailable entries', () => {
  const champions: Champion[] = [
    { id: 89, name: 'Leona', icon: 'Leona.png', roles: ['SUPPORT'] },
    { id: 16, name: 'Soraka', icon: 'Soraka.png', roles: ['SUPPORT'] },
  ];
  const recommendation: Recommendation = {
    championId: 89,
    rank: 1,
    score: 0.6,
    reasons: [],
    reliability: { nEff: 120, lowData: false },
    warnings: [],
  };

  it('renders unavailable pool champions after the ranked recommendations', () => {
    const markup = renderToStaticMarkup(
      createElement(RecommendationsList, {
        title: 'From your pool',
        recommendations: [recommendation],
        champions,
        resetKey: 'draft',
        unavailable: [
          {
            championId: 16,
            reason: 'insufficientData',
            sample: { championId: 16, nEff: 20, rawGames: 30, winRate: 0.51 },
          },
        ],
      }),
    );

    expect(markup).toContain('Showing 2 of 2');
    expect(markup).toContain('Leona');
    expect(markup).toContain('Soraka');
    expect(markup).toContain('Not recommended');
    expect(markup).toContain('Win rate 51.0%');
    expect(markup.indexOf('Leona')).toBeLessThan(markup.indexOf('Soraka'));
  });
});
