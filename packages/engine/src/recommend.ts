/**
 * @draftorb/engine — Recommendation engine (SPECS §5-7).
 *
 * Pure, deterministic. Takes pre-loaded data objects (baseline tables, pair
 * tables, lane tables, role probabilities, champion tags) and a DraftInput,
 * returns a fully ranked DraftResult with explanations.
 *
 * No DOM, no Node APIs, no network, no file I/O, no randomness.
 *
 * Callers provide data via `RecommendData` — the engine never reads files.
 */

import type {
  AllyPairTable,
  BaselineTable,
  ChampionId,
  ChampionRoleProbabilities,
  ChampionTagsMap,
  DraftInput,
  DraftResult,
  EnemyPairTable,
  LaneFullTable,
  LaneVsTable,
  PoolUnavailableEntry,
  Recommendation,
} from '@draftorb/shared';
import type { CompConfig, RankWeightingConfig } from './config.js';
import type { DataRow, LaneDelta } from './recommend-types.js';
import type { ScoredCandidate } from './recommend-reasons.js';
import {
  BASELINE_PRIOR_WINRATE,
  DEFAULT_COMP_CONFIG,
  DEFAULT_CONFIG,
  ROLE_PROB_THRESHOLD,
  SCORE_TIE_EPSILON,
  W_BLIND,
  W_COMP,
  rankToBucket,
} from './config.js';
import { sigmoid } from './weighting.js';
import { baselineGate, baselineLogOdds, deltaPp, scoreLane } from './levels.js';
import { computeCompNeed } from './comp.js';
import { LANE_GROUPS } from './recommend-types.js';
import {
  indexBaselines,
  indexLaneFull,
  indexLaneVs,
  indexPairs,
  makeLaneFullKey,
  makeLaneVsKey,
} from './recommend-indexes.js';
import { computeLaneGroup, resolveKnownSlots } from './recommend-slots.js';
import { computeBlindSafety, hardCounterWarnings, scorePairs } from './recommend-terms.js';
import { buildReasons, toRecommendation } from './recommend-reasons.js';

export type { KnownSlot } from './recommend-types.js';

/** Role-relative influence for a known slot, keyed by phase. */
export type InfluencePhase = 'draft' | 'lane' | 'mid';

/** Index lookups over exported data tables. */
export interface RecommendData {
  /** Baseline win rates per (championId, bucket) — role-specific. */
  readonly baselines: BaselineTable;
  /** Ally pair data per (championId, allyId, role, bucket). */
  readonly allyPairs: AllyPairTable;
  /** Enemy pair data per (championId, enemyId, role, bucket). */
  readonly enemyPairs: EnemyPairTable;
  /** Lane-vs data per (championId, opp1Id, opp2Id, bucket). */
  readonly laneVs: LaneVsTable;
  /** Lane-full data per (championId, partnerId, opp1Id, opp2Id, bucket). */
  readonly laneFull: LaneFullTable;
  /** Role probability map: championId -> { role: prob }. */
  readonly roleProb: ChampionRoleProbabilities;
  /** Champion tags for comp needs. */
  readonly tags: ChampionTagsMap;
  /** Champions list for candidate enumeration (id -> exists check). */
  readonly championIds: readonly ChampionId[];
}

/**
 * Shrink an exact lane context toward the running prediction (SPECS §5),
 * scaled by `conf_lane`. Returns null when the context row is missing.
 */
function applyLane(
  row: DataRow | undefined,
  logOdds: number,
  confLane: number,
  config: RankWeightingConfig,
): LaneDelta | null {
  if (!row) return null;
  const result = scoreLane(row.winsE, row.gamesE, sigmoid(logOdds), config);
  const term = confLane * result.term;
  return { term, lowData: result.lowData, n: row.nE, deltaPp: deltaPp(logOdds, term) };
}

/**
 * Recommend champions for a draft slot (SPECS §5-7).
 *
 * @param input  The user's partial draft knowledge.
 * @param data   Pre-loaded aggregated data objects.
 * @param config Optional rank-weighting config (defaults to DEFAULT_CONFIG).
 * @param compConfig Optional comp config (defaults to DEFAULT_COMP_CONFIG).
 * @returns A fully ranked DraftResult.
 */
export function recommend(
  input: DraftInput,
  data: RecommendData,
  config: RankWeightingConfig = DEFAULT_CONFIG,
  compConfig: CompConfig = DEFAULT_COMP_CONFIG,
): DraftResult {
  const userBucket = rankToBucket(input.userRank);
  const myRole = input.userRole;

  // --- Build indexes over the data tables ---
  const baselineIdx = indexBaselines(data.baselines, userBucket);
  const allyPairIdx = indexPairs(data.allyPairs, userBucket);
  const enemyPairIdx = indexPairs(data.enemyPairs, userBucket);
  const laneVsIdx = indexLaneVs(data.laneVs, userBucket);
  const laneFullIdx = indexLaneFull(data.laneFull, userBucket);

  // --- Infer roles for ally and enemy teams ---
  const allySlots = resolveKnownSlots(input.allies, 'ally', data.roleProb);
  const enemySlots = resolveKnownSlots(input.enemies, 'enemy', data.roleProb);

  // --- Infer lane-group champions from known enemies/allies ---
  const laneGroup = LANE_GROUPS[myRole];
  const laneGroupInfo = computeLaneGroup(laneGroup, allySlots, enemySlots);

  // --- Build candidate set ---
  // Exclude every picked champion from the input, independent of role inference.
  const knownChampionSet = new Set<ChampionId>([
    ...input.allies.map((s) => s.championId),
    ...input.enemies.map((s) => s.championId),
  ]);

  const candidateIds = new Set<ChampionId>();
  for (const id of data.championIds) {
    // Skip champions already picked on the board (allies or enemies).
    if (knownChampionSet.has(id)) continue;
    const rp = data.roleProb[id];
    if (!rp) continue;
    const roleProb = rp[myRole];
    if (typeof roleProb === 'number' && roleProb >= ROLE_PROB_THRESHOLD) {
      candidateIds.add(id);
    }
  }

  // Pool champions join the candidate set (may be off-role). Pool champions
  // already picked on the board are skipped.
  const pool = input.pool ?? [];
  const poolSet = new Set<ChampionId>(pool);
  const championIdSet = new Set<ChampionId>(data.championIds);
  for (const id of pool) {
    if (knownChampionSet.has(id)) continue;
    // Unknown ids are reported as poolUnavailable/unknownChampion, never scored.
    if (!championIdSet.has(id)) continue;
    candidateIds.add(id);
  }

  // --- Score each candidate ---
  const scored: ScoredCandidate[] = [];
  const insufficientData: { championId: ChampionId; nEff: number; rawGames: number }[] = [];

  for (const c of candidateIds) {
    const baseRow = baselineIdx.get(c);
    if (!baseRow) {
      insufficientData.push({ championId: c, nEff: 0, rawGames: 0 });
      continue;
    }

    const { winsE, gamesE, nE } = baseRow;

    // Baseline gate: n_eff < minGames -> insufficientData
    if (!baselineGate(nE, config.minGames)) {
      const rawGames = baseRow.rawGames ?? 0;
      insufficientData.push({ championId: c, nEff: nE, rawGames });
      continue;
    }

    // p0 = shrink(winsE, gamesE, k0, 0.5); baseline log-odds
    const p0 = (winsE + config.k0 * BASELINE_PRIOR_WINRATE) / (gamesE + config.k0);
    const x = baselineLogOdds(winsE, gamesE, config.k0, config.eps);

    // Determine if this is an off-role pool champion
    const rp = data.roleProb[c];
    const isOffRole = poolSet.has(c) && (!rp || !rp[myRole] || rp[myRole] < ROLE_PROB_THRESHOLD);

    // --- Layer 1: pairs ---
    const pairInfo = scorePairs(
      c,
      myRole,
      [...allySlots, ...enemySlots],
      allyPairIdx,
      enemyPairIdx,
      p0,
      config,
    );
    let logOdds = x + config.s * pairInfo.sum;

    // --- Layer 2: lane_vs (all lane-group enemies known) ---
    const [enemy1, enemy2] = laneGroupInfo.enemies;
    const laneEnemiesKnown = laneGroup.enemies.every((role) =>
      laneGroupInfo.enemiesKnown.includes(role),
    );
    const laneVsDelta =
      laneEnemiesKnown && enemy1
        ? applyLane(
            laneVsIdx.get(makeLaneVsKey(c, enemy1.championId, enemy2?.championId ?? -1)),
            logOdds,
            laneGroupInfo.enemyConfidence,
            config,
          )
        : null;
    if (laneVsDelta) logOdds += laneVsDelta.term;

    // --- Layer 3: lane_full (skipped for 1v1 lane groups) ---
    const partner = laneGroupInfo.allies[0];
    const laneFullDelta =
      !laneGroup.oneToOne && laneEnemiesKnown && partner && enemy1 && enemy2
        ? applyLane(
            laneFullIdx.get(
              makeLaneFullKey(c, partner.championId, enemy1.championId, enemy2.championId),
            ),
            logOdds,
            laneGroupInfo.confidence,
            config,
          )
        : null;
    if (laneFullDelta) logOdds += laneFullDelta.term;

    // --- Layer 4: comp need ---
    const allyChampIds = allySlots.map((s) => s.championId);
    const compResult = computeCompNeed(c, allyChampIds, data.tags, compConfig);
    let compDeltaPp: number | null = null;
    if (compResult.filled.length > 0 && compResult.bonus !== 0) {
      const compTerm = W_COMP * compResult.bonus;
      compDeltaPp = deltaPp(logOdds, compTerm);
      logOdds += compTerm;
    }

    // --- Layer 5: blind safety (blind pick or lane enemies still unknown) ---
    let blindDeltaPp: number | null = null;
    if (input.blindPick || !laneEnemiesKnown) {
      const unknownLaneRoles = laneGroup.enemies.filter(
        (role) => !laneGroupInfo.enemiesKnown.includes(role),
      );
      const rawTerm = computeBlindSafety(
        c,
        unknownLaneRoles,
        knownChampionSet,
        data.championIds,
        data.roleProb,
        enemyPairIdx,
        p0,
        config,
      );
      if (rawTerm !== 0) {
        const term = W_BLIND * rawTerm;
        blindDeltaPp = deltaPp(logOdds, term);
        logOdds += term;
      }
    }

    const reasons = buildReasons(
      {
        pairDeltas: pairInfo.deltas,
        laneVs: laneVsDelta,
        laneFull: laneFullDelta,
        compDeltaPp,
        blindDeltaPp,
        laneGroupInfo,
      },
      config,
    );

    const warnings = [
      ...(isOffRole ? ['offRole'] : []),
      ...hardCounterWarnings(c, enemySlots, enemyPairIdx, p0, config),
    ];

    scored.push({ championId: c, score: sigmoid(logOdds), reasons, baselineNEff: nE, warnings });
  }

  // --- Sort and rank ---
  const sorted = scored.sort((a, b) => {
    const diff = b.score - a.score;
    if (Math.abs(diff) > SCORE_TIE_EPSILON) return diff;
    return a.championId - b.championId;
  });

  const recommendations: Recommendation[] = sorted.map((s, i) =>
    toRecommendation(s, i + 1, config),
  );

  // --- Pool recommendations ---
  let poolRecommendations: Recommendation[] | undefined;
  let poolUnavailable: PoolUnavailableEntry[] | undefined;

  if (pool.length > 0) {
    poolRecommendations = [];
    poolUnavailable = [];

    // poolUnavailable: check pool champions not in championIds
    for (const pid of pool) {
      if (knownChampionSet.has(pid)) continue;
      if (!championIdSet.has(pid)) {
        poolUnavailable.push({ championId: pid, reason: 'unknownChampion' });
      }
    }

    // Check pool champions in insufficientData
    for (const pid of pool) {
      if (!championIdSet.has(pid)) continue;
      if (!scored.some((s) => s.championId === pid)) {
        const insuff = insufficientData.find((i) => i.championId === pid);
        if (insuff) {
          poolUnavailable.push({ championId: pid, reason: 'insufficientData' });
        }
      }
    }

    // poolRecommendations: in overall (sorted) order
    let poolRank = 0;
    for (let i = 0; i < sorted.length; i++) {
      const s = sorted[i];
      if (!s) continue;
      if (poolSet.has(s.championId)) {
        poolRank++;
        poolRecommendations.push(toRecommendation(s, i + 1, config, poolRank));
      }
    }
  }

  return {
    recommendations,
    insufficientData,
    ...(poolRecommendations !== undefined ? { poolRecommendations } : {}),
    ...(poolUnavailable !== undefined ? { poolUnavailable } : {}),
  };
}
