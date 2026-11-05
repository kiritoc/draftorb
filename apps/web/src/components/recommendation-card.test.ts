import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { type Recommendation } from '@draftorb/shared';
import { RecommendationCard, warningText } from './RecommendationCard.js';

const champions = [{ id: 89, name: 'Leona', icon: 'Leona.png', roles: ['SUPPORT' as const] }];

const recommendation: Recommendation = {
  championId: 89,
  rank: 3,
  score: 0.62,
  reasons: [],
  reliability: { nEff: 120, lowData: false },
  warnings: [],
};

describe('recommendation card pool tag', () => {
  it('tags a pool champion in the overall list via inPool', () => {
    const markup = renderToStaticMarkup(
      createElement(RecommendationCard, { recommendation, champions, inPool: true }),
    );
    expect(markup).toContain('In your pool');
  });

  it('shows the pool rank when poolRank is set', () => {
    const markup = renderToStaticMarkup(
      createElement(RecommendationCard, {
        recommendation: { ...recommendation, poolRank: 2 },
        champions,
      }),
    );
    expect(markup).toContain('In your pool · #2');
  });

  it('does not tag a champion outside the pool', () => {
    const markup = renderToStaticMarkup(
      createElement(RecommendationCard, { recommendation, champions }),
    );
    expect(markup).not.toContain('In your pool');
  });
});

describe('recommendation warning text', () => {
  it('renders hard-counter codes with the champion name', () => {
    expect(warningText('counteredBy:SUPPORT:89', champions)).toContain('Leona');
  });

  it('renders the off-role code as readable text', () => {
    expect(warningText('offRole', champions)).toContain('rarely played');
  });
});
