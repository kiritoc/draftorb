/**
 * @draftorb/engine — Reason building and output formatting (SPECS §5, §7).
 */

import type { ChampionId, ReasonLevel, Recommendation } from '@draftorb/shared';
import type { RankWeightingConfig } from './config.js';
import type { LaneDelta, LaneGroupInfo, ReasonAccumulator } from './recommend-types.js';
import type { PairDelta } from './recommend-terms.js';
import { isLowData, levelFromConfig } from './levels.js';

function toReasonLevel(levelNum: number): ReasonLevel | undefined {
  if (
    levelNum === -3 ||
    levelNum === -2 ||
    levelNum === -1 ||
    levelNum === 1 ||
    levelNum === 2 ||
    levelNum === 3
  ) {
    return levelNum;
  }
  return undefined;
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

  if (compDeltaPp !== null) {
    reasons.push({
      type: 'comp',
      with: [],
      deltaPp: compDeltaPp,
      n: 0,
      lowData: false,
      level: toReasonLevel(levelFromConfig(compDeltaPp, 0, config)),
    });
  }

  if (blindDeltaPp !== null) {
    reasons.push({
      type: 'blind',
      with: [],
      deltaPp: blindDeltaPp,
      n: 0,
      lowData: false,
      level: undefined,
    });
  }

  return reasons;
}

export interface ScoredCandidate {
  readonly championId: ChampionId;
  readonly score: number;
  readonly reasons: ReasonAccumulator[];
  readonly baselineNEff: number;
  readonly warnings: string[];
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
      deltaPp: Math.round(r.deltaPp * 100) / 100,
      n: Math.round(r.n),
      lowData: r.lowData,
    })),
    reliability: {
      games: s.baselineNEff,
      lowData: isLowData(s.baselineNEff, config.minGames),
    },
    warnings: s.warnings,
  };
}
