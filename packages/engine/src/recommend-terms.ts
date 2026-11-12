/**
 * @draftorb/engine — Pair, blind-safety and hard-counter terms (SPECS §5).
 */

import type {
  ChampionId,
  ChampionRoleProbabilities,
  PickRate,
  Role,
  WarningCode,
} from '@draftorb/shared';
import type { RankWeightingConfig } from './config.js';
import type { DataRow, KnownSlot } from './recommend-types.js';
import {
  COUNTERED_BY_WARNING,
  DEFAULT_RECOMMEND_CONFIG,
  DRAFT_PHASE,
  getInfluence,
} from './config.js';
import { deltaPp, scorePair } from './levels.js';
import { makePairKey } from './recommend-indexes.js';
import { roundDeltaPp } from './recommend-reasons.js';
import { logit } from './weighting.js';

export interface PairDelta {
  readonly side: KnownSlot['side'];
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

/** Lookup key identifying one known slot for main-effect adjustment (D-088). */
export function pairSlotKey(slot: KnownSlot): string {
  return `${slot.side}:${slot.role}:${slot.championId}`;
}

/**
 * Per-slot main effects (D-088, PROPOSED): for each known slot, the mean pair
 * term over every candidate that has a scored (non-lowData) row against it.
 * The pair tables measure an absolute matchup win rate; shrinking toward the
 * candidate baseline leaves a component shared by all candidates when the
 * opponent is weak or strong. Subtracting this mean turns the term into a
 * candidate-relative interaction. Candidates without a scored row keep a 0
 * contribution, matching the mean interaction of the scored population.
 */
export function pairMainEffects(
  candidates: Iterable<ChampionId>,
  slots: readonly KnownSlot[],
  allyIdx: Map<string, DataRow>,
  enemyIdx: Map<string, DataRow>,
  p0For: (c: ChampionId) => number,
  config: RankWeightingConfig,
): Map<string, number> {
  const effects = new Map<string, number>();
  for (const slot of slots) {
    const idx = slot.side === 'ally' ? allyIdx : enemyIdx;
    let sum = 0;
    let n = 0;
    for (const c of candidates) {
      const row = idx.get(makePairKey(c, slot.championId, slot.role));
      if (!row) continue;
      const result = scorePair(row.winsE, row.gamesE, p0For(c), config);
      if (result.lowData) continue;
      sum += result.term;
      n += 1;
    }
    if (n > 0) effects.set(pairSlotKey(slot), sum / n);
  }
  return effects;
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
  /** Running log-odds before the pair layer; `recommend` passes its baseline `x`. */
  xStart: number = logit(p0, config.eps),
  /** Per-slot main effects from `pairMainEffects` (D-088); undefined = legacy. */
  mainEffects?: ReadonlyMap<string, number>,
): PairScoreInfo {
  const ordered = slots
    .map((slot) => ({
      slot,
      influence: getInfluence(myRole, slot.side, slot.role, DRAFT_PHASE, config),
    }))
    .filter((e) => e.influence > 0)
    .sort((a, b) => b.influence - a.influence || a.slot.championId - b.slot.championId);

  const deltas: PairDelta[] = [];
  let sum = 0;
  let xRunning = xStart;

  for (const { slot, influence } of ordered) {
    const idx = slot.side === 'ally' ? allyIdx : enemyIdx;
    const row = idx.get(makePairKey(c, slot.championId, slot.role));
    if (!row) continue;

    const result = scorePair(row.winsE, row.gamesE, p0, config);
    // D-088: remove the slot's shared main effect; lowData rows keep 0 so a
    // missing matchup is never penalized for the population average.
    const mean = mainEffects?.get(pairSlotKey(slot));
    const term = mean !== undefined && !result.lowData ? result.term - mean : result.term;
    const weightedTerm = config.s * slot.confidence * influence * term;
    const dPp = deltaPp(xRunning, weightedTerm);
    sum += slot.confidence * influence * term;
    xRunning += weightedTerm;

    deltas.push({
      side: slot.side,
      role: slot.role,
      championId: slot.championId,
      confidence: slot.confidence,
      influence,
      term,
      lowData: result.lowData,
      n: row.nE,
      deltaPp: dPp,
    });
  }

  return { sum, deltas };
}

/**
 * Share of likely unseen opponents for (role, champion): the exported pick
 * rate when `pick-rate.json` was loaded, otherwise the normalized roleProb
 * approximation kept for legacy exports (B-026).
 */
function blindOpponentShare(
  pickRate: PickRate | undefined,
  roleProb: ChampionRoleProbabilities,
  championId: ChampionId,
  role: Role,
): number | undefined {
  if (pickRate !== undefined) return pickRate[role]?.[championId];
  return roleProb[championId]?.[role];
}

/**
 * blindSafety(c) (SPECS §5): expected pair term against the likely *unseen*
 * lane opponents, plus a worst-case penalty. Known enemies are excluded — the
 * pair layer already scores them. `pickShare(e)` comes from the pick-rate
 * export; without it, roleProb is the fallback approximation (B-026).
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
  minShare: number = DEFAULT_RECOMMEND_CONFIG.blindOpponentMinShare,
  worstCaseFactor: number = DEFAULT_RECOMMEND_CONFIG.blindWorstCaseFactor,
  pickRate?: PickRate,
): number {
  const opponents = blindOpponents(
    unknownRoles,
    excluded,
    championIds,
    roleProb,
    minShare,
    pickRate,
  );
  return blindSafetyFromOpponents(c, opponents, enemyIdx, p0, config, worstCaseFactor);
}

export interface BlindOpponent {
  readonly championId: ChampionId;
  readonly share: number;
}

/**
 * Likely unseen opponents per unknown role. Candidate-independent, so
 * `recommend` builds it once per draft; championIds are deduplicated so a
 * repeated id never counts twice in the share distribution.
 */
export function blindOpponents(
  unknownRoles: readonly Role[],
  excluded: ReadonlySet<ChampionId>,
  championIds: readonly ChampionId[],
  roleProb: ChampionRoleProbabilities,
  minShare: number = DEFAULT_RECOMMEND_CONFIG.blindOpponentMinShare,
  pickRate?: PickRate,
): ReadonlyMap<Role, readonly BlindOpponent[]> {
  const unique = [...new Set(championIds)];
  const out = new Map<Role, BlindOpponent[]>();
  for (const role of unknownRoles) {
    const list: BlindOpponent[] = [];
    for (const e of unique) {
      if (excluded.has(e)) continue;
      const share = blindOpponentShare(pickRate, roleProb, e, role);
      if (typeof share !== 'number' || share < minShare) continue;
      list.push({ championId: e, share });
    }
    out.set(role, list);
  }
  return out;
}

/** blindSafety(c) over a precomputed opponent distribution (see `blindOpponents`). */
export function blindSafetyFromOpponents(
  c: ChampionId,
  opponents: ReadonlyMap<Role, readonly BlindOpponent[]>,
  enemyIdx: Map<string, DataRow>,
  p0: number,
  config: RankWeightingConfig,
  worstCaseFactor: number = DEFAULT_RECOMMEND_CONFIG.blindWorstCaseFactor,
): number {
  let total = 0;

  for (const [role, list] of opponents) {
    let shareTotal = 0;
    let weighted = 0;
    // Starts at 0 on purpose: the worst-case term is a penalty only, so an
    // all-favorable distribution gets no extra bonus (SPECS §5).
    let minTerm = 0;
    for (const { championId: e, share } of list) {
      if (e === c) continue;
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
 * (same running log-odds, conf, influence and s). The threshold is compared
 * against the *rounded* delta so the warning matches the displayed reason.
 * lowData pairs never warn.
 */
export function hardCounterWarnings(
  pairDeltas: readonly PairDelta[],
  thresholdPp: number = DEFAULT_RECOMMEND_CONFIG.hardCounterDeltaPp,
): WarningCode[] {
  return pairDeltas
    .filter((d) => d.side === 'enemy' && !d.lowData && roundDeltaPp(d.deltaPp) <= thresholdPp)
    .map((d) => `${COUNTERED_BY_WARNING}:${d.role}:${d.championId}`);
}
