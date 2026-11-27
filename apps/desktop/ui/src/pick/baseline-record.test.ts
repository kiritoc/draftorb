import { describe, expect, it } from 'vitest';

import { indexBaselines } from '@draftorb/engine';
import type { BaselineTable } from '@draftorb/shared';

import { championMetaRecord } from './baseline-record';

// Rows: [championId, bucket, wins_w, games_w, games_w2, rawGames?].
// n_eff = games_w^2 / games_w2; gate is n_eff >= DEFAULT_CONFIG.minGames (25).
const table: BaselineTable = [
  // n_eff = 100^2/40 = 250 -> passes; p0 = (150 + 10) / (250 + 20) ≈ 0.5926.
  [1, 'DIAMOND', 60, 100, 40, 120],
  // n_eff = 50 -> passes on GOLD with a different win rate.
  [1, 'GOLD', 30, 50, 50, 60],
  // n_eff = 10 -> fails the baseline gate.
  [2, 'DIAMOND', 5, 10, 10, 12],
  // No weighted evidence (games_w = 0) -> gamesE = 0.
  [3, 'DIAMOND', 0, 0, 0, 0],
];

describe('championMetaRecord', () => {
  const index = indexBaselines(table, 'DIAMOND');

  it('returns the shrunk baseline win rate and n_eff for a passing row', () => {
    const meta = championMetaRecord(index, 1);
    expect(meta).not.toBeNull();
    expect(meta?.nEff).toBeCloseTo(250);
    expect(meta?.winRate).toBeCloseTo(160 / 270);
  });

  it('follows the rank bucket the index was built for', () => {
    const gold = championMetaRecord(indexBaselines(table, 'GOLD'), 1);
    // p0 = (30 + 10) / (50 + 20) = 4/7 ≈ 0.5714 on GOLD vs ≈ 0.5926 on DIAMOND.
    expect(gold?.winRate).toBeCloseTo(4 / 7);
  });

  it('returns null below the baseline gate, without evidence, or for an unknown champion', () => {
    expect(championMetaRecord(index, 2)).toBeNull();
    expect(championMetaRecord(index, 3)).toBeNull();
    expect(championMetaRecord(index, 999)).toBeNull();
  });
});
