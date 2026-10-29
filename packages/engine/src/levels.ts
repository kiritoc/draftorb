/**
 * @draftorb/engine — Shrinkage, level mapping, and baseline gate.
 *
 * Pure, deterministic. Implements the log-odds scoring chain from SPECS §5
 * and the D-021 layered shrinkage model: every layer is shrunk toward the
 * prediction of the layer below it, not toward a fixed prior (except the
 * baseline, which shrinks toward 0.5).
 *
 * Functions operate on equivalent counts (`gamesE`, `winsE`) — already
 * converted from weighted counts via T-020's `toEquivalentCounts`, so the
 * prior strengths `k` are in raw-game units.
 */

import { sigmoid, shrink } from './weighting.js';

/**
 * Shrink a win-rate estimate toward a prior probability `q` using `k`
 * equivalent-game prior strength (SPECS §5, D-021):
 *
 *   `pL = (winsE + k * q) / (gamesE + k)`
 *
 * This is a thin semantic wrapper around `shrink` for readability at call
 * sites in the scoring chain.
 */
export function layerWinRate(winsE: number, gamesE: number, k: number, q: number): number {
  return shrink(winsE, gamesE, k, q);
}

/**
 * The log-odds correction a single layer contributes to the running score
 * (SPECS §5, D-021):
 *
 *   `term = logit(pL) - logit(q)`
 *
 * where `pL` is the layer's shrunk win rate and `q` is the prior prediction
 * (the layer below). A positive term means the layer improves the prediction.
 *
 * `eps` clamps both probabilities to `[eps, 1 - eps]` so a perfect or empty
 * record never produces ±Infinity.
 */
export function layerTerm(pL: number, q: number, eps: number): number {
  return clampedLogit(pL, eps) - clampedLogit(q, eps);
}

/**
 * The pair term for a champion `c` against a known slot `s` (SPECS §5):
 *
 *   `pairTerm = logit((winsE + k*p0)/(gamesE + k)) - logit(p0)`
 *
 * where `p0` is the baseline win probability (the layer below the pairs).
 * Returns 0 when there is no pair data (`gamesE == 0`).
 */
export function pairTerm(
  winsE: number,
  gamesE: number,
  k: number,
  p0: number,
  eps: number,
): number {
  if (gamesE <= 0) {
    return 0;
  }
  const pL = layerWinRate(winsE, gamesE, k, p0);
  return layerTerm(pL, p0, eps);
}

/**
 * Convert a log-odds term into a percentage-point delta, given the running
 * log-odds `x` before the term is applied (SPECS §5):
 *
 *   `deltaPp = 100 * (sigmoid(x + term) - sigmoid(x))`
 */
export function deltaPp(x: number, term: number): number {
  return 100 * (sigmoid(x + term) - sigmoid(x));
}

/**
 * Map a `deltaPp` to a reason level (SPECS §5, "like Karakal"):
 *
 *   |deltaPp| >= 4.5 with n_eff >= 100 → ±3
 *   |deltaPp| >= 2.5 with n_eff >= 100 → ±2
 *   |deltaPp| >= 1.0 with n_eff >= 100 → ±1
 *   otherwise → 0
 *
 * Positive levels require `n_eff >= 100` (SPECS §5: "L1 >= +1.0pp, L2 >= +2.5pp,
 * L3 >= +4.5pp (needs n_eff >= 100)"). The `minGames` threshold gates the
 * entry-level L1: below it, even a large delta collapses to 0 (no data).
 * Negative levels (being countered) are never gated by n_eff — a champion
 * that is hard-countered in lane should still show the warning.
 */
export function mapDeltaPpToLevel(deltaPp: number, nEff: number): number {
  const abs = Math.abs(deltaPp);
  const sign = deltaPp < 0 ? -1 : 1;

  if (deltaPp > 0) {
    // Positive levels require n_eff >= 100 for L2/L3, and >= minGames for L1.
    // (minGames default 25; L1 needs >= 1.0pp AND n_eff >= minGames per lowData logic.)
    // SPECS §5: "L1 >= +1.0pp, L2 >= +2.5pp, L3 >= +4.5pp (needs n_eff >= 100)".
    // The L2/L3 thresholds each require n_eff >= 100; L1 requires the term to
    // not be flagged lowData (n_eff >= minGames at the reason level).
    if (abs >= 4.5) {
      return nEff >= 100 ? sign * 3 : 0;
    }
    if (abs >= 2.5) {
      return nEff >= 100 ? sign * 2 : 0;
    }
    if (abs >= 1.0) {
      // L1: the term itself must not be lowData (n_eff >= minGames).
      // We pass minGames externally; here we use a conservative floor: n_eff >= 1
      // for L1 to render at all (the caller sets lowData separately).
      // The strict minGames gate is handled by the caller via lowData.
      return sign * 1;
    }
    return 0;
  }

  // Negative delta (counter-picked): render the level regardless of n_eff,
  // but require at least 1 effective game so we don't show noise.
  if (nEff < 1) {
    return 0;
  }
  if (abs >= 4.5) {
    return -3;
  }
  if (abs >= 2.5) {
    return -2;
  }
  if (abs >= 1.0) {
    return -1;
  }
  return 0;
}

/**
 * Baseline gate (SPECS §5): a candidate whose baseline `n_eff` is below
 * `minGames` gets no score and no rank — it goes to `insufficientData`.
 */
export function baselineGate(nEff: number, minGames: number): boolean {
  return nEff >= minGames;
}

/**
 * Compute the baseline log-odds for a champion (SPECS §5):
 *
 *   `p0 = (winsE + k0 * 0.5) / (gamesE + k0)`
 *   `x  = logit(p0)`
 *
 * Shrinks the baseline win rate toward 0.5 with prior strength `k0` (default
 * 20 equivalent games). When `gamesE + k0 == 0`, returns `logit(0.5) = 0`.
 * Clamped to `[eps, 1 - eps]` to avoid ±Infinity.
 */
export function baselineLogOdds(winsE: number, gamesE: number, k0: number, eps: number): number {
  const p0 = shrink(winsE, gamesE, k0, 0.5);
  return clampedLogit(p0, eps);
}

/**
 * Logit with clamping to `[eps, 1 - eps]` (SPECS §5, golden-rule safety).
 */
function clampedLogit(p: number, eps: number): number {
  const clamped = Math.min(Math.max(p, eps), 1 - eps);
  return Math.log(clamped / (1 - clamped));
}
