/**
 * @draftorb/engine — Candidate set and pool output (SPECS §5, §7, D-024).
 */

import type {
  ChampionId,
  ChampionRoleProbabilities,
  DraftInput,
  InsufficientDataEntry,
  PoolUnavailableEntry,
  Recommendation,
  Role,
} from '@draftorb/shared';
import type { RankWeightingConfig } from './config.js';
import type { ScoredCandidate } from './recommend-reasons.js';
import { ROLE_PROB_THRESHOLD } from './config.js';
import { toRecommendation } from './recommend-reasons.js';

export interface CandidateSet {
  /** Champions already on the board (allies or enemies), independent of role inference. */
  readonly picked: ReadonlySet<ChampionId>;
  readonly poolSet: ReadonlySet<ChampionId>;
  readonly championIdSet: ReadonlySet<ChampionId>;
  readonly candidates: ReadonlySet<ChampionId>;
}

/** True when `c` is below the roleProb threshold for `myRole` (or has no entry). */
export function isBelowRoleThreshold(
  c: ChampionId,
  myRole: Role,
  roleProb: ChampionRoleProbabilities,
): boolean {
  const p = roleProb[c]?.[myRole];
  return typeof p !== 'number' || p < ROLE_PROB_THRESHOLD;
}

/**
 * Candidates = champions with `roleProb[c][myRole] >= ROLE_PROB_THRESHOLD`
 * plus every known pool champion; board picks are never candidates.
 */
export function buildCandidateSet(
  input: DraftInput,
  championIds: readonly ChampionId[],
  roleProb: ChampionRoleProbabilities,
): CandidateSet {
  const picked = new Set<ChampionId>([
    ...input.allies.map((s) => s.championId),
    ...input.enemies.map((s) => s.championId),
  ]);
  const poolSet = new Set<ChampionId>(input.pool ?? []);
  const championIdSet = new Set<ChampionId>(championIds);
  const candidates = new Set<ChampionId>();
  for (const id of championIds) {
    if (picked.has(id)) continue;
    if (!isBelowRoleThreshold(id, input.userRole, roleProb)) candidates.add(id);
  }
  for (const id of poolSet) {
    // Unknown ids are reported as poolUnavailable/unknownChampion, never scored.
    if (picked.has(id) || !championIdSet.has(id)) continue;
    candidates.add(id);
  }
  return { picked, poolSet, championIdSet, candidates };
}

export interface PoolOutput {
  readonly poolRecommendations: Recommendation[];
  readonly poolUnavailable: PoolUnavailableEntry[];
}

/**
 * Pool lists (D-024): scored pool champions in overall order with their global
 * `rank` and a `poolRank`, plus deduplicated unavailable entries.
 */
export function buildPoolOutput(
  set: CandidateSet,
  sorted: readonly ScoredCandidate[],
  insufficientData: readonly InsufficientDataEntry[],
  config: RankWeightingConfig,
): PoolOutput {
  const poolUnavailable: PoolUnavailableEntry[] = [];
  const insufficientIds = new Set<ChampionId>(insufficientData.map((i) => i.championId));
  for (const pid of set.poolSet) {
    if (set.picked.has(pid)) {
      poolUnavailable.push({ championId: pid, reason: 'picked' });
    } else if (!set.championIdSet.has(pid)) {
      poolUnavailable.push({ championId: pid, reason: 'unknownChampion' });
    }
  }
  for (const pid of set.poolSet) {
    if (set.championIdSet.has(pid) && insufficientIds.has(pid)) {
      poolUnavailable.push({ championId: pid, reason: 'insufficientData' });
    }
  }

  const poolRecommendations: Recommendation[] = [];
  sorted.forEach((s, i) => {
    if (set.poolSet.has(s.championId)) {
      poolRecommendations.push(toRecommendation(s, i + 1, config, poolRecommendations.length + 1));
    }
  });
  return { poolRecommendations, poolUnavailable };
}
