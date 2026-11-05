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

import { DRAFT_RESULT_SCHEMA_VERSION } from '@draftorb/shared';
import type {
  DraftInput,
  DraftResult,
  InsufficientDataEntry,
  Recommendation,
  RecommendData,
} from '@draftorb/shared';
import type { RankWeightingConfig, RecommendConfig } from './config.js';
import type { DataRow, LaneDelta } from './recommend-types.js';
import type { ScoredCandidate } from './recommend-reasons.js';
import {
  DEFAULT_CONFIG,
  DEFAULT_RECOMMEND_CONFIG,
  MISSING_LANE_ID,
  OFF_ROLE_WARNING,
  rankToBucket,
} from './config.js';
import { sigmoid } from './weighting.js';
import { baselineGate, baselineLogOdds, baselinePrior, deltaPp, scoreLane } from './levels.js';
import { computeCompNeed, teamMissingNeeds } from './comp.js';
import {
  indexBaselines,
  indexLaneFull,
  indexLaneVs,
  indexPairs,
  makeLaneFullKey,
  makeLaneVsKey,
} from './recommend-indexes.js';
import { computeLaneGroup, resolveKnownSlots } from './recommend-slots.js';
import {
  blindOpponents,
  blindSafetyFromOpponents,
  hardCounterWarnings,
  scorePairs,
} from './recommend-terms.js';
import { buildReasons, toRecommendation } from './recommend-reasons.js';
import { buildCandidateSet, buildPoolOutput, isBelowRoleThreshold } from './recommend-pool.js';

export type { KnownSlot } from './recommend-types.js';
// The data contract lives in @draftorb/shared (single source of truth).
export type { RecommendData } from '@draftorb/shared';

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
 * @param rc     Optional recommendation-layer config (weights, thresholds,
 *               lane groups, comp); defaults to DEFAULT_RECOMMEND_CONFIG.
 * @returns A fully ranked DraftResult.
 */
export function recommend(
  input: DraftInput,
  data: RecommendData,
  config: RankWeightingConfig = DEFAULT_CONFIG,
  rc: RecommendConfig = DEFAULT_RECOMMEND_CONFIG,
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
  // The user's own role is reserved on the ally team (D-050).
  const allySlots = resolveKnownSlots(input.allies, 'ally', data.roleProb, [myRole]);
  const enemySlots = resolveKnownSlots(input.enemies, 'enemy', data.roleProb);

  // --- Infer lane-group champions from known enemies/allies ---
  const laneGroup = rc.laneGroups[myRole];
  const laneGroupInfo = computeLaneGroup(laneGroup, allySlots, enemySlots);

  // --- Build candidate set (board picks excluded, pool champions added) ---
  const candidateSet = buildCandidateSet(
    input,
    data.championIds,
    data.roleProb,
    rc.roleProbThreshold,
  );
  const knownChampionSet = candidateSet.picked;

  // Comp is role-independent: use every board ally, even if role inference dropped it.
  const allyChampIds = input.allies.map((s) => s.championId);
  // Missing needs depend only on the allies: compute once per draft.
  const missingNeeds = teamMissingNeeds(allyChampIds, data.tags, rc.comp);

  // Blind-safety opponent distribution is candidate-independent: build it once.
  const laneEnemiesKnown = laneGroup.enemies.every((role) =>
    laneGroupInfo.enemiesKnown.includes(role),
  );
  const unknownLaneRoles = laneGroup.enemies.filter(
    (role) => !laneGroupInfo.enemiesKnown.includes(role),
  );
  const blindApplies = input.blindPick || !laneEnemiesKnown;
  const opponents = blindOpponents(
    blindApplies ? unknownLaneRoles : [],
    knownChampionSet,
    data.championIds,
    data.roleProb,
    rc.blindOpponentMinShare,
    data.pickRate,
  );

  // --- Score each candidate ---
  const scored: ScoredCandidate[] = [];
  const insufficientData: InsufficientDataEntry[] = [];

  for (const c of candidateSet.candidates) {
    const baseRow = baselineIdx.get(c);
    // rawGames is omitted when unknown (no row, or the export carries no count),
    // so a missing count is never reported as a real 0 (golden rule 8).
    if (!baseRow) {
      insufficientData.push({ championId: c, nEff: 0 });
      continue;
    }

    const { winsE, gamesE, nE } = baseRow;

    // Baseline gate: n_eff < minGames -> insufficientData
    if (!baselineGate(nE, config.minGames)) {
      const raw = baseRow.rawGames;
      insufficientData.push({
        championId: c,
        nEff: nE,
        ...(raw !== undefined && raw > 0 ? { rawGames: raw } : {}),
      });
      continue;
    }

    // p0 = shrink(winsE, gamesE, k0, 0.5); baseline log-odds
    const p0 = baselinePrior(winsE, gamesE, config.k0);
    const x = baselineLogOdds(winsE, gamesE, config.k0, config.eps);

    // Determine if this is an off-role pool champion
    const isOffRole =
      candidateSet.poolSet.has(c) &&
      isBelowRoleThreshold(c, myRole, data.roleProb, rc.roleProbThreshold);

    // --- Layer 1: pairs ---
    const pairInfo = scorePairs(
      c,
      myRole,
      [...allySlots, ...enemySlots],
      allyPairIdx,
      enemyPairIdx,
      p0,
      config,
      x,
    );
    let logOdds = x + config.s * pairInfo.sum;

    // --- Layer 2: lane_vs (all lane-group enemies known) ---
    const [enemy1, enemy2] = laneGroupInfo.enemies;
    const laneVsDelta =
      laneEnemiesKnown && enemy1
        ? applyLane(
            laneVsIdx.get(
              makeLaneVsKey(c, enemy1.championId, enemy2?.championId ?? MISSING_LANE_ID),
            ),
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
    const compResult = computeCompNeed(c, allyChampIds, data.tags, rc.comp, missingNeeds);
    let compDeltaPp: number | null = null;
    // A filled need with a 0 weight (or wComp = 0) adds nothing and gets no reason.
    const compTerm = rc.wComp * compResult.bonus;
    if (compResult.filled.length > 0 && compTerm !== 0) {
      compDeltaPp = deltaPp(logOdds, compTerm);
      logOdds += compTerm;
    }

    // --- Layer 5: blind safety (blind pick or lane enemies still unknown) ---
    let blindDeltaPp: number | null = null;
    if (blindApplies) {
      const rawTerm = blindSafetyFromOpponents(
        c,
        opponents,
        enemyPairIdx,
        p0,
        config,
        rc.blindWorstCaseFactor,
      );
      const term = rc.wBlind * rawTerm;
      if (term !== 0) {
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
      ...(isOffRole ? [OFF_ROLE_WARNING] : []),
      ...hardCounterWarnings(pairInfo.deltas, rc.hardCounterDeltaPp),
    ];

    scored.push({ championId: c, score: sigmoid(logOdds), reasons, baselineNEff: nE, warnings });
  }

  // --- Sort and rank ---
  // Exact score comparison: transitive and deterministic (pure float math on
  // identical inputs). Ties only on exactly equal scores, broken by championId.
  const sorted = [...scored].sort(
    (a, b) => (a.score === b.score ? 0 : b.score > a.score ? 1 : -1) || a.championId - b.championId,
  );

  const recommendations: Recommendation[] = sorted.map((s, i) =>
    toRecommendation(s, i + 1, config),
  );

  // --- Pool recommendations (only for a non-empty pool, D-024) ---
  return {
    schemaVersion: DRAFT_RESULT_SCHEMA_VERSION,
    recommendations,
    insufficientData,
    ...(candidateSet.poolSet.size > 0
      ? buildPoolOutput(candidateSet, sorted, insufficientData, config)
      : {}),
  };
}
