import { describe, it, expect } from 'vitest';

import { DEFAULT_CONFIG } from './config.js';
import { sigmoid, toEquivalentCounts } from './weighting.js';
import {
  baselineGate,
  baselineLogOdds,
  deltaPp,
  layerTerm,
  laneTerm,
  layerWinRate,
  mapDeltaPpToLevel,
  pairTerm,
} from './levels.js';

describe('layerWinRate', () => {
  it('shrinks toward q when evidence is small (k in raw-game units)', () => {
    // 1 win out of 1 equivalent game, k=20 → (1 + 20*0.5)/(1+20) = 11/21
    expect(layerWinRate(1, 1, 20, 0.5)).toBeCloseTo(11 / 21, 5);
  });

  it('converges to the raw rate when evidence dominates', () => {
    // k→0: pL = winsE/gamesE
    const p = layerWinRate(70, 100, 0, 0.5);
    expect(p).toBeCloseTo(0.7, 5);
  });

  it('returns the prior q when there is no evidence', () => {
    expect(layerWinRate(0, 0, 20, 0.5)).toBe(0.5);
  });

  it('k is in raw-game units: heavily weighted small sample shrinks like n_eff raw games', () => {
    // Weighted sample: Σw = 10, Σw² = 20 → n_eff = 5; weighted win rate 0.6.
    const { winsE, gamesE } = toEquivalentCounts(6, 10, 20);
    expect(gamesE).toBeCloseTo(5, 10);
    expect(winsE).toBeCloseTo(3, 10);

    // Shrinks exactly like 3 wins out of 5 raw games.
    const pEquiv = layerWinRate(winsE, gamesE, 20, 0.5);
    const pRaw = layerWinRate(3, 5, 20, 0.5);
    expect(pEquiv).toBeCloseTo(pRaw, 10);

    // Feeding the weighted counts directly would under-shrink (6/10 vs k=20).
    const pNaive = layerWinRate(6, 10, 20, 0.5);
    expect(Math.abs(pNaive - pEquiv)).toBeGreaterThan(1e-3);

    // More equivalent games at the same rate → weaker shrinkage.
    const pLarge = layerWinRate(30, 50, 20, 0.5);
    expect(pLarge).toBeGreaterThan(pEquiv);
  });
});

describe('layerTerm', () => {
  it('is zero when pL equals the prior q', () => {
    expect(layerTerm(0.5, 0.5, DEFAULT_CONFIG.eps)).toBeCloseTo(0);
  });

  it('is positive when pL > q', () => {
    expect(layerTerm(0.6, 0.5, DEFAULT_CONFIG.eps)).toBeGreaterThan(0);
  });

  it('is negative when pL < q', () => {
    expect(layerTerm(0.4, 0.5, DEFAULT_CONFIG.eps)).toBeLessThan(0);
  });

  it('shrinks toward q by default (D-021)', () => {
    // Without shrinkage, a 10/10 record would give logit(1) = +inf.
    // With k=20, q=0.5: pL = (10 + 10) / (10 + 20) = 20/30 = 0.667
    const pL = layerWinRate(10, 10, 20, 0.6);
    expect(pL).toBeLessThan(1);
    expect(layerTerm(pL, 0.6, DEFAULT_CONFIG.eps)).toBeGreaterThan(0);
    expect(Number.isFinite(layerTerm(pL, 0.6, DEFAULT_CONFIG.eps))).toBe(true);
  });
});

describe('pairTerm', () => {
  it('computes logit(pL) - logit(p0) for the pair', () => {
    const p0 = 0.5;
    const pairWins = 5;
    const pairGamesE = 10;
    const k = DEFAULT_CONFIG.k; // 40
    const pL = layerWinRate(pairWins, pairGamesE, k, p0);
    const expected = Math.log(pL / (1 - pL)) - Math.log(p0 / (1 - p0));
    expect(pairTerm(pairWins, pairGamesE, k, p0, DEFAULT_CONFIG.eps, 0)).toBeCloseTo(expected);
  });

  it('is 0 when lowData (gamesE < minGames), nonzero at minGames', () => {
    const m = DEFAULT_CONFIG.minGames;
    expect(pairTerm(m - 1, m - 1, 40, 0.5, DEFAULT_CONFIG.eps, m)).toBe(0);
    expect(pairTerm(m, m, 40, 0.5, DEFAULT_CONFIG.eps, m)).toBeGreaterThan(0);
  });

  it('returns 0 when there is no pair data (n_eff = 0)', () => {
    expect(pairTerm(0, 0, 40, 0.5, DEFAULT_CONFIG.eps)).toBeCloseTo(0);
  });

  it('clamps probabilities to [eps, 1-eps] to avoid infinity', () => {
    // Perfect record with zero prior strength would be logit(1) = inf without clamping.
    const term = pairTerm(10, 10, 0, 0.5, DEFAULT_CONFIG.eps, 0);
    expect(Number.isFinite(term)).toBe(true);
  });
});

describe('deltaPp', () => {
  it('converts a log-odds term to percentage-point delta', () => {
    // deltaPp = 100 * (sigmoid(x + term) - sigmoid(x))
    const x = 0; // logit(0.5)
    const term = DEFAULT_CONFIG.eps;
    const expected = 100 * (1 / (1 + Math.exp(-term)) - 0.5);
    expect(deltaPp(x, term)).toBeCloseTo(expected);
  });

  it('returns 0 when the term is 0', () => {
    expect(deltaPp(0.5, 0)).toBeCloseTo(0);
  });

  it('is positive when the term is positive', () => {
    expect(deltaPp(0, 0.1)).toBeGreaterThan(0);
  });
});

describe('mapDeltaPpToLevel', () => {
  it('returns 0 for |deltaPp| < 1.0', () => {
    expect(mapDeltaPpToLevel(0.5, 100)).toBe(0);
  });

  it('returns +1 for deltaPp >= 1.0 with sufficient n_eff', () => {
    expect(mapDeltaPpToLevel(1.0, 100)).toBe(1);
    expect(mapDeltaPpToLevel(1.5, 100)).toBe(1);
  });

  it('returns +2 for deltaPp >= 2.5 with sufficient n_eff', () => {
    expect(mapDeltaPpToLevel(2.5, 100)).toBe(2);
    expect(mapDeltaPpToLevel(3.0, 100)).toBe(2);
  });

  it('returns +3 for deltaPp >= 4.5 with sufficient n_eff', () => {
    expect(mapDeltaPpToLevel(4.5, 100)).toBe(3);
    expect(mapDeltaPpToLevel(5.0, 100)).toBe(3);
  });

  it('returns negative levels for negative deltas', () => {
    expect(mapDeltaPpToLevel(-1.0, 100)).toBe(-1);
    expect(mapDeltaPpToLevel(-2.5, 100)).toBe(-2);
    expect(mapDeltaPpToLevel(-4.5, 100)).toBe(-3);
  });

  it('falls back to L1 for large positive deltas when n_eff < 100', () => {
    expect(mapDeltaPpToLevel(5.0, 99)).toBe(1);
    expect(mapDeltaPpToLevel(5.0, 50)).toBe(1);
  });

  it('returns 0 for lowData reasons (n_eff < minGames), both signs', () => {
    expect(mapDeltaPpToLevel(1.1, 0)).toBe(0);
    expect(mapDeltaPpToLevel(-1.1, 0)).toBe(0);
    expect(mapDeltaPpToLevel(3.0, DEFAULT_CONFIG.minGames - 1)).toBe(0);
    expect(mapDeltaPpToLevel(-3.0, DEFAULT_CONFIG.minGames - 1)).toBe(0);
  });

  it('allows negative levels with low n_eff (counters are not gated)', () => {
    // Negative deltas indicate being countered; they should still show.
    expect(mapDeltaPpToLevel(-1.5, 30)).toBe(-1);
    expect(mapDeltaPpToLevel(-2.6, 50)).toBe(-2);
  });

  it('L1 does not require n_eff >= 100 (only L2/L3 do)', () => {
    // A small but real effect shows as L1 even with modest n_eff.
    expect(mapDeltaPpToLevel(1.0, 30)).toBe(1);
    // The lowData gate (minGames) is the caller's responsibility: when a term
    // is lowData its deltaPp collapses to ~0, so the level is naturally 0.
    // The level function itself only gates L2/L3 by n_eff >= 100.
    expect(mapDeltaPpToLevel(2.5, 99)).toBe(1); // n_eff < 100 → L1 fallback
    expect(mapDeltaPpToLevel(4.5, 99)).toBe(1); // n_eff < 100 → L1 fallback
    expect(mapDeltaPpToLevel(2.5, 100)).toBe(2);
    expect(mapDeltaPpToLevel(4.5, 100)).toBe(3);
  });
});

describe('baselineGate', () => {
  it('passes when n_eff >= minGames', () => {
    expect(baselineGate(25, DEFAULT_CONFIG.minGames)).toBe(true);
    expect(baselineGate(100, DEFAULT_CONFIG.minGames)).toBe(true);
  });

  it('fails when n_eff < minGames', () => {
    expect(baselineGate(24, DEFAULT_CONFIG.minGames)).toBe(false);
    expect(baselineGate(0, DEFAULT_CONFIG.minGames)).toBe(false);
  });
});

describe('baselineLogOdds', () => {
  it('computes logit((wins + k0*0.5)/(games + k0))', () => {
    // 30 wins, 100 games, k0=20 → p0 = (30 + 10)/(100 + 20) = 40/120 = 0.333
    const eps = DEFAULT_CONFIG.eps;
    const p0 = (30 + 20 * 0.5) / (100 + 20);
    const expected = Math.log(p0 / (1 - p0));
    expect(baselineLogOdds(30, 100, DEFAULT_CONFIG.k0, eps)).toBeCloseTo(expected);
  });

  it('returns logit(0.5) = 0 when there is no data', () => {
    // 0 wins, 0 games, k0=20 → p0 = (0 + 10)/(0 + 20) = 0.5
    const eps = DEFAULT_CONFIG.eps;
    const p0 = (0 + 20 * 0.5) / (0 + 20);
    expect(p0).toBeCloseTo(0.5);
    expect(baselineLogOdds(0, 0, DEFAULT_CONFIG.k0, eps)).toBeCloseTo(0);
  });

  it('never produces infinity or NaN', () => {
    const eps = DEFAULT_CONFIG.eps;
    expect(Number.isFinite(baselineLogOdds(100, 100, DEFAULT_CONFIG.k0, eps))).toBe(true);
    expect(Number.isFinite(baselineLogOdds(0, 0, 0, eps))).toBe(true);
  });
});

describe('non-support lane group (TOP)', () => {
  it('pair + lane_vs chain works for TOP (lane_full skipped)', () => {
    // SPECS §5: TOP lane group = me vs enemy top (1v1), lane_full skipped.
    // Baseline: 40 wins / 100 equivalent games.
    const eps = DEFAULT_CONFIG.eps;
    const k0 = DEFAULT_CONFIG.k0;
    const k = DEFAULT_CONFIG.k;

    const p0 = (40 + k0 * 0.5) / (100 + k0);
    const baseline = baselineLogOdds(40, 100, k0, eps);

    const s = DEFAULT_CONFIG.s;
    const kLane = DEFAULT_CONFIG.kLane;

    // Pair term: enemy top matchup, 18 wins / 30 games equivalent (0.6 > p0).
    const pairT = pairTerm(18, 30, k, p0, eps);
    expect(pairT).toBeGreaterThan(0);

    // Running prediction after the pair layer; lane_vs shrinks toward it.
    const q = sigmoid(baseline + s * pairT);
    expect(q).toBeGreaterThan(p0);

    // Small exact context (n_eff < minGames) → lowData, falls back to the pair estimate.
    const smallLaneT = laneTerm(7, 10, kLane, q, eps);
    expect(smallLaneT).toBe(0);
    expect(sigmoid(baseline + s * pairT + smallLaneT)).toBeCloseTo(q, 10);

    // Large exact context dominates: score moves from q toward the lane rate (0.7).
    const largeLaneT = laneTerm(280, 400, kLane, q, eps);
    const largeScore = sigmoid(baseline + s * pairT + largeLaneT);
    expect(largeLaneT).toBeGreaterThan(0);
    expect(largeScore).toBeCloseTo((280 + kLane * q) / (400 + kLane), 10);
    expect(Math.abs(largeScore - 0.7)).toBeLessThan(Math.abs(q - 0.7));

    // lane_full is skipped for TOP (1v1): no further layer is applied.
    expect(Number.isFinite(largeScore)).toBe(true);
  });
});
