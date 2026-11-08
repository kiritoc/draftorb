import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Champion } from '@draftorb/shared';
import type { PersonalizedEntry } from '@draftorb/engine';

import { PersonalizedList } from './PersonalizedList.js';

const champions = [{ id: 1, name: 'TestChamp' }] as Champion[];

function entry(over: Partial<PersonalizedEntry> = {}): PersonalizedEntry {
  return {
    championId: 1,
    rank: 1,
    overallRank: 1,
    metaScore: 0.55,
    personalizedScore: 0.6,
    profileWinRate: 0.68,
    nEff: 11,
    fallbackLevel: 2,
    deltaVsBaselinePp: 7,
    baselineWinRate: 0.61,
    baselineBucket: 'DIAMOND',
    insufficientData: false,
    ...over,
  };
}

describe('PersonalizedList', () => {
  it('renders the profile label title and the WR/n_eff/level/delta badge', () => {
    const markup = renderToStaticMarkup(
      createElement(PersonalizedList, {
        title: "KiriToc's picks",
        entries: [entry()],
        champions,
        resetKey: 'k',
      }),
    );
    expect(markup).toContain('KiriToc&#x27;s picks');
    expect(markup).toContain('TestChamp');
    expect(markup).toContain('68% over 11 games vs this setup');
    expect(markup).toContain('+7 pp vs Diamond avg');
    expect(markup).not.toContain('For you');
  });

  it('renders insufficient data with n_eff and no percentage', () => {
    const markup = renderToStaticMarkup(
      createElement(PersonalizedList, {
        title: 'Profile',
        entries: [
          entry({
            insufficientData: true,
            profileWinRate: null,
            nEff: 1.4,
            fallbackLevel: null,
            deltaVsBaselinePp: null,
            baselineWinRate: null,
            baselineBucket: null,
          }),
        ],
        champions,
        resetKey: 'k',
      }),
    );
    expect(markup).toContain('Insufficient data');
    expect(markup).toContain('n_eff');
    expect(markup).not.toContain('68%');
  });

  it('renders the empty state', () => {
    const markup = renderToStaticMarkup(
      createElement(PersonalizedList, {
        title: 'Profile',
        entries: [],
        champions,
        resetKey: 'k',
      }),
    );
    expect(markup).toContain('No recommendations yet');
  });
});
