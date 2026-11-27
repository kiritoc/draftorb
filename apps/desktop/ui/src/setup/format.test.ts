/**
 * Setup rune display-helper tests (BL-030b): honest-numbers formatting —
 * rates always carry their sample size, insufficient pages never show a
 * bare percentage, and every page names the statistic behind it (D-103).
 */

import { describe, expect, it } from 'vitest';

import type { SetupRunePage } from '@draftorb/shared';

import type { ItemIconInfo } from '../data/items';
import {
  broaderStatsText,
  dataSourceLabel,
  formatPercent,
  pageSourceLabel,
  pageStatsText,
  pickStatsText,
  starterItemsLabel,
  starterSourceLabel,
} from './format';

function page(overrides: Partial<SetupRunePage> = {}): SetupRunePage {
  return {
    keystoneId: 8112,
    primaryStyleId: 8000,
    subStyleId: 8100,
    perkIds: [8010],
    statShardIds: [5001],
    winRate: 0.542,
    nEff: 38.4,
    players: 12,
    pickShare: 0.315,
    insufficientData: false,
    source: 'laneContext',
    sourceLevel: 1,
    ...overrides,
  };
}

describe('formatPercent', () => {
  it('formats a fraction as one-decimal percent text', () => {
    expect(formatPercent(0.542)).toBe('54.2');
    expect(formatPercent(1)).toBe('100.0');
  });
});

describe('pageSourceLabel', () => {
  it('labels every expert and profile source level', () => {
    expect(pageSourceLabel('laneContext', 2)).toBe('Lane context · level 2');
    expect(pageSourceLabel('damageMix', 4)).toBe('Enemy damage mix');
    expect(pageSourceLabel('global', 5)).toBe('Champion global context');
    expect(pageSourceLabel('profileMatchup', 2)).toBe('Matchup context · level 2');
    expect(pageSourceLabel('profileChampion', 5)).toBe('Champion record · level 5');
    expect(pageSourceLabel('none', null)).toBe('No matching context');
  });
});

describe('pageStatsText', () => {
  it('shows win rate, effective sample, players and pick share for expert pages', () => {
    expect(pageStatsText(page())).toBe('Win rate 54.2% · n≈38 · 12 players · Pick share 31.5%');
  });

  it('shows games instead of players for profile pages', () => {
    const text = pageStatsText(
      page({
        players: undefined,
        games: 24,
        pickShare: undefined,
        source: 'profileChampion',
        sourceLevel: 4,
      }),
    );
    expect(text).toBe('Win rate 54.2% · n≈38 · 24 games');
  });

  it('never shows a rate on an insufficient-data page', () => {
    const text = pageStatsText(page({ insufficientData: true, players: 2, pickShare: 0.9 }));
    expect(text).toBe('Not enough data · n≈38 · 2 players');
  });

  it('shows "Not enough data" when winRate is null', () => {
    expect(pageStatsText(page({ winRate: null, insufficientData: true }))).toContain(
      'Not enough data',
    );
  });
});

describe('broaderStatsText', () => {
  it('keeps the rate and flags thin samples with the low-data label', () => {
    expect(
      broaderStatsText({
        kind: 'championRoleWinRate',
        winRate: 0.51,
        nEff: 9.6,
        insufficientData: true,
      }),
    ).toBe('Win rate 51.0% · n≈10 · low data');
  });

  it('shows not-enough-data without a rate when there is no evidence', () => {
    expect(
      broaderStatsText({
        kind: 'profileChampionWinRate',
        winRate: null,
        nEff: 0,
        games: 0,
        insufficientData: true,
      }),
    ).toBe('Not enough data · n≈0 · 0 games · low data');
  });
});

describe('dataSourceLabel', () => {
  it('labels both modes and their dataset', () => {
    expect(dataSourceLabel('expertAggregate')).toBe('expert aggregate (top players)');
    expect(dataSourceLabel('profile')).toBe('your profile export');
    expect(dataSourceLabel('profile', "KiriToc's picks")).toBe("your profile — KiriToc's picks");
  });
});

describe('pickStatsText', () => {
  it('shares the honest-numbers rules across spell pairs and starter bundles', () => {
    expect(
      pickStatsText({
        winRate: 0.542,
        nEff: 38.4,
        players: 12,
        pickShare: 0.315,
        insufficientData: false,
      }),
    ).toBe('Win rate 54.2% · n≈38 · 12 players · Pick share 31.5%');
    expect(
      pickStatsText({
        winRate: null,
        nEff: 3.2,
        games: 4,
        insufficientData: true,
      }),
    ).toBe('Not enough data · n≈3 · 4 games');
  });
});

describe('starterSourceLabel', () => {
  it('labels every starter back-off level', () => {
    expect(starterSourceLabel('laneContext', 1)).toBe('Lane context · level 1');
    expect(starterSourceLabel('championContext', 2)).toBe('Champion context · level 2');
    expect(starterSourceLabel('roleContext', 3)).toBe('Role context · level 3');
    expect(starterSourceLabel('global', 4)).toBe('Global context');
    expect(starterSourceLabel('none', null)).toBe('No matching context');
  });
});

describe('starterItemsLabel', () => {
  const catalog = new Map<number, ItemIconInfo>([
    [2052, { id: 2052, name: "Doran's Blade", icon: '2052.png' }],
    [3340, { id: 3340, name: 'Health Potion', icon: '3340.png' }],
  ]);

  it('joins catalog names and marks stacked counts', () => {
    expect(
      starterItemsLabel(
        [
          { itemId: 2052, count: 1 },
          { itemId: 3340, count: 2 },
        ],
        catalog,
      ),
    ).toBe("Doran's Blade + Health Potion ×2");
  });

  it('falls back to a labeled id for uncatalogued items', () => {
    expect(starterItemsLabel([{ itemId: 9999, count: 1 }], catalog)).toBe('Item 9999');
  });
});
