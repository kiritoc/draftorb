/**
 * @draftorb/engine — Pair, blind-safety and hard-counter terms (SPECS §5).
 */

import type { ChampionId, ChampionRoleProbabilities, Role } from '@draftorb/shared';
import type { RankWeightingConfig } from './config.js';
import type { DataRow, KnownSlot } from './recommend-types.js';
import { COUNTERED_BY_WARNING, DEFAULT_RECOMMEND_CONFIG, getInfluence } from './config.js';
import { deltaPp, scorePair } from './levels.js';
import { makePairKey } from './recommend-indexes.js';
import { logit } from './weighting.js';

export interface PairDelta {
  readonly side: 'ally' | 'enemy';
  readonly role: Role;
  readonly championId: ChampionId;
  readonly confidence: number;
  readonly influence: number;
  readonly term: number;
  readonly lowData: boolean;
  readonly n: number;
  readonly deltaPp: number;
}

export interface PairScoreInfo {
  readonly sum: number;
  readonly deltas: PairDelta[];
}

/**
 * Layer 1 (SPECS §5): sum of conf * influence * pairTerm over known slots,
 * processed by descending influence (ties by championId ascending).
 */
export function scorePairs(
  c: ChampionId,
  myRole: Role,
  slots: readonly KnownSlot[],
  allyIdx: Map<string, DataRow>,
  enemyIdx: Map<string, DataRow>,
  p0: number,
  config: RankWeightingConfig,
): PairScoreInfo {
  const ordered = slots
    .map((slot) => ({
      slot,
      influence: getInfluence(myRole, slot.side, slot.role, 'draft', config),
    }))
    .filter((e) => e.influence > 0)
    .sort((a, b) => b.influence - a.influence || a.slot.championId - b.slot.championId);

  const deltas: PairDelta[] = [];
  let sum = 0;
  let xRunning = logit(p0, config.eps);

  for (const { slot, influence } of ordered) {
    const idx = slot.side === 'ally' ? allyIdx : enemyIdx;
    const row = idx.get(makePairKey(c, slot.championId, slot.role));
    if (!row) continue;

    const result = scorePair(row.winsE, row.gamesE, p0, config);
    const weightedTerm = config.s * slot.confidence * influence * result.term;
    const dPp = deltaPp(xRunning, weightedTerm);
    sum += slot.confidence * influence * result.term;
    xRunning += weightedTerm;

    deltas.push({
      side: slot.side,
      role: slot.role,
      championId: slot.championId,
      confidence: slot.confidence,
      influence,
      term: result.term,
      lowData: result.lowData,
      n: row.nE,
      deltaPp: dPp,
    });
  }

  return { sum, deltas };
}

/**
 * blindSafety(c) (SPECS §5): expected pair term against the likely *unseen*
 * lane opponents, plus a worst-case penalty. Known enemies are excluded — the
 * pair layer already scores them. `pickShare(e)` is approximated by the
 * normalized roleProb of remaining champions (no pick-rate export yet, B-026).
 */
export function computeBlindSafety(
  c: ChampionId,
  unknownRoles: readonly Role[],
  excluded: ReadonlySet<ChampionId>,
  championIds: readonly ChampionId[],
  roleProb: ChampionRoleProbabilities,
  enemyIdx: Map<string, DataRow>,
  p0: number,
  config: RankWeightingConfig,
  roleProbThreshold: number = DEFAULT_RECOMMEND_CONFIG.roleProbThreshold,
  worstCaseFactor: number = DEFAULT_RECOMMEND_CONFIG.blindWorstCaseFactor,
): number {
  let total = 0;

  for (const role of unknownRoles) {
    let shareTotal = 0;
    let weighted = 0;
    let minTerm = 0;
    for (const e of championIds) {
      if (e === c || excluded.has(e)) continue;
      const share = roleProb[e]?.[role];
      if (typeof share !== 'number' || share < roleProbThreshold) continue;
      // Missing or lowData matchups count as neutral (term 0) with their full
      // share, so a candidate is not rewarded for lacking data.
      const row = enemyIdx.get(makePairKey(c, e, role));
      const result = row ? scorePair(row.winsE, row.gamesE, p0, config) : null;
      const term = result && !result.lowData ? result.term : 0;
      shareTotal += share;
      weighted += share * term;
      if (term < minTerm) minTerm = term;
    }
    // Worst case is taken per unseen role (SPECS §5).
    if (shareTotal > 0) total += weighted / shareTotal + worstCaseFactor * minTerm;
  }

  return total;
}

/**
 * "countered by" warnings, derived from the layer-1 enemy pair deltas so the
 * warning uses exactly the `deltaPp` shown in the matching `counter` reason
 * (same running log-odds, conf, influence and s). lowData pairs never warn.
 */
export function hardCounterWarnings(
  pairDeltas: readonly PairDelta[],
  thresholdPp: number = DEFAULT_RECOMMEND_CONFIG.hardCounterDeltaPp,
): string[] {
  return pairDeltas
    .filter((d) => d.side === 'enemy' && !d.lowData && d.deltaPp <= thresholdPp)
    .map((d) => `${COUNTERED_BY_WARNING}:${d.role}:${d.championId}`);
}
