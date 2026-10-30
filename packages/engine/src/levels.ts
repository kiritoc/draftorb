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

import { DEFAULT_CONFIG } from './config.js';
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
 * Returns 0 when the pair is lowData (`gamesE < minGames`, SPECS §5) or empty.
 */
export function pairTerm(
  winsE: number,
  gamesE: number,
  k: number,
  p0: number,
  eps: number,
  minGames: number = DEFAULT_CONFIG.minGames,
): number {
  if (isLowData(gamesE, minGames)) {
    return 0;
  }
  const pL = layerWinRate(winsE, gamesE, k, p0);
  return layerTerm(pL, p0, eps);
}

/**
 * The lane term for an exact lane context, shrunk toward the running
 * prediction `q` (SPECS §5):
 *
 *   `laneTerm = logit((winsE + kLane*q)/(gamesE + kLane)) - logit(q)`
 *
 * Returns 0 when the context is lowData (`gamesE < minGames`) or empty.
 */
export function laneTerm(
  winsE: number,
  gamesE: number,
  kLane: number,
  q: number,
  eps: number,
  minGames: number = DEFAULT_CONFIG.minGames,
): number {
  if (isLowData(gamesE, minGames)) {
    return 0;
  }
  const pL = layerWinRate(winsE, gamesE, kLane, q);
  return layerTerm(pL, q, eps);
}

/**
 * Low-data rule (SPECS §5): a term whose `n_eff < minGames` contributes 0
 * and its reason is flagged `lowData`. Empty samples are always lowData.
 */
export function isLowData(nEff: number, minGames: number): boolean {
  return nEff <= 0 || nEff < minGames;
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
 *   |deltaPp| >= 4.5 → ±3
 *   |deltaPp| >= 2.5 → ±2
 *   |deltaPp| >= 1.0 → ±1
 *   otherwise → 0
 *
 * Any lowData reason (`n_eff < minGames`) maps to 0, for both signs.
 * Positive L2/L3 additionally require `n_eff >= 100`; when that fails, a
 * qualifying delta falls back to L1 instead of disappearing. Negative levels
 * (being countered) are not subject to the 100-game gate.
 */
export function mapDeltaPpToLevel(
  deltaPp: number,
  nEff: number,
  minGames: number = DEFAULT_CONFIG.minGames,
): number {
  const abs = Math.abs(deltaPp);
  if (abs < 1.0 || isLowData(nEff, minGames)) {
    return 0;
  }
  const sign = deltaPp < 0 ? -1 : 1;
  const highLevelsAllowed = sign < 0 || nEff >= 100;

  if (abs >= 4.5 && highLevelsAllowed) {
    return sign * 3;
  }
  if (abs >= 2.5 && highLevelsAllowed) {
    return sign * 2;
  }
  return sign * 1;
}

/**
 * Baseline gate (SPECS §5): a candidate whose baseline `n_eff` is below
 * `minGames` gets no score and no rank — it goes to `insufficientData`.
 */
export function baselineGate(nEff: number, minGames: number): boolean {
  // Empty samples never pass, even with minGames = 0 (golden rule 8).
  return nEff > 0 && nEff >= minGames;
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
