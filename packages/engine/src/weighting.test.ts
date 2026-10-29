import { describe, it, expect } from 'vitest';

import { DEFAULT_CONFIG } from './config.js';
import {
  combinedGameWeight,
  expertWeight,
  logit,
  nEff,
  rankDistanceWeight,
  recencyFactor,
  reliabilityFactor,
  shrink,
  sigmoid,
  toEquivalentCounts,
} from './weighting.js';

describe('rankDistanceWeight', () => {
  const tau = DEFAULT_CONFIG.tau; // 1.25
  const window = DEFAULT_CONFIG.rankWindowTiers; // 2

  it('returns 1 when game and user are in the same bucket', () => {
    expect(rankDistanceWeight(5, 5, tau, window)).toBeCloseTo(1);
  });

  it('returns exp(-dist/tau) for nearby buckets', () => {
    const expected = Math.exp(-1 / 1.25);
    expect(rankDistanceWeight(5, 4, tau, window)).toBeCloseTo(expected);
  });

  it('down-weights games above the user rank', () => {
    const expected = Math.exp(-2 / 1.25);
    expect(rankDistanceWeight(7, 5, tau, window)).toBeCloseTo(expected);
  });

  it('returns 0 for games below the rank window floor', () => {
    // user bucket 5, floor = 5 - 2 = 3; bucket 2 is below floor
    expect(rankDistanceWeight(2, 5, tau, window)).toBe(0);
  });

  it('returns 0 for games exactly at the floor', () => {
    // floor = userBucket - window; exactly at floor should still be used (>= floor)
    expect(rankDistanceWeight(3, 5, tau, window)).toBeCloseTo(Math.exp(-2 / 1.25));
  });

  it('returns 0 for games far above (large distance) but still > 0', () => {
    const w = rankDistanceWeight(7, 0, tau, window);
    expect(w).toBeGreaterThan(0);
    expect(w).toBeLessThan(1);
  });

  it('handles negative distances symmetrically', () => {
    const below = rankDistanceWeight(3, 5, tau, window);
    const above = rankDistanceWeight(7, 5, tau, window);
    expect(below).toBeCloseTo(above);
  });
});

describe('expertWeight', () => {
  const alpha = DEFAULT_CONFIG.alpha; // 0.25
  const wMax = DEFAULT_CONFIG.wMax; // 2.0

  it('returns 0 for games below the user rank', () => {
    expect(expertWeight(4, 5, alpha, wMax)).toBe(0);
  });

  it('returns 1 for games at the user rank', () => {
    expect(expertWeight(5, 5, alpha, wMax)).toBeCloseTo(1);
  });

  it('increases by alpha per tier above the user', () => {
    // 1 tier above: min(1 + 0.25 * 1, 2.0) = 1.25
    expect(expertWeight(6, 5, alpha, wMax)).toBeCloseTo(1.25);
    // 2 tiers above: min(1 + 0.25 * 2, 2.0) = 1.5
    expect(expertWeight(7, 5, alpha, wMax)).toBeCloseTo(1.5);
  });

  it('caps at wMax', () => {
    // 10 tiers above: min(1 + 0.25 * 10, 2.0) = min(3.5, 2.0) = 2.0
    expect(expertWeight(15, 5, alpha, wMax)).toBeCloseTo(2.0);
  });

  it('returns 0 for games at the same bucket when using < comparison', () => {
    // gameRank >= userRank is required
    expect(expertWeight(5, 5, alpha, wMax)).toBeCloseTo(1);
    expect(expertWeight(4, 5, alpha, wMax)).toBe(0);
  });
});

describe('recencyFactor', () => {
  const decay = DEFAULT_CONFIG.decay; // 0.85

  it('returns 1 for the current patch', () => {
    expect(recencyFactor(10, 10, decay)).toBeCloseTo(1);
  });

  it('returns decay^n for n patches behind', () => {
    expect(recencyFactor(9, 10, decay)).toBeCloseTo(0.85);
    expect(recencyFactor(8, 10, decay)).toBeCloseTo(0.85 ** 2);
  });

  it('returns decay^0 = 1 for same patch', () => {
    expect(recencyFactor(0, 0, decay)).toBeCloseTo(1);
  });

  it('decreases monotonically as patches get older', () => {
    const a = recencyFactor(7, 10, decay);
    const b = recencyFactor(8, 10, decay);
    const c = recencyFactor(9, 10, decay);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });
});

describe('reliabilityFactor', () => {
  const factor = DEFAULT_CONFIG.unknownRankFactor; // 0.5

  it('returns unknownRankFactor when only seed rank is known (count <= 1)', () => {
    expect(reliabilityFactor(0, factor)).toBeCloseTo(0.5);
    expect(reliabilityFactor(1, factor)).toBeCloseTo(0.5);
  });

  it('returns 1 when two or more ranks are known', () => {
    expect(reliabilityFactor(2, factor)).toBeCloseTo(1);
    expect(reliabilityFactor(10, factor)).toBeCloseTo(1);
  });
});

describe('combinedGameWeight', () => {
  it('multiplies kernel * recency * reliability', () => {
    const gameBucket = 5;
    const userBucket = 5;
    const patchIdx = 10;
    const currentPatch = 10;
    const rankKnown = 5; // full reliability

    const kernel = Math.exp(0); // 1
    const recency = 0.85 ** 0; // 1
    const reliability = 1; // 5 known

    expect(
      combinedGameWeight(gameBucket, userBucket, patchIdx, currentPatch, rankKnown, DEFAULT_CONFIG),
    ).toBeCloseTo(kernel * recency * reliability);
  });

  it('returns 0 when the rank kernel excludes the game', () => {
    // game is below the floor
    expect(combinedGameWeight(0, 5, 10, 10, 5, DEFAULT_CONFIG)).toBe(0);
  });

  it('applies unknownRankFactor when only seed rank is known', () => {
    const kernel = Math.exp(-1 / 1.25);
    const recency = 0.85;
    const reliability = 0.5;
    expect(combinedGameWeight(4, 5, 9, 10, 1, DEFAULT_CONFIG)).toBeCloseTo(
      kernel * recency * reliability,
    );
  });
});

describe('nEff', () => {
  it('returns n when all weights are 1', () => {
    // n games, each w=1: sum_w = n, sum_w2 = n, n_eff = n^2/n = n
    const n = 100;
    expect(nEff(n, n)).toBe(n);
  });

  it('returns 1 for a single game (w=1, w2=1)', () => {
    expect(nEff(1, 1)).toBe(1);
  });

  it('returns 0 when gamesW2 is 0', () => {
    expect(nEff(0, 0)).toBe(0);
  });

  it('n_eff < n when weights are uneven (heavy weight on one game)', () => {
    // 1 heavy weight (10) + 9 light (1): sum_w=19, sum_w2=109, n_eff=361/109≈3.31
    const n = nEff(19, 109);
    expect(n).toBeCloseTo(361 / 109, 5);
    expect(n).toBeLessThan(10); // far less than raw count of 10
  });

  it('n_eff approaches 1 when one game dominates', () => {
    // 1 game with w=100, 999 games with w=0.001
    const sumW = 100 + 999 * 0.001; // = 100.999
    const sumW2 = 10000 + 999 * 0.000001; // ≈ 10000
    const n = nEff(sumW, sumW2);
    expect(n).toBeCloseTo((100.999 * 100.999) / 10000, 3);
    expect(n).toBeLessThan(2);
  });
});

describe('toEquivalentCounts', () => {
  it('returns winsE = winsW and gamesE = gamesW when all weights are 1', () => {
    // 30 wins out of 100 games, each w=1: n_eff = 100
    const result = toEquivalentCounts(30, 100, 100);
    expect(result.winsE).toBeCloseTo(30);
    expect(result.gamesE).toBeCloseTo(100);
  });

  it('returns zero for everyone when no games', () => {
    const result = toEquivalentCounts(0, 0, 0);
    expect(result.winsE).toBe(0);
    expect(result.gamesE).toBe(0);
  });

  it('winsE/gamesE ratio equals the weighted win rate', () => {
    const winsW = 42;
    const gamesW = 100;
    const gamesW2 = 120;
    const result = toEquivalentCounts(winsW, gamesW, gamesW2);
    expect(result.winsE / result.gamesE).toBeCloseTo(winsW / gamesW);
  });

  it('handles uneven weights: games_e differs from games_w', () => {
    // 1 heavy (w=10) + 1 light (w=1): sum_w=11, sum_w2=101, n_eff=121/101≈1.198
    const result = toEquivalentCounts(10, 11, 101);
    expect(result.gamesE).toBeCloseTo(121 / 101, 5);
    expect(result.winsE).toBeCloseTo((10 * 121) / (101 * 11), 5);
  });
});

describe('logit and sigmoid', () => {
  const eps = DEFAULT_CONFIG.eps; // 1e-4

  it('logit(0.5) = 0', () => {
    expect(logit(0.5, eps)).toBeCloseTo(0);
  });

  it('sigmoid(0) = 0.5', () => {
    expect(sigmoid(0)).toBeCloseTo(0.5);
  });

  it('sigmoid(logit(p)) ≈ p within clamp', () => {
    for (const p of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(sigmoid(logit(p, eps))).toBeCloseTo(p);
    }
  });

  it('logit clamps to eps and 1-eps', () => {
    // logit(0) should equal logit(eps)
    expect(logit(0, eps)).toBeCloseTo(logit(eps, eps));
    // logit(1) should equal logit(1 - eps)
    expect(logit(1, eps)).toBeCloseTo(logit(1 - eps, eps));
  });

  it('sigmoid is bounded in (0, 1) for extreme inputs', () => {
    expect(sigmoid(-500)).toBeGreaterThan(0);
    expect(sigmoid(-500)).toBeLessThan(0.001);
    expect(sigmoid(500)).toBeGreaterThan(0.999);
    expect(sigmoid(500)).toBeLessThanOrEqual(1);
  });
});

describe('shrink', () => {
  it('shrinks toward q when data is small', () => {
    // 1 win out of 1 game, k=20, q=0.5 → (1 + 20*0.5)/(1 + 20) = 11/21 ≈ 0.524
    expect(shrink(1, 1, 20, 0.5)).toBeCloseTo(11 / 21, 5);
  });

  it('converges to the raw rate when data is large', () => {
    // 70 wins out of 100 games, k=20 → (70 + 10)/(100 + 20) = 80/120 = 0.667 (shrunk)
    // As k → 0: 70/100 = 0.7
    const withShrink = shrink(70, 100, 20, 0.5);
    expect(withShrink).toBeCloseTo(80 / 120, 5);
    expect(withShrink).toBeCloseTo(0.6667, 3);
  });

  it('returns q when games is 0', () => {
    expect(shrink(0, 0, 20, 0.5)).toBe(0.5);
  });

  it('shrinks toward q=0.5 with k0=20', () => {
    // 0 wins out of 1 game, k=20, q=0.5 → (0 + 10)/(1 + 20) = 10/21 ≈ 0.476
    expect(shrink(0, 1, 20, 0.5)).toBeCloseTo(10 / 21, 5);
  });

  it('returns the prior q when both evidence and prior strength are zero', () => {
    expect(shrink(0, 0, 0, 0.55)).toBe(0.55);
    expect(shrink(0, 0, 0, 0.7)).toBe(0.7);
  });
});
