import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { RuneRecommendationResult } from '@draftorb/shared';
import { buildRuneIconIndex } from '../data/runes.js';
import { RunesPanel } from './RunesPanel.js';
import type { RuneTrees } from '@draftorb/shared';

const trees: RuneTrees = [
  {
    id: 8000,
    key: 'Precision',
    icon: 'perk-images/Styles/7201_Precision.png',
    name: 'Precision',
    slots: [
      {
        runes: [
          {
            id: 8005,
            key: 'PressTheAttack',
            name: 'Press the Attack',
            icon: 'perk-images/Styles/Precision/PressTheAttack/PressTheAttack.png',
          },
        ],
      },
    ],
  },
  {
    id: 8400,
    key: 'Domination',
    icon: 'perk-images/Styles/7204_Domination.png',
    name: 'Domination',
    slots: [
      {
        runes: [
          {
            id: 8128,
            key: 'Electrocute',
            name: 'Electrocute',
            icon: 'perk-images/Styles/Domination/Electrocute/Electrocute.png',
          },
        ],
      },
    ],
  },
];

const icons = buildRuneIconIndex(trees);

const result: RuneRecommendationResult = {
  schemaVersion: 1,
  championId: 412,
  myRole: 'SUPPORT',
  damageMix: 'AD',
  pages: [
    {
      primaryStyleId: 8000,
      subStyleId: 8400,
      keystoneId: 8005,
      selectedPerkIds: [8005, 8010],
      statShardIds: [5008],
      winRate: 0.534,
      nEff: 87.4,
      pickShare: 0.41,
      lowData: false,
      contextKey: 'lane:a.ADC:10,e.SUPPORT:20,e.ADC:30',
      contextLevel: 1,
    },
  ],
  adaptationHints: [{ code: 'statShardsVsDamageMix', damageMix: 'AD', statShardIds: [5008] }],
  dataAvailable: true,
};

describe('RunesPanel', () => {
  it('renders pages with win rate paired to sample size and resolved icons', () => {
    const markup = renderToStaticMarkup(
      createElement(RunesPanel, {
        result,
        championName: 'Soraka',
        icons,
        iconVersion: '16.21.1',
      }),
    );
    expect(markup).toContain('Runes — Soraka');
    expect(markup).toContain('53.4% win rate');
    expect(markup).toContain('n_eff 87');
    expect(markup).toContain('41% pick share');
    expect(markup).toContain('Press the Attack');
    expect(markup).toContain('perk-images/Styles/7201_Precision.png');
    expect(markup).not.toContain('low data');
  });

  it('shows the low-data badge and the damage-mix adaptation hint', () => {
    const lowDataResult: RuneRecommendationResult = {
      ...result,
      pages: result.pages.map((p) => ({ ...p, lowData: true })),
    };
    const markup = renderToStaticMarkup(
      createElement(RunesPanel, {
        result: lowDataResult,
        championName: 'Soraka',
        icons,
        iconVersion: null,
      }),
    );
    expect(markup).toContain('low data');
    expect(markup).toContain('Enemy team is AD-heavy');
    // No CDN version -> letter placeholders instead of img tags.
    expect(markup).not.toContain('<img');
  });

  it('renders the unavailable state when no rune data exists', () => {
    const markup = renderToStaticMarkup(
      createElement(RunesPanel, {
        result: { ...result, dataAvailable: false, pages: [], adaptationHints: [] },
        championName: 'Soraka',
        icons,
        iconVersion: '16.21.1',
      }),
    );
    expect(markup).toContain('No rune data for this champion');
  });
});
