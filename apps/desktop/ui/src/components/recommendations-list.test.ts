/**
 * RecommendationsList rendering contract (SPECS §7.1, BL-016b): pool tags and
 * both ranks on cards, "Showing X of Y", "Show N more" pagination and
 * unavailable pool-champion cards after the ranked entries.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Champion, Recommendation } from '@draftorb/shared';

import { RecommendationsList, pageCountReducer } from './RecommendationsList';

const champions: Champion[] = [
  { id: 89, name: 'Leona', icon: 'Leona.png', roles: ['SUPPORT'] },
  { id: 16, name: 'Soraka', icon: 'Soraka.png', roles: ['SUPPORT'] },
  { id: 4, name: 'Tiama', icon: 'Tiama.png', roles: ['SUPPORT'] },
];

const rec = (championId: number, rank: number, poolRank?: number, score = 0.6): Recommendation => ({
  championId,
  rank,
  score,
  ...(poolRank !== undefined ? { poolRank } : {}),
  reasons: [],
  reliability: { nEff: 120, lowData: false },
  warnings: [],
});

const cardContext = { champions, iconVersion: null };

describe('recommendations pagination state', () => {
  it('reveals one page at a time and stops at the last page', () => {
    expect(pageCountReducer(1, { type: 'showMore', maxPages: 3 })).toBe(2);
    expect(pageCountReducer(3, { type: 'showMore', maxPages: 3 })).toBe(3);
  });

  it('resets to the first page when the draft input changes', () => {
    expect(pageCountReducer(4, { type: 'reset' })).toBe(1);
  });
});

describe('RecommendationsList', () => {
  it('shows the first page only, with "Showing X of Y" and a Show more button', () => {
    const recommendations = Array.from({ length: 7 }, (_, i) => rec(i + 1, i + 1));
    const markup = renderToStaticMarkup(
      createElement(RecommendationsList, {
        title: 'Best overall',
        recommendations,
        resetKey: 'draft',
        cardContext,
      }),
    );
    expect(markup).toContain('Showing 5 of 7');
    expect(markup).toContain('Show 2 more');
    // Only the first page of five cards is rendered.
    expect(markup.match(/<h3/g)?.length).toBe(5);
  });

  it('hides the Show more button when the list fits in one page', () => {
    const markup = renderToStaticMarkup(
      createElement(RecommendationsList, {
        title: 'Best overall',
        recommendations: [rec(89, 1)],
        resetKey: 'draft',
        cardContext,
      }),
    );
    expect(markup).toContain('Showing 1 of 1');
    expect(markup).not.toContain('Show ');
  });

  it('tags pool champions with both ranks on pool cards', () => {
    const markup = renderToStaticMarkup(
      createElement(RecommendationsList, {
        title: 'From your pool',
        recommendations: [rec(89, 14, 2)],
        resetKey: 'draft',
        poolIds: new Set([89]),
        cardContext,
      }),
    );
    expect(markup).toContain('In your pool · #2');
    expect(markup).toContain('#14');
  });

  it('tags pool champions in the overall list with "In your pool"', () => {
    const markup = renderToStaticMarkup(
      createElement(RecommendationsList, {
        title: 'Best overall',
        recommendations: [rec(89, 3), rec(16, 7)],
        resetKey: 'draft',
        poolIds: new Set([89]),
        cardContext,
      }),
    );
    expect(markup).toContain('In your pool');
    // Only the pool champion carries the tag.
    expect(markup.match(/In your pool/g)?.length).toBe(1);
  });

  it('renders unavailable pool champions after the ranked recommendations', () => {
    const markup = renderToStaticMarkup(
      createElement(RecommendationsList, {
        title: 'From your pool',
        recommendations: [rec(89, 1)],
        resetKey: 'draft',
        unavailable: [
          {
            championId: 16,
            reason: 'insufficientData',
            sample: { championId: 16, nEff: 20, rawGames: 30, winRate: 0.51 },
          },
        ],
        cardContext,
      }),
    );
    expect(markup).toContain('Showing 2 of 2');
    expect(markup).toContain('Soraka');
    expect(markup).toContain('Not recommended');
    // Insufficient-data card carries n_eff, raw games and the broader win rate.
    expect(markup).toContain('Sample 20.0');
    expect(markup).toContain('30 games');
    expect(markup).toContain('Broader win rate 51.0%');
    expect(markup.indexOf('Leona')).toBeLessThan(markup.indexOf('Soraka'));
  });

  it('renders pick share with its role-wide sample, or not enough data (BL-052)', () => {
    const markup = renderToStaticMarkup(
      createElement(RecommendationsList, {
        title: 'Best overall',
        recommendations: [rec(89, 1), rec(16, 2)],
        resetKey: 'draft',
        cardContext: {
          champions,
          iconVersion: null,
          role: 'SUPPORT',
          pickRate: { SUPPORT: { '89': 0.25, '16': 0.75 } },
          // 89 clears minGames (25); 16 is below it -> insufficient label.
          pickRateSamples: { SUPPORT: { '89': 40, '16': 12 } },
        },
      }),
    );
    expect(markup).toContain('Pick share 25.0% · n≈40 · all ranks');
    expect(markup).toContain('Pick share: not enough data (n≈12)');
  });

  it('hides the pick-share figure on legacy exports without the samples file', () => {
    const markup = renderToStaticMarkup(
      createElement(RecommendationsList, {
        title: 'Best overall',
        recommendations: [rec(89, 1)],
        resetKey: 'draft',
        cardContext: {
          champions,
          iconVersion: null,
          role: 'SUPPORT',
          pickRate: { SUPPORT: { '89': 0.25 } },
        },
      }),
    );
    expect(markup).not.toContain('Pick share');
  });

  it('tags a pool champion on an unavailable card in the overall list', () => {
    const markup = renderToStaticMarkup(
      createElement(RecommendationsList, {
        title: 'Best overall',
        recommendations: [rec(89, 1)],
        resetKey: 'draft',
        poolIds: new Set([16]),
        unavailable: [
          {
            championId: 16,
            reason: 'insufficientData',
            sample: { championId: 16, nEff: 20, rawGames: 30, winRate: 0.51 },
          },
        ],
        cardContext,
      }),
    );
    // Soraka is a pool member: her thin-data card carries the pool tag (SPECS §7.1).
    expect(markup).toContain('Soraka');
    expect(markup).toContain('In your pool');
    expect(markup.match(/In your pool/g)?.length).toBe(1);
  });

  it('omits the redundant pool tag when membership is implied by the list', () => {
    const markup = renderToStaticMarkup(
      createElement(RecommendationsList, {
        title: 'From your pool',
        recommendations: [],
        resetKey: 'draft',
        poolIds: new Set([16]),
        poolMembershipImplied: true,
        unavailable: [
          {
            championId: 16,
            reason: 'insufficientData',
            sample: { championId: 16, nEff: 20, rawGames: 30, winRate: 0.51 },
          },
        ],
        cardContext,
      }),
    );
    expect(markup).toContain('Soraka');
    expect(markup).not.toContain('In your pool');
  });

  it('renders the empty state', () => {
    const markup = renderToStaticMarkup(
      createElement(RecommendationsList, {
        title: 'Best overall',
        recommendations: [],
        resetKey: 'draft',
        cardContext,
      }),
    );
    expect(markup).toContain('No recommendations for this draft yet.');
  });
});
