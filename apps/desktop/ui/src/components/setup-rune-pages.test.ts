/**
 * SetupRunePages rendering contract (BL-030b, SPECS §18.5): data source and
 * evidence labels, top-3 page cards with sample sizes on every number,
 * insufficient-data pages without a bare rate, and the labeled D-103
 * broader-statistic fallback.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  SETUP_RESULT_SCHEMA_VERSION,
  type SetupRunePage,
  type SetupRuneResult,
} from '@draftorb/shared';

import type { RuneTrees } from '@draftorb/shared';

import type { RuneIconInfo } from '../data/runes';
import { buildRuneIconIndex } from '../data/runes';
import { SetupRunePages } from './SetupRunePages';

const TREES: RuneTrees = [
  {
    id: 8000,
    key: 'inspiration',
    name: 'Inspiration',
    icon: 'perk-images/Styles/7200_Inspiration.png',
    slots: [
      {
        runes: [{ id: 8112, key: 'phase-rush', name: 'Phase Rush', icon: 'perk-images/x.png' }],
      },
    ],
  },
  {
    id: 8100,
    key: 'precision',
    name: 'Precision',
    icon: 'perk-images/Styles/7201_Precision.png',
    slots: [],
  },
];

const ICONS: ReadonlyMap<number, RuneIconInfo> = buildRuneIconIndex(TREES);

function page(overrides: Partial<SetupRunePage> = {}): SetupRunePage {
  return {
    keystoneId: 8112,
    primaryStyleId: 8000,
    subStyleId: 8100,
    perkIds: [8010],
    statShardIds: [5001],
    winRate: 0.542,
    nEff: 38,
    players: 12,
    pickShare: 0.315,
    insufficientData: false,
    source: 'laneContext',
    sourceLevel: 1,
    ...overrides,
  };
}

function result(overrides: Partial<SetupRuneResult> = {}): SetupRuneResult {
  return {
    schemaVersion: SETUP_RESULT_SCHEMA_VERSION,
    championId: 7,
    myRole: 'SUPPORT',
    mode: 'topPlayers',
    dataSource: 'expertAggregate',
    evidence: {
      kind: 'expert',
      playerWeightCap: 30,
      minDistinctPlayers: 3,
      masterPlusOnly: false,
      masterPlusOptional: true,
    },
    pages: [page()],
    broaderStatistic: null,
    dataAvailable: true,
    ...overrides,
  };
}

function render(res: SetupRuneResult, profileLabel?: string): string {
  return renderToStaticMarkup(
    createElement(SetupRunePages, {
      result: res,
      championName: 'Leona',
      roleName: 'Support',
      ...(profileLabel !== undefined ? { profileLabel } : {}),
      icons: ICONS,
      iconVersion: null,
    }),
  );
}

describe('SetupRunePages', () => {
  it('renders the data source, evidence rule and page stats with samples', () => {
    const html = render(result());
    expect(html).toContain('Runes — Leona');
    expect(html).toContain('Data source: expert aggregate (top players)');
    expect(html).toContain('at least 3 distinct players');
    expect(html).toContain('Win rate 54.2%');
    expect(html).toContain('n≈38');
    expect(html).toContain('12 players');
    expect(html).toContain('Pick share 31.5%');
    expect(html).toContain('Phase Rush');
    expect(html).toContain('Based on: Lane context · level 1');
  });

  it('shows the profile data source with the profile label in myData mode', () => {
    const html = render(
      result({
        mode: 'myData',
        dataSource: 'profile',
        evidence: { kind: 'profile', minSetupGames: 5 },
        pages: [
          page({
            players: undefined,
            games: 24,
            pickShare: undefined,
            insufficientData: false,
            source: 'profileChampion',
            sourceLevel: 4,
          }),
        ],
      }),
      "KiriToc's picks",
    );
    expect(html).toContain('Data source: your profile — KiriToc&#x27;s picks');
    expect(html).toContain('at least 5 effective games');
    expect(html).toContain('24 games');
    expect(html).toContain('Based on: Champion record · level 4');
    expect(html).not.toContain('players');
  });

  it('never shows a rate on an insufficient-data page', () => {
    const html = render(
      result({
        pages: [page({ insufficientData: true, players: 2, winRate: 0.9, pickShare: 0.9 })],
        dataAvailable: false,
        broaderStatistic: {
          kind: 'championRoleWinRate',
          winRate: 0.51,
          nEff: 120,
          insufficientData: false,
        },
      }),
    );
    expect(html).toContain('Not enough data');
    expect(html).toContain('2 players');
    expect(html).not.toContain('Win rate 90.0%');
    expect(html).toContain('Broader statistic');
    expect(html).toContain('Leona win rate in Support');
    expect(html).toContain('Win rate 51.0%');
  });

  it('shows the not-enough-data state when the mode has no usable data', () => {
    const html = render(
      result({
        mode: 'myData',
        dataSource: 'profile',
        evidence: { kind: 'profile', minSetupGames: 5 },
        pages: [],
        broaderStatistic: null,
        dataAvailable: false,
      }),
    );
    expect(html).toContain('Not enough data for rune recommendations');
  });
});
