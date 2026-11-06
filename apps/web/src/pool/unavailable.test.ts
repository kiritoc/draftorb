import { describe, expect, it } from 'vitest';

import type { InsufficientDataEntry, PoolUnavailableEntry } from '@draftorb/shared';
import { buildPoolUnavailableItems } from './unavailable.js';

describe('buildPoolUnavailableItems', () => {
  const entries: PoolUnavailableEntry[] = [
    { championId: 1, reason: 'insufficientData' },
    { championId: 2, reason: 'picked' },
    { championId: 3, reason: 'unknownChampion' },
  ];
  const insufficientData: InsufficientDataEntry[] = [
    { championId: 1, nEff: 20.8, rawGames: 32, winRate: 0.52 },
  ];

  it('joins unavailable reasons with their insufficient-data sample', () => {
    expect(buildPoolUnavailableItems(entries, insufficientData)).toEqual([
      { championId: 1, reason: 'insufficientData', sample: insufficientData[0] },
      { championId: 2, reason: 'picked' },
      { championId: 3, reason: 'unknownChampion' },
    ]);
  });

  it('excludes the champion already picked by the user', () => {
    expect(buildPoolUnavailableItems(entries, insufficientData, 2)).toEqual([
      { championId: 1, reason: 'insufficientData', sample: insufficientData[0] },
      { championId: 3, reason: 'unknownChampion' },
    ]);
  });
});
