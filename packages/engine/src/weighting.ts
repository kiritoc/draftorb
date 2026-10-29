/**
 * @draftorb/engine — Pure rank weighting and score-space functions.
 *
 * All functions are deterministic and side-effect free. They take data objects
 * in and return results out — no Date(), no Math.random(), no I/O.
 *
 * Implements the primitives from SPECS §3 (rank-distance kernel, recency decay,
 * reliability down-weight, expert weighting), §5 (n_eff, equivalent-count
 * conversion, logit/sigmoid clamping), and D-020 (influence lookup).
 */

import type { RankWeightingConfig } from './config.js';

// --- Rank-distance kernel (SPECS §3) ---

/**
 * Rank-distance weight: `exp(-|gameBucket - userBucket| / tau)`.
 *
 * Games whose rank bucket is more than `rankWindowTiers` below the user's
 * bucket get weight 0 (SPECS §3: "Never use data below userRank-2 tiers").
 *
 * @param gameBucketIdx   Numeric rank-bucket index of the game (0=IRON … 7=MASTER_PLUS).
 * @param userBucketIdx   Numeric rank-bucket index of the user.
 * @param tau             Kernel width (default 1.25).
 * @param rankWindowTiers Hard floor: exclude games below `userBucketIdx - rankWindowTiers`.
 */
export function rankDistanceWeight(
  gameBucketIdx: number,
  userBucketIdx: number,
  tau: number,
  rankWindowTiers: number,
): number {
  if (gameBucketIdx < userBucketIdx - rankWindowTiers) {
    return 0;
  }
  return Math.exp(-Math.abs(gameBucketIdx - userBucketIdx) / tau);
}

// --- Expert weighting (SPECS §3, runes & items) ---

/**
 * Expert-phase weight: `min(1 + alpha * (gameBucket - userBucket), wMax)`.
 *
 * Games below the user's rank bucket are excluded (weight 0), as per
 * SPECS §3: "use games with gameRank >= userRank (up to Challenger)."
 *
 * @param gameBucketIdx Numeric rank-bucket index of the game.
 * @param userBucketIdx Numeric rank-bucket index of the user.
 * @param alpha         Slope of the rank bonus (default 0.25).
 * @param wMax          Cap on the weight (default 2.0).
 */
export function expertWeight(
  gameBucketIdx: number,
  userBucketIdx: number,
  alpha: number,
  wMax: number,
): number {
  if (gameBucketIdx < userBucketIdx) {
    return 0;
  }
  return Math.min(1 + alpha * (gameBucketIdx - userBucketIdx), wMax);
}

// --- Recency decay (SPECS §3) ---

/**
 * Recency multiplier: `decay ^ (currentPatchIndex - patchIndex)`.
 *
 * Newer games (patchIndex closer to currentPatchIndex) keep a weight closer
 * to 1; older games are down-weighted.
 */
export function recencyFactor(
  patchIndex: number,
  currentPatchIndex: number,
  decay: number,
): number {
  return decay ** (currentPatchIndex - patchIndex);
}

// --- Reliability down-weight (SPECS §3, D-019) ---

/**
 * Reliability factor: `unknownRankFactor` when only the seed player's rank is
 * known (`rankKnownCount <= 1`), else 1.
 */
export function reliabilityFactor(rankKnownCount: number, unknownRankFactor: number): number {
  return rankKnownCount <= 1 ? unknownRankFactor : 1;
}

// --- Combined per-game weight ---

/**
 * Combine the rank-distance kernel, recency decay, and reliability into a
 * single per-game weight (SPECS §3). Used by the ETL aggregation to compute
 * per-game weights before accumulating bucketed counts.
 */
export function combinedGameWeight(
  gameBucketIdx: number,
  userBucketIdx: number,
  patchIndex: number,
  currentPatchIndex: number,
  rankKnownCount: number,
  config: RankWeightingConfig,
): number {
  let w = rankDistanceWeight(gameBucketIdx, userBucketIdx, config.tau, config.rankWindowTiers);
  w *= recencyFactor(patchIndex, currentPatchIndex, config.decay);
  w *= reliabilityFactor(rankKnownCount, config.unknownRankFactor);
  return w;
}

// --- Effective sample size (SPECS §3) ---

/**
 * Effective sample size: `n_eff = (Σw)² / Σw²`.
 *
 * A few heavily-weighted games cannot pass a threshold on their own.
 * When `gamesW2` is 0 (no games), returns 0.
 */
export function nEff(gamesW: number, gamesW2: number): number {
  if (gamesW2 <= 0) {
    return 0;
  }
  return (gamesW * gamesW) / gamesW2;
}

// --- Equivalent-count conversion (SPECS §5, D-021) ---

/**
 * Convert weighted counts to equivalent raw-game counts so that shrinkage
 * priors `k` stay in raw-game units (SPECS §5, D-021):
 *
 *   `games_e = n_eff`,  `wins_e = wins_w * n_eff / games_w`
 *
 * When `gamesW` is 0 (no games at all), returns `{ winsE: 0, gamesE: 0 }`.
 */
export function toEquivalentCounts(
  winsW: number,
  gamesW: number,
  gamesW2: number,
): { readonly winsE: number; readonly gamesE: number } {
  const n = nEff(gamesW, gamesW2);
  if (gamesW <= 0) {
    return { winsE: 0, gamesE: 0 };
  }
  return { winsE: (winsW * n) / gamesW, gamesE: n };
}

// --- Log-odds helpers (SPECS §5) ---

/**
 * Logit (log-odds) with clamping to `[eps, 1 - eps]` so perfect or empty
 * records never produce ±Infinity (SPECS §5).
 */
export function logit(p: number, eps: number): number {
  const clamped = Math.min(Math.max(p, eps), 1 - eps);
  return Math.log(clamped / (1 - clamped));
}

/**
 * Logistic sigmoid (inverse of logit), numerically stable for large |x|.
 */
export function sigmoid(x: number): number {
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
}

// --- Shrinkage (SPECS §5, D-021) ---

/**
 * Shrink a win-rate estimate toward a prior probability `q` using `k`
 * equivalent-game prior strength (SPECS §5, D-021):
 *
 *   `p = (wins_e + k * q) / (games_e + k)`
 */
export function shrink(winsE: number, gamesE: number, k: number, q: number): number {
  return (winsE + k * q) / (gamesE + k);
}
