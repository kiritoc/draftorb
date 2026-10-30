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
  BaselineTable,
  ChampionId,
  ChampionRoleProbabilities,
  ChampionTagsMap,
  ReasonLevel,
  AllyPairTable,
  EnemyPairTable,
  LaneVsTable,
  LaneFullTable,
  DraftInput,
  DraftResult,
  PoolUnavailableEntry,
  RankBucket,
  Recommendation,
  Role,
} from '@draftorb/shared';

import type { RankWeightingConfig } from './config.js';
import type { CompConfig, CompNeedCategory } from './comp.js';

import { DEFAULT_CONFIG, getInfluence, rankToBucket } from './config.js';
import { nEff, toEquivalentCounts, sigmoid, logit } from './weighting.js';
import {
  baselineGate,
  baselineLogOdds,
  scorePair,
  scoreLane,
  deltaPp,
  levelFromConfig,
  isLowData,
} from './levels.js';
import { inferRoles } from './roles.js';
import { computeCompNeed, DEFAULT_COMP_CONFIG } from './comp.js';

/** Role-relative influence for a known slot, keyed by phase. */
export type InfluencePhase = 'draft' | 'lane' | 'mid';

/** A known slot augmented with its inferred role and confidence. */
export interface KnownSlot {
  readonly championId: ChampionId;
  readonly role: Role;
  readonly side: 'ally' | 'enemy';
  readonly confidence: number;
  readonly fixed: boolean;
}

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

/** Result of scoring one candidate champion. */
interface ScoredCandidate {
  readonly championId: ChampionId;
  readonly score: number;
  readonly logOdds: number;
  readonly reasons: ReasonAccumulator[];
  readonly baselineNEff: number;
  readonly baselineRawGames: number;
  readonly baselineWinsE: number;
  readonly baselineGamesE: number;
  readonly p0: number;
  readonly offRole: boolean;
  readonly warnings: string[];
}

/** Accumulator for reasons during scoring, before the final Reason is produced. */
interface ReasonAccumulator {
  readonly type: 'synergy' | 'counter' | 'lane' | 'comp' | 'blind';
  readonly with: ChampionId[];
  readonly deltaPp: number;
  readonly n: number;
  readonly lowData: boolean;
  readonly level: ReasonLevel | undefined;
}

/**
 * Lane group configuration (SPECS §5, D-021).
 * - SUPPORT/ADC: bot lane (ally partner + 2 enemies)
 * - TOP/MID/JUNGLE: 1v1 (2 champions total, lane_full skipped)
 */
interface LaneGroup {
  readonly allies: Role[];
  readonly enemies: Role[];
  readonly oneToOne: boolean;
}

const LANE_GROUPS: Record<Role, LaneGroup> = {
  SUPPORT: { allies: ['ADC'], enemies: ['SUPPORT', 'ADC'], oneToOne: false },
  ADC: { allies: ['SUPPORT'], enemies: ['ADC', 'SUPPORT'], oneToOne: false },
  TOP: { allies: [], enemies: ['TOP'], oneToOne: true },
  MID: { allies: [], enemies: ['MID'], oneToOne: true },
  JUNGLE: { allies: [], enemies: ['JUNGLE'], oneToOne: true },
};

/** Role probability threshold to enter the candidate set (SPECS §5). */
export const ROLE_PROB_THRESHOLD = 0.05;

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
  const userBucket: RankBucket = rankToBucket(input.userRank);
  const myRole: Role = input.userRole;

  // --- Build indexes over the data tables ---
  const baselineIdx = indexBaselines(data.baselines, userBucket);
  const allyPairIdx = indexAllyPairs(data.allyPairs, userBucket);
  const enemyPairIdx = indexEnemyPairs(data.enemyPairs, userBucket);
  const laneVsIdx = indexLaneVs(data.laneVs, userBucket);
  const laneFullIdx = indexLaneFull(data.laneFull, userBucket);

  // --- Infer roles for ally and enemy teams ---
  const allyAssignment = input.allies.length > 0 ? inferRoles(input.allies, data.roleProb) : null;
  const enemyAssignment =
    input.enemies.length > 0 ? inferRoles(input.enemies, data.roleProb) : null;

  const allySlots: KnownSlot[] = allyAssignment
    ? allyAssignment.slots.map((s) => ({
        championId: s.championId,
        role: s.role,
        side: 'ally',
        confidence: s.confidence,
        fixed: input.allies.find((a) => a.championId === s.championId)?.role !== undefined,
      }))
    : [];

  const enemySlots: KnownSlot[] = enemyAssignment
    ? enemyAssignment.slots.map((s) => ({
        championId: s.championId,
        role: s.role,
        side: 'enemy',
        confidence: s.confidence,
        fixed: input.enemies.find((e) => e.championId === s.championId)?.role !== undefined,
      }))
    : [];

  // --- Infer lane-group champions from known enemies/allies ---
  const laneGroup = LANE_GROUPS[myRole];
  const laneGroupInfo = computeLaneGroup(laneGroup, allySlots, enemySlots);

  // --- Build candidate set ---
  const knownChampionSet = new Set<ChampionId>([
    ...allySlots.map((s) => s.championId),
    ...enemySlots.map((s) => s.championId),
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
  for (const id of pool) {
    if (knownChampionSet.has(id)) continue;
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
      const rawGames = Math.round(baseRow.gamesW);
      insufficientData.push({ championId: c, nEff: nE, rawGames });
      continue;
    }

    // p0 = shrink(winsE, gamesE, k0, 0.5); baseline log-odds
    const p0 = (winsE + config.k0 * 0.5) / (gamesE + config.k0);
    const x = baselineLogOdds(winsE, gamesE, config.k0, config.eps);

    // Determine if this is an off-role pool champion
    const rp = data.roleProb[c];
    const isOffRole = poolSet.has(c) && (!rp || !rp[myRole] || rp[myRole] < ROLE_PROB_THRESHOLD);

    // --- Layer 1: pairs ---
    const pairInfo = scorePairs(
      c,
      myRole,
      allySlots,
      enemySlots,
      allyPairIdx,
      enemyPairIdx,
      p0,
      config,
    );
    let logOdds = x + config.s * pairInfo.sum;
    const pairDeltas = pairInfo.deltas;

    // --- Layer 2: lane_vs ---
    let laneVsDelta: { term: number; lowData: boolean; n: number; deltaPp: number } | null = null;
    let laneFullDelta: { term: number; lowData: boolean; n: number; deltaPp: number } | null = null;

    const laneEnemiesKnown = laneGroup.enemies.every((role) =>
      laneGroupInfo.enemies.some((s) => s.role === role),
    );

    if (laneEnemiesKnown && laneGroupInfo.enemies.length > 0) {
      const enemy1 = laneGroupInfo.enemies[0];
      const enemy2 = laneGroupInfo.enemies[1];
      if (enemy1) {
        const vsKey = makeLaneVsKey(c, enemy1.championId, enemy2 ? enemy2.championId : -1);
        const row = laneVsIdx.get(vsKey);
        if (row) {
          const { winsE: we, gamesE: ge, nE: ne } = row;
          const qVs = sigmoid(logOdds);
          const result = scoreLane(we, ge, qVs, config);
          const term = laneGroupInfo.confidence * result.term;
          const dPp = deltaPp(logOdds, term);
          logOdds += term;
          laneVsDelta = {
            term: result.term,
            lowData: result.lowData,
            n: ne,
            deltaPp: dPp,
          };
        }
      }
    }

    // --- Layer 3: lane_full (skipped for 1v1 lane groups like TOP) ---
    const laneAlliesKnown = laneGroup.allies.every((role) =>
      laneGroupInfo.allies.some((s) => s.role === role),
    );

    if (!laneGroup.oneToOne && laneEnemiesKnown && laneAlliesKnown) {
      const partner = laneGroupInfo.allies[0];
      const enemy1 = laneGroupInfo.enemies[0];
      const enemy2 = laneGroupInfo.enemies[1];
      if (partner && enemy1 && enemy2) {
        const fullKey = makeLaneFullKey(
          c,
          partner.championId,
          enemy1.championId,
          enemy2.championId,
        );
        const row = laneFullIdx.get(fullKey);
        if (row) {
          const { winsE: we, gamesE: ge, nE: ne } = row;
          const qFull = sigmoid(logOdds);
          const result = scoreLane(we, ge, qFull, config);
          const term = laneGroupInfo.confidence * result.term;
          const dPp = deltaPp(logOdds, term);
          logOdds += term;
          laneFullDelta = {
            term: result.term,
            lowData: result.lowData,
            n: ne,
            deltaPp: dPp,
          };
        }
      }
    }

    // --- Layer 4: comp need ---
    const allyChampIds = allySlots.map((s) => s.championId);
    const compResult = computeCompNeed(c, allyChampIds, data.tags, compConfig);
    let compDelta: { bonus: number; deltaPp: number } | null = null;
    if (compResult.bonus !== 0) {
      const dPp = deltaPp(logOdds, compResult.bonus);
      logOdds += compResult.bonus;
      compDelta = { bonus: compResult.bonus, deltaPp: dPp };
    }

    // --- Layer 5: blind safety ---
    let blindDelta: { term: number; deltaPp: number } | null = null;
    if (input.blindPick || laneGroupInfo.enemiesKnown.length < 2) {
      const rawTerm = computeBlindSafety(c, enemySlots, enemyPairIdx, p0, config);
      if (rawTerm !== 0) {
        const term = config.s * rawTerm;
        const dPp = deltaPp(logOdds, term);
        logOdds += term;
        blindDelta = { term: rawTerm, deltaPp: dPp };
      }
    }

    // --- Compute final score ---
    const score = sigmoid(logOdds);

    // --- Build reasons ---
    const reasons = buildReasons(
      c,
      pairDeltas,
      laneVsDelta,
      laneFullDelta,
      compResult,
      compDelta,
      blindDelta,
      laneGroupInfo,
      config,
    );

    // --- Build warnings ---
    const warnings: string[] = [];
    if (isOffRole) {
      warnings.push('offRole');
    }

    // Check for hard counters from known enemies
    for (const enemy of enemySlots) {
      const pairData = enemyPairIdx.get(makePairKey(c, enemy.championId, enemy.role, myRole));
      if (pairData && pairData.gamesE > 0 && pairData.winsE / pairData.gamesE < 0.3) {
        warnings.push(`countered by enemy ${enemy.role} ${enemy.championId}`);
      }
    }

    scored.push({
      championId: c,
      score,
      logOdds,
      reasons,
      baselineNEff: nE,
      baselineRawGames: Math.round(baseRow.gamesW),
      baselineWinsE: winsE,
      baselineGamesE: gamesE,
      p0,
      offRole: isOffRole,
      warnings,
    });
  }

  // --- Sort and rank ---
  const sorted = scored.sort((a, b) => {
    const diff = b.score - a.score;
    if (Math.abs(diff) > 1e-9) return diff;
    return a.championId - b.championId;
  });

  const recommendations: Recommendation[] = sorted.map((s, i) => ({
    championId: s.championId,
    score: s.score,
    rank: i + 1,
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
  }));

  // --- Pool recommendations ---
  let poolRecommendations: Recommendation[] | undefined;
  let poolUnavailable: PoolUnavailableEntry[] | undefined;

  if (pool.length > 0) {
    poolRecommendations = [];
    poolUnavailable = [];

    const champIdSet = new Set(data.championIds);

    // poolUnavailable: check pool champions not in championIds
    for (const pid of pool) {
      if (knownChampionSet.has(pid)) continue;
      if (!champIdSet.has(pid)) {
        poolUnavailable.push({ championId: pid, reason: 'unknownChampion' });
      }
    }

    // Check pool champions in insufficientData
    for (const pid of pool) {
      if (!champIdSet.has(pid)) continue;
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
        poolRecommendations.push({
          championId: s.championId,
          score: s.score,
          rank: i + 1,
          poolRank,
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
        });
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

// --- Index builders ---

interface BaselineRow {
  readonly winsW: number;
  readonly gamesW: number;
  readonly gamesW2: number;
  readonly winsE: number;
  readonly gamesE: number;
  readonly nE: number;
}

function indexBaselines(
  baselines: BaselineTable,
  bucket: RankBucket,
): Map<ChampionId, BaselineRow> {
  const map = new Map<ChampionId, BaselineRow>();
  for (const row of baselines) {
    const [c, rowBucket, winsW, gamesW, gamesW2] = row;
    if (rowBucket !== bucket) continue;
    const nE = nEff(gamesW, gamesW2);
    const { winsE, gamesE } = toEquivalentCounts(winsW, gamesW, gamesW2);
    map.set(c, { winsW, gamesW, gamesW2, winsE, gamesE, nE });
  }
  return map;
}

interface PairRow {
  readonly winsW: number;
  readonly gamesW: number;
  readonly gamesW2: number;
  readonly winsE: number;
  readonly gamesE: number;
  readonly nE: number;
}

function indexAllyPairs(allyPairs: AllyPairTable, bucket: RankBucket): Map<string, PairRow> {
  const map = new Map<string, PairRow>();
  for (const row of allyPairs) {
    const [c, allyId, role, rowBucket, winsW, gamesW, gamesW2] = row;
    if (rowBucket !== bucket) continue;
    const nE = nEff(gamesW, gamesW2);
    const { winsE, gamesE } = toEquivalentCounts(winsW, gamesW, gamesW2);
    map.set(makePairKey(c, allyId, role, null), { winsW, gamesW, gamesW2, winsE, gamesE, nE });
  }
  return map;
}

function indexEnemyPairs(enemyPairs: EnemyPairTable, bucket: RankBucket): Map<string, PairRow> {
  const map = new Map<string, PairRow>();
  for (const row of enemyPairs) {
    const [c, enemyId, role, rowBucket, winsW, gamesW, gamesW2] = row;
    if (rowBucket !== bucket) continue;
    const nE = nEff(gamesW, gamesW2);
    const { winsE, gamesE } = toEquivalentCounts(winsW, gamesW, gamesW2);
    map.set(makePairKey(c, enemyId, role, null), { winsW, gamesW, gamesW2, winsE, gamesE, nE });
  }
  return map;
}

interface LaneRow {
  readonly winsW: number;
  readonly gamesW: number;
  readonly gamesW2: number;
  readonly winsE: number;
  readonly gamesE: number;
  readonly nE: number;
}

function indexLaneVs(laneVs: LaneVsTable, bucket: RankBucket): Map<string, LaneRow> {
  const map = new Map<string, LaneRow>();
  for (const row of laneVs) {
    const [c, opp1, opp2, rowBucket, winsW, gamesW, gamesW2] = row;
    if (rowBucket !== bucket) continue;
    const nE = nEff(gamesW, gamesW2);
    const { winsE, gamesE } = toEquivalentCounts(winsW, gamesW, gamesW2);
    const key = makeLaneVsKey(c, opp1, opp2 ?? -1);
    map.set(key, { winsW, gamesW, gamesW2, winsE, gamesE, nE });
  }
  return map;
}

function indexLaneFull(laneFull: LaneFullTable, bucket: RankBucket): Map<string, LaneRow> {
  const map = new Map<string, LaneRow>();
  for (const row of laneFull) {
    const [c, partner, opp1, opp2, rowBucket, winsW, gamesW, gamesW2] = row;
    if (rowBucket !== bucket) continue;
    const nE = nEff(gamesW, gamesW2);
    const { winsE, gamesE } = toEquivalentCounts(winsW, gamesW, gamesW2);
    const key = makeLaneFullKey(c, partner ?? -1, opp1, opp2 ?? -1);
    map.set(key, { winsW, gamesW, gamesW2, winsE, gamesE, nE });
  }
  return map;
}

// --- Key helpers ---

function makePairKey(c: ChampionId, other: ChampionId, role: Role, _myRole: Role | null): string {
  return `${c}:${other}:${role}`;
}

/** Key for lane_vs lookups: championId + opponent IDs in lane-group role order. */
function makeLaneVsKey(c: ChampionId, opp1: ChampionId, opp2: ChampionId): string {
  return `${c}:${opp1}:${opp2}`;
}

/** Key for lane_full lookups: championId + partner + opponents in role order. */
function makeLaneFullKey(
  c: ChampionId,
  partner: ChampionId,
  opp1: ChampionId,
  opp2: ChampionId,
): string {
  return `${c}:${partner}:${opp1}:${opp2}`;
}

// --- Lane group resolution ---

interface LaneGroupInfo {
  readonly allies: KnownSlot[];
  readonly enemies: KnownSlot[];
  readonly alliesKnown: Role[];
  readonly enemiesKnown: Role[];
  readonly confidence: number;
}

function computeLaneGroup(
  laneGroup: LaneGroup,
  allySlots: KnownSlot[],
  enemySlots: KnownSlot[],
): LaneGroupInfo {
  const allyLg = allySlots.filter((s) => laneGroup.allies.includes(s.role));
  const enemyLg = enemySlots.filter((s) => laneGroup.enemies.includes(s.role));

  // Sort to canonical role order defined in laneGroup
  const alliesSorted = allyLg
    .slice()
    .sort((a, b) => laneGroup.allies.indexOf(a.role) - laneGroup.allies.indexOf(b.role));
  const enemiesSorted = enemyLg
    .slice()
    .sort((a, b) => laneGroup.enemies.indexOf(a.role) - laneGroup.enemies.indexOf(b.role));

  const allyRoles = alliesSorted.map((s) => s.role);
  const enemyRoles = enemiesSorted.map((s) => s.role);

  let conf = 1;
  for (const s of [...alliesSorted, ...enemiesSorted]) {
    conf *= s.confidence;
  }

  return {
    allies: alliesSorted,
    enemies: enemiesSorted,
    alliesKnown: allyRoles,
    enemiesKnown: enemyRoles,
    confidence: conf,
  };
}

// --- Pair scoring ---

interface PairScoreInfo {
  readonly sum: number;
  readonly deltas: PairDelta[];
}

interface PairDelta {
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

function scorePairs(
  c: ChampionId,
  myRole: Role,
  allySlots: KnownSlot[],
  enemySlots: KnownSlot[],
  allyIdx: Map<string, PairRow>,
  enemyIdx: Map<string, PairRow>,
  p0: number,
  config: RankWeightingConfig,
): PairScoreInfo {
  const allSlots = [
    ...allySlots.map((s) => ({ ...s, side: 'ally' as const })),
    ...enemySlots.map((s) => ({ ...s, side: 'enemy' as const })),
  ];

  // Sort by descending influence; tie-break by championId ascending (SPECS §5, TICKETS.md T-026)
  const sorted = allSlots
    .map((s) => ({
      slot: s,
      influence: getInfluence(myRole, s.side, s.role, 'draft', config),
    }))
    .filter((entry) => entry.influence > 0)
    .sort((a, b) => b.influence - a.influence || a.slot.championId - b.slot.championId);

  const deltas: PairDelta[] = [];
  let sum = 0;
  let xRunning = logit(p0, config.eps);

  for (const { slot, influence } of sorted) {
    const key = makePairKey(c, slot.championId, slot.role, myRole);
    const idx = slot.side === 'ally' ? allyIdx : enemyIdx;
    const row = idx.get(key);
    if (!row) continue;

    const { winsE, gamesE, nE } = row;
    const result = scorePair(winsE, gamesE, p0, config);

    const term = result.term;
    const lowData = result.lowData;
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
      lowData,
      n: nE,
      deltaPp: dPp,
    });
  }

  return { sum, deltas };
}

// --- Blind safety ---

function computeBlindSafety(
  c: ChampionId,
  enemySlots: KnownSlot[],
  enemyIdx: Map<string, PairRow>,
  p0: number,
  config: RankWeightingConfig,
): number {
  let sum = 0;
  let count = 0;
  let minTerm = Infinity;

  for (const enemy of enemySlots) {
    const key = makePairKey(c, enemy.championId, enemy.role, null);
    const row = enemyIdx.get(key);
    if (row) {
      const { winsE: we, gamesE: ge } = row;
      const result = scorePair(we, ge, p0, config);
      sum += result.term;
      count++;
      if (result.term < minTerm) minTerm = result.term;
    }
  }

  if (count === 0) return 0;

  return sum / count + (minTerm === Infinity ? 0 : minTerm * 0.5);
}

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

// --- Reason builder ---

function buildReasons(
  _c: ChampionId,
  pairDeltas: PairDelta[],
  laneVsDelta: { term: number; lowData: boolean; n: number; deltaPp: number } | null,
  laneFullDelta: { term: number; lowData: boolean; n: number; deltaPp: number } | null,
  compResult: { bonus: number; reasons: readonly string[]; filled: readonly CompNeedCategory[] },
  compDelta: { bonus: number; deltaPp: number } | null,
  blindDelta: { term: number; deltaPp: number } | null,
  laneGroupInfo: LaneGroupInfo,
  config: RankWeightingConfig,
): ReasonAccumulator[] {
  const reasons: ReasonAccumulator[] = [];

  // 1. Pairs (synergies and counters) in descending order of influence (ties by championId ascending)
  for (const d of pairDeltas) {
    const level = toReasonLevel(levelFromConfig(d.deltaPp, d.n, config));
    reasons.push({
      type: d.side === 'ally' ? 'synergy' : 'counter',
      with: [d.championId],
      deltaPp: d.deltaPp,
      n: d.n,
      lowData: d.lowData,
      level,
    });
  }

  // 2. Lane Vs
  if (laneVsDelta) {
    const level = toReasonLevel(levelFromConfig(laneVsDelta.deltaPp, laneVsDelta.n, config));
    reasons.push({
      type: 'lane',
      with: laneGroupInfo.enemies.map((s) => s.championId),
      deltaPp: laneVsDelta.deltaPp,
      n: laneVsDelta.n,
      lowData: laneVsDelta.lowData,
      level,
    });
  }

  // 3. Lane Full
  if (laneFullDelta) {
    const level = toReasonLevel(levelFromConfig(laneFullDelta.deltaPp, laneFullDelta.n, config));
    reasons.push({
      type: 'lane',
      with: [
        ...laneGroupInfo.allies.map((s) => s.championId),
        ...laneGroupInfo.enemies.map((s) => s.championId),
      ],
      deltaPp: laneFullDelta.deltaPp,
      n: laneFullDelta.n,
      lowData: laneFullDelta.lowData,
      level,
    });
  }

  // 4. Comp needs
  if (compResult.filled.length > 0 && compDelta) {
    const level = toReasonLevel(levelFromConfig(compDelta.deltaPp, 0, config));
    reasons.push({
      type: 'comp',
      with: [],
      deltaPp: compDelta.deltaPp,
      n: 0,
      lowData: false,
      level,
    });
  }

  // 5. Blind safety
  if (blindDelta !== null && blindDelta.term !== 0) {
    reasons.push({
      type: 'blind',
      with: [],
      deltaPp: blindDelta.deltaPp,
      n: 0,
      lowData: false,
      level: undefined,
    });
  }

  return reasons;
}
