/**
 * @draftorb/engine — Reason building and output formatting (SPECS §5, §7).
 */

import type { ChampionId, ReasonLevel, Recommendation, WarningCode } from '@draftorb/shared';
import type { RankWeightingConfig } from './config.js';
import type { LaneDelta, LaneGroupInfo, ReasonAccumulator } from './recommend-types.js';
import type { PairDelta } from './recommend-terms.js';
import {
  DELTA_PP_DECIMALS,
  REASON_LEVEL_MAX,
  REASON_LEVEL_MIN,
  UNSAMPLED_LEVEL_HIGH_MIN_GAMES,
  UNSAMPLED_LEVEL_MIN_GAMES,
  UNSAMPLED_LEVEL_NEFF,
  UNSAMPLED_MAX_POSITIVE_LEVEL,
} from './config.js';
import { isLowData, levelFromConfig, mapDeltaPpToLevel } from './levels.js';

const DELTA_PP_SCALE = 10 ** DELTA_PP_DECIMALS;

/** Round a deltaPp exactly as it is reported in a `Reason`. */
export function roundDeltaPp(d: number): number {
  return Math.round(d * DELTA_PP_SCALE) / DELTA_PP_SCALE;
}

function isReasonLevel(n: number): n is ReasonLevel {
  return Number.isInteger(n) && n >= REASON_LEVEL_MIN && n <= REASON_LEVEL_MAX;
}

function toReasonLevel(levelNum: number): ReasonLevel | undefined {
  return isReasonLevel(levelNum) ? levelNum : undefined;
}

export interface ReasonInputs {
  readonly pairDeltas: readonly PairDelta[];
  readonly laneVs: LaneDelta | null;
  readonly laneFull: LaneDelta | null;
  readonly compDeltaPp: number | null;
  readonly blindDeltaPp: number | null;
  readonly laneGroupInfo: LaneGroupInfo;
}

/**
 * Reasons in canonical order (SPECS §5): pairs by descending influence, then
 * lane_vs, lane_full, comp, blind.
 */
export function buildReasons(
  inputs: ReasonInputs,
  config: RankWeightingConfig,
): ReasonAccumulator[] {
  const { pairDeltas, laneVs, laneFull, compDeltaPp, blindDeltaPp, laneGroupInfo } = inputs;
  const reasons: ReasonAccumulator[] = [];

  for (const d of pairDeltas) {
    reasons.push({
      type: d.side === 'ally' ? 'synergy' : 'counter',
      with: [d.championId],
      deltaPp: d.deltaPp,
      n: d.n,
      lowData: d.lowData,
      level: toReasonLevel(levelFromConfig(d.deltaPp, d.n, config)),
    });
  }

  const enemyIds = laneGroupInfo.enemies.map((s) => s.championId);
  const allyIds = laneGroupInfo.allies.map((s) => s.championId);
  const lanes: Array<[LaneDelta | null, ChampionId[]]> = [
    [laneVs, enemyIds],
    [laneFull, [...allyIds, ...enemyIds]],
  ];
  for (const [lane, withIds] of lanes) {
    if (!lane) continue;
    reasons.push({
      type: 'lane',
      with: withIds,
      deltaPp: lane.deltaPp,
      n: lane.n,
      lowData: lane.lowData,
      level: toReasonLevel(levelFromConfig(lane.deltaPp, lane.n, config)),
    });
  }

  // Comp and blind reasons have no sample of their own and are never lowData.
  // Map their delta directly (no fabricated n_eff): positive levels cap at L1,
  // negative levels keep their full magnitude (SPECS §5).
  const unsampledLevel = (d: number): ReasonLevel | undefined => {
    const level = mapDeltaPpToLevel(
      d,
      UNSAMPLED_LEVEL_NEFF,
      UNSAMPLED_LEVEL_MIN_GAMES,
      UNSAMPLED_LEVEL_HIGH_MIN_GAMES,
    );
    return toReasonLevel(level > 0 ? Math.min(level, UNSAMPLED_MAX_POSITIVE_LEVEL) : level);
  };

  if (compDeltaPp !== null) {
    reasons.push({
      type: 'comp',
      with: [],
      deltaPp: compDeltaPp,
      n: 0,
      lowData: false,
      level: unsampledLevel(compDeltaPp),
    });
  }

  if (blindDeltaPp !== null) {
    reasons.push({
      type: 'blind',
      with: [],
      deltaPp: blindDeltaPp,
      n: 0,
      lowData: false,
      level: unsampledLevel(blindDeltaPp),
    });
  }

  return reasons;
}

export interface ScoredCandidate {
  readonly championId: ChampionId;
  readonly score: number;
  readonly reasons: ReasonAccumulator[];
  readonly baselineNEff: number;
  readonly warnings: WarningCode[];
}

/** Format a scored candidate as a public `Recommendation` (SPECS §7). */
export function toRecommendation(
  s: ScoredCandidate,
  rank: number,
  config: RankWeightingConfig,
  poolRank?: number,
): Recommendation {
  return {
    championId: s.championId,
    score: s.score,
    rank,
    ...(poolRank !== undefined ? { poolRank } : {}),
    reasons: s.reasons.map((r) => ({
      type: r.type,
      with: r.with.length > 0 ? r.with : undefined,
      level: r.level,
      deltaPp: roundDeltaPp(r.deltaPp),
      n: r.n, // n_eff is a real number (D-027)
      lowData: r.lowData,
    })),
    reliability: {
      nEff: s.baselineNEff,
      lowData: isLowData(s.baselineNEff, config.minGames),
    },
    warnings: s.warnings,
  };
}
