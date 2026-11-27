/**
 * SetupStarters rendering contract (BL-031b, SPECS §18.5): data source and
 * evidence labels, starter-bundle cards with sample sizes on every number,
 * insufficient picks without a bare rate, the labeled D-103
 * broader-statistic fallback, and the honest no-profile-starter-data note
 * in myData mode.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  SETUP_STARTERS_RESULT_SCHEMA_VERSION,
  type SetupStarterPick,
  type SetupStartersResult,
} from '@draftorb/shared';

import type { ItemIconInfo } from '../data/items';
import { SetupStarters } from './SetupStarters';

const ITEMS: ReadonlyMap<number, ItemIconInfo> = new Map([
  [2052, { id: 2052, name: "Doran's Blade", icon: '2052.png' }],
  [3340, { id: 3340, name: 'Health Potion', icon: '3340.png' }],
]);

function pick(overrides: Partial<SetupStarterPick> = {}): SetupStarterPick {
  return {
    items: [
      { itemId: 2052, count: 1 },
      { itemId: 3340, count: 2 },
    ],
    winRate: 0.542,
    nEff: 38,
    players: 12,
    pickShare: 0.315,
    insufficientData: false,
    source: 'championContext',
    sourceLevel: 2,
    ...overrides,
  };
}

function result(overrides: Partial<SetupStartersResult> = {}): SetupStartersResult {
  return {
    schemaVersion: SETUP_STARTERS_RESULT_SCHEMA_VERSION,
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
    picks: [pick()],
    broaderStatistic: null,
    dataAvailable: true,
    ...overrides,
  };
}

function render(res: SetupStartersResult, profileLabel?: string): string {
  return renderToStaticMarkup(
    createElement(SetupStarters, {
      result: res,
      championName: 'Leona',
      roleName: 'Support',
      ...(profileLabel !== undefined ? { profileLabel } : {}),
      items: ITEMS,
      iconVersion: null,
    }),
  );
}

describe('SetupStarters', () => {
  it('renders the data source, evidence rule and bundle stats with samples', () => {
    const html = render(result());
    expect(html).toContain('Starting items — Leona');
    expect(html).toContain('Data source: expert aggregate (top players)');
    expect(html).toContain('at least 3 distinct players');
    expect(html).toContain('Doran&#x27;s Blade + Health Potion ×2');
    expect(html).toContain('Win rate 54.2%');
    expect(html).toContain('n≈38');
    expect(html).toContain('12 players');
    expect(html).toContain('Pick share 31.5%');
    expect(html).toContain('Based on: Champion context · level 2');
  });

  it('never shows a rate on an insufficient-data pick and shows the D-103 fallback', () => {
    const html = render(
      result({
        picks: [pick({ insufficientData: true, players: 2, winRate: 0.9, pickShare: 0.9 })],
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
    expect(html).toContain('Leona win rate in Support (all starter bundles)');
  });

  it('states honestly that the profile has no starter-window data in myData mode', () => {
    const html = render(
      result({
        mode: 'myData',
        dataSource: 'profile',
        evidence: { kind: 'profile', minSetupGames: 5 },
        picks: [],
        broaderStatistic: {
          kind: 'profileChampionWinRate',
          winRate: 0.55,
          nEff: 12,
          games: 12,
          insufficientData: false,
        },
        dataAvailable: false,
      }),
      "KiriToc's picks",
    );
    expect(html).toContain('does not record starter-window purchases');
    expect(html).toContain('Your win rate on Leona');
    expect(html).not.toContain('Doran');
  });

  it('shows the not-enough-data state when nothing is usable', () => {
    const html = render(
      result({
        picks: [],
        broaderStatistic: null,
        dataAvailable: false,
      }),
    );
    expect(html).toContain('Not enough data for starting item recommendations');
  });
});
