/**
 * @draftorb/engine — Role-generic recommendation engine (T-023, SPECS §5-7).
 *
 * Pure and deterministic. Takes the draft input plus the role-keyed tables
 * (`roles/<ROLE>/...`) and returns a `DraftResult`.
 *
 * Scope: baseline gate, baseline, pair layer, `lane_vs`, `lane_full`, reasons
 * and the D-024 pool contract. `compNeed` (T-025) and `blindSafety` (T-024)
 * are out of scope for this ticket and contribute 0.
 *
 * Assumptions (PROPOSED, to confirm in DECISIONS.md):
 * - Rows are per rank bucket; the engine applies the §3 rank-distance kernel
 *   per bucket (`w_b`) and sums `wins_w*w_b`, `games_w*w_b`, `games_w2*w_b^2`.
 * - Rows carry no raw game count, so `rawGames` is the rounded sum of
 *   `games_w` over the buckets kept by the kernel.
 * - Lane opponents are stored in `LANE_GROUPS[myRole].enemies` order.
 */

import type {
  AllyPairTable,
  BaselineTable,
  ChampionId,
  ChampionRoleProbabilities,
  DraftInput,
  DraftResult,
  EnemyPairTable,
  InsufficientDataEntry,
  LaneFullTable,
  LaneVsTable,
  PoolUnavailableEntry,
  RankBucket,
  Reason,
  ReasonLevel,
  Recommendation,
  Role,
  Slot,
} from '@draftorb/shared';

import { DEFAULT_CONFIG, bucketIndex, getInfluence, rankToBucket } from './config.js';
import type { RankWeightingConfig, Side } from './config.js';
import {
  baselineGate,
  baselineLogOdds,
  deltaPp,
  isLowData,
  laneTerm,
  mapDeltaPpToLevel,
  pairTerm,
} from './levels.js';
import { inferRoles } from './roles.js';
import { roleProbability } from './roles-utils.js';
import { rankDistanceWeight, sigmoid, toEquivalentCounts } from './weighting.js';

/** Minimum `roleProb[c][myRole]` for a candidate to be in the default set (SPECS §5). */
export const CANDIDATE_ROLE_PROB_MIN = 0.05;

/** Lane group per role (SPECS §5, D-021). 1v1 groups have no allies (lane_full skipped). */
export const LANE_GROUPS: Readonly<
  Record<Role, { readonly allies: readonly Role[]; readonly enemies: readonly Role[] }>
> = {
  SUPPORT: { allies: ['ADC'], enemies: ['SUPPORT', 'ADC'] },
  ADC: { allies: ['SUPPORT'], enemies: ['ADC', 'SUPPORT'] },
  TOP: { allies: [], enemies: ['TOP'] },
  MID: { allies: [], enemies: ['MID'] },
  JUNGLE: { allies: [], enemies: ['JUNGLE'] },
};

/** Role-keyed tables for `input.userRole` (DATA_MODEL.md). */
export interface DraftData {
  readonly roleProb: ChampionRoleProbabilities;
  readonly baseline: BaselineTable;
  readonly allyPairs: AllyPairTable;
  readonly enemyPairs: EnemyPairTable;
  readonly laneVs: LaneVsTable;
  readonly laneFull: LaneFullTable;
}

interface Counts {
  winsW: number;
  gamesW: number;
  gamesW2: number;
  rawGames: number;
}

interface KnownSlot {
  readonly championId: ChampionId;
  readonly role: Role;
  readonly confidence: number;
  readonly side: Side;
}

interface Tables {
  readonly baseline: ReadonlyMap<string, Counts>;
  readonly ally: ReadonlyMap<string, Counts>;
  readonly enemy: ReadonlyMap<string, Counts>;
  readonly laneVs: ReadonlyMap<string, Counts>;
  readonly laneFull: ReadonlyMap<string, Counts>;
}

type Scored = Omit<Recommendation, 'rank' | 'poolRank'>;

function accumulate(
  map: Map<string, Counts>,
  key: string,
  bucket: RankBucket,
  userIdx: number,
  winsW: number,
  gamesW: number,
  gamesW2: number,
  config: RankWeightingConfig,
): void {
  const w = rankDistanceWeight(bucketIndex(bucket), userIdx, config.tau, config.rankWindowTiers);
  if (w <= 0) {
    return;
  }
  const c = map.get(key) ?? { winsW: 0, gamesW: 0, gamesW2: 0, rawGames: 0 };
  c.winsW += w * winsW;
  c.gamesW += w * gamesW;
  c.gamesW2 += w * w * gamesW2;
  c.rawGames += gamesW;
  map.set(key, c);
}

function indexTables(data: DraftData, userIdx: number, config: RankWeightingConfig): Tables {
  const baseline = new Map<string, Counts>();
  for (const [c, b, wi, g, g2] of data.baseline) {
    accumulate(baseline, `${c}`, b, userIdx, wi, g, g2, config);
  }
  const ally = new Map<string, Counts>();
  for (const [c, o, r, b, wi, g, g2] of data.allyPairs) {
    accumulate(ally, `${c}|${o}|${r}`, b, userIdx, wi, g, g2, config);
  }
  const enemy = new Map<string, Counts>();
  for (const [c, o, r, b, wi, g, g2] of data.enemyPairs) {
    accumulate(enemy, `${c}|${o}|${r}`, b, userIdx, wi, g, g2, config);
  }
  const laneVs = new Map<string, Counts>();
  for (const [c, o1, o2, b, wi, g, g2] of data.laneVs) {
    accumulate(laneVs, `${c}|${o1}|${o2 ?? ''}`, b, userIdx, wi, g, g2, config);
  }
  const laneFull = new Map<string, Counts>();
  for (const [c, p, o1, o2, b, wi, g, g2] of data.laneFull) {
    accumulate(laneFull, `${c}|${p ?? ''}|${o1}|${o2 ?? ''}`, b, userIdx, wi, g, g2, config);
  }
  return { baseline, ally, enemy, laneVs, laneFull };
}

function equivalent(counts: Counts | undefined): { winsE: number; gamesE: number } {
  if (!counts) {
    return { winsE: 0, gamesE: 0 };
  }
  return toEquivalentCounts(counts.winsW, counts.gamesW, counts.gamesW2);
}

function resolveTeam(
  slots: ReadonlyArray<Slot>,
  roleProb: ChampionRoleProbabilities,
  side: Side,
): KnownSlot[] {
  if (slots.length === 0) {
    return [];
  }
  const inferred = inferRoles(slots, roleProb);
  if (inferred) {
    return inferred.slots.map((s) => ({ ...s, side }));
  }
  // No valid assignment: keep only user-fixed roles (confidence 1).
  return slots.flatMap((s) =>
    s.role !== undefined ? [{ championId: s.championId, role: s.role, confidence: 1, side }] : [],
  );
}

function makeReason(
  type: Reason['type'],
  withIds: ChampionId[],
  dpp: number,
  n: number,
  lowData: boolean,
  config: RankWeightingConfig,
): Reason {
  const level = lowData ? 0 : mapDeltaPpToLevel(dpp, n, config.minGames);
  return {
    type,
    with: withIds,
    ...(level !== 0 ? { level: level as ReasonLevel } : {}),
    deltaPp: dpp,
    n,
    lowData,
  };
}

function laneLayer(
  counts: Counts | undefined,
  ids: ChampionId[],
  conf: number,
  x: number,
  config: RankWeightingConfig,
): { x: number; reason: Reason } {
  const e = equivalent(counts);
  const lowData = isLowData(e.gamesE, config.minGames);
  const raw = laneTerm(e.winsE, e.gamesE, config.kLane, sigmoid(x), config.eps, config.minGames);
  const term = conf * raw;
  const dpp = deltaPp(x, term);
  return { x: x + term, reason: makeReason('lane', ids, dpp, e.gamesE, lowData, config) };
}

function scoreCandidate(
  c: ChampionId,
  myRole: Role,
  slots: readonly KnownSlot[],
  tables: Tables,
  config: RankWeightingConfig,
  offRole: boolean,
): Scored | InsufficientDataEntry {
  const base = tables.baseline.get(`${c}`);
  const be = equivalent(base);
  if (be.gamesE <= 0 || !baselineGate(be.gamesE, config.minGames)) {
    return { championId: c, nEff: be.gamesE, rawGames: Math.round(base?.rawGames ?? 0) };
  }

  let x = baselineLogOdds(be.winsE, be.gamesE, config.k0, config.eps);
  const p0 = sigmoid(x);
  const reasons: Reason[] = [];
  const warnings: string[] = offRole ? ['offRole'] : [];

  // Layer 1: pairs, by descending influence (ties by championId). Pair terms are
  // all shrunk toward p0, scaled by s * conf * influence (SPECS §5).
  const ordered = slots
    .map((s) => ({ s, infl: getInfluence(myRole, s.side, s.role, 'draft', config) }))
    .filter(({ infl }) => infl > 0)
    .sort((a, b) => b.infl - a.infl || a.s.championId - b.s.championId);

  for (const { s, infl } of ordered) {
    const table = s.side === 'ally' ? tables.ally : tables.enemy;
    const e = equivalent(table.get(`${c}|${s.championId}|${s.role}`));
    const lowData = isLowData(e.gamesE, config.minGames);
    const raw = pairTerm(e.winsE, e.gamesE, config.k, p0, config.eps, config.minGames);
    const term = config.s * s.confidence * infl * raw;
    const dpp = deltaPp(x, term);
    x += term;
    const type = s.side === 'ally' ? 'synergy' : 'counter';
    const reason = makeReason(type, [s.championId], dpp, e.gamesE, lowData, config);
    reasons.push(reason);
    if (s.side === 'enemy' && reason.level !== undefined && reason.level < 0) {
      warnings.push(`countered by enemy ${s.role} ${s.championId}`);
    }
  }

  // Layers 2-3: lane group. A layer is skipped when one of its champions is unknown.
  const group = LANE_GROUPS[myRole];
  const find = (side: Side, role: Role): KnownSlot | undefined =>
    slots.find((s) => s.side === side && s.role === role);
  const enemies = group.enemies.map((r) => find('enemy', r));
  const allies = group.allies.map((r) => find('ally', r));

  if (enemies.every((e): e is KnownSlot => e !== undefined)) {
    const o1 = enemies[0]?.championId;
    const o2 = enemies[1]?.championId;
    const confEnemies = enemies.reduce((acc, s) => acc * s.confidence, 1);
    const enemyIds = enemies.map((s) => s.championId);

    const vsCounts = tables.laneVs.get(`${c}|${o1}|${o2 ?? ''}`);
    const vs = laneLayer(vsCounts, enemyIds, confEnemies, x, config);
    x = vs.x;
    reasons.push(vs.reason);

    if (allies.length > 0 && allies.every((a): a is KnownSlot => a !== undefined)) {
      const partner = allies[0]?.championId;
      const conf = confEnemies * allies.reduce((acc, s) => acc * s.confidence, 1);
      const ids = [...allies.map((s) => s.championId), ...enemyIds];
      const key = `${c}|${partner ?? ''}|${o1}|${o2 ?? ''}`;
      const full = laneLayer(tables.laneFull.get(key), ids, conf, x, config);
      x = full.x;
      reasons.push(full.reason);
    }
  }

  return {
    championId: c,
    score: sigmoid(x),
    reasons,
    reliability: { games: be.gamesE, lowData: false },
    warnings,
  };
}

function isScored(r: Scored | InsufficientDataEntry): r is Scored {
  return 'score' in r;
}

/**
 * Recommend champions for `input.userRole` (SPECS §5-7, D-024).
 *
 * - `recommendations`: every scored candidate, sorted by score desc (ties by
 *   championId), never truncated.
 * - `insufficientData`: candidates failing the baseline gate.
 * - With a non-empty pool: `poolRecommendations` (overall order, `poolRank`)
 *   and `poolUnavailable`. The pool never changes any score.
 */
export function recommend(
  input: DraftInput,
  data: DraftData,
  config: RankWeightingConfig = DEFAULT_CONFIG,
): DraftResult {
  const myRole = input.userRole;
  const userIdx = bucketIndex(rankToBucket(input.userRank));
  const tables = indexTables(data, userIdx, config);

  const slots = [
    ...resolveTeam(input.allies, data.roleProb, 'ally'),
    ...resolveTeam(input.enemies, data.roleProb, 'enemy'),
  ];
  const picked = new Set<ChampionId>([
    ...input.allies.map((s) => s.championId),
    ...input.enemies.map((s) => s.championId),
  ]);

  const roleSet = new Set<ChampionId>();
  for (const key of Object.keys(data.roleProb)) {
    const id = Number(key);
    if (roleProbability(data.roleProb, id, myRole) >= CANDIDATE_ROLE_PROB_MIN) {
      roleSet.add(id);
    }
  }

  const pool = [...new Set(input.pool ?? [])];
  const candidates = [...new Set<ChampionId>([...roleSet, ...pool])]
    .filter((id) => !picked.has(id))
    .sort((a, b) => a - b);

  const scored: Scored[] = [];
  const insufficientData: InsufficientDataEntry[] = [];
  for (const id of candidates) {
    const r = scoreCandidate(id, myRole, slots, tables, config, !roleSet.has(id));
    if (isScored(r)) {
      scored.push(r);
    } else if (roleSet.has(id) || tables.baseline.has(`${id}`)) {
      // Pool-only ids with no data at all are `unknownChampion`, not insufficientData.
      insufficientData.push(r);
    }
  }

  scored.sort((a, b) => b.score - a.score || a.championId - b.championId);
  const recommendations: Recommendation[] = scored.map((r, i) => ({ ...r, rank: i + 1 }));

  if (pool.length === 0) {
    return { recommendations, insufficientData };
  }

  const poolSet = new Set(pool);
  const poolRecommendations = recommendations
    .filter((r) => poolSet.has(r.championId))
    .map((r, i) => ({ ...r, poolRank: i + 1 }));

  const scoredIds = new Set(recommendations.map((r) => r.championId));
  const insufficientIds = new Set(insufficientData.map((e) => e.championId));
  const poolUnavailable: PoolUnavailableEntry[] = pool
    .filter((id) => !scoredIds.has(id) && !picked.has(id))
    .sort((a, b) => a - b)
    .map((id) => ({
      championId: id,
      reason: insufficientIds.has(id) ? 'insufficientData' : 'unknownChampion',
    }));

  return { recommendations, insufficientData, poolRecommendations, poolUnavailable };
}
