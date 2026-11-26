/**
 * PickRecommendations static-render contract (BL-016b, SPECS §7.1): the
 * empty-pool call to action, both lists present, and the "Hide my pool"
 * toggle label. List shaping itself is covered by pick.test.ts and
 * recommendations-list.test.ts.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Champion, PoolConfig, Recommendation } from '@draftorb/shared';
import { emptyPool, setChampionRoles } from '../pool/pool-model';
import { PickRecommendations, type PickRecommendationsProps } from './PickRecommendations';

const champions: Champion[] = [
  { id: 89, name: 'Leona', icon: 'Leona.png', roles: ['SUPPORT'] },
  { id: 16, name: 'Soraka', icon: 'Soraka.png', roles: ['SUPPORT'] },
];

const rec = (championId: number, rank: number, poolRank?: number): Recommendation => ({
  championId,
  rank,
  score: 0.6,
  ...(poolRank !== undefined ? { poolRank } : {}),
  reasons: [],
  reliability: { nEff: 120, lowData: false },
  warnings: [],
});

const base: PickRecommendationsProps = {
  role: 'SUPPORT',
  poolIds: [],
  poolConfig: emptyPool(),
  champions,
  profileLoad: { kind: 'none', reason: 'noFolder' },
  userChampionId: null,
  recommendations: [rec(89, 1), rec(16, 2)],
  poolRecommendations: [],
  poolUnavailable: [],
  insufficientData: [],
  resetKey: 'draft',
  onSavePool: async () => [],
  editorOpen: false,
  onEditorOpenChange: () => {},
};

const render = (overrides: Partial<PickRecommendationsProps> = {}): string =>
  renderToStaticMarkup(createElement(PickRecommendations, { ...base, ...overrides }));

describe('PickRecommendations', () => {
  it('shows the empty-pool call to action and Best overall with an empty pool', () => {
    const markup = render();
    expect(markup).toContain('No Support champions in your pool.');
    expect(markup).toContain('Edit your pool');
    expect(markup).toContain('Best overall');
    expect(markup).not.toContain('From your pool');
  });

  it('shows From your pool above Best overall when the role pool is non-empty', () => {
    const poolConfig: PoolConfig = setChampionRoles(emptyPool(), 89, ['SUPPORT']).pool;
    const markup = render({
      poolIds: [89],
      poolConfig,
      poolRecommendations: [rec(89, 4, 1)],
    });
    expect(markup.indexOf('From your pool')).toBeLessThan(markup.indexOf('Best overall'));
    expect(markup).toContain('In your pool · #1');
    expect(markup).toContain('Hide my pool');
  });

  it('always renders the pool editor (closed by default)', () => {
    expect(render()).not.toContain('Champion pool editor');
    expect(render({ editorOpen: true })).toContain('Champion pool editor');
  });

  it('renders thin-data champions as unavailable cards with the broader statistic (BL-017)', () => {
    const markup = render({
      champions: [
        ...champions,
        { id: 4, name: 'Twitch', icon: 'Twitch.png', roles: ['ADC'] },
        { id: 7, name: 'Xin Zhao', icon: 'XinZhao.png', roles: ['JUNGLE'] },
      ],
      insufficientData: [
        { championId: 4, nEff: 18.5, rawGames: 21, winRate: 0.545 },
        { championId: 7, nEff: 0 },
      ],
    });
    // The broader statistic is labeled as broader and carries its sample size.
    expect(markup).toContain('Twitch');
    expect(markup).toContain('Broader win rate 54.5%');
    expect(markup).toContain('Sample 18.5');
    expect(markup).toContain('21 games');
    // Zero evidence renders "insufficient data" with n=0 and no fabricated %.
    expect(markup).toContain('Xin Zhao');
    expect(markup).toContain('Sample 0.0');
    // Thin-data cards sit after the ranked recommendations, never scored.
    expect(markup.indexOf('Soraka')).toBeLessThan(markup.indexOf('Twitch'));
    expect(markup.match(/Not recommended/g)?.length).toBe(2);
  });
});
