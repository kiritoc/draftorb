import { describe, expect, it } from 'vitest';

import { rankSummary } from './matches-store';

describe('rankSummary', () => {
  it('means known ranks among stored participants and always includes the seed', () => {
    const ranks = new Map([
      ['ally', 6.5],
      ['enemy', 7],
      ['spectator', 9],
    ]);

    expect(rankSummary(ranks, ['ally', 'unknown'], 'seed', 5)).toEqual({
      avg: (6.5 + 5) / 2,
      known: 2,
    });
    expect(rankSummary(ranks, ['ally', 'enemy'], 'ally', 5)).toEqual({
      avg: (6.5 + 7) / 2,
      known: 2,
    });
    expect(rankSummary(ranks, ['unknown'], 'seed', 6.5)).toEqual({ avg: 6.5, known: 1 });
  });

  it('ignores ranks for puuids that are not stored participants', () => {
    const ranks = new Map([['metadata-only', 9]]);
    expect(rankSummary(ranks, ['stored-a', 'stored-b'], 'seed', 6.5)).toEqual({
      avg: 6.5,
      known: 1,
    });
  });
});
