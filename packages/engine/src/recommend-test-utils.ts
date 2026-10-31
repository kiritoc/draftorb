/**
 * Shared builders for the `recommend` feature test files (test-only, pure).
 */

import type {
  AllyPairEntry,
  AllyPairTable,
  BaselineEntry,
  BaselineTable,
  ChampionId,
  ChampionRoleProbabilities,
  ChampionTags,
  ChampionTagsMap,
  DraftInput,
  EnemyPairEntry,
  EnemyPairTable,
  LaneFullEntry,
  LaneFullTable,
  LaneVsEntry,
  LaneVsTable,
  Rank,
  RankBucket,
  RecommendData,
  Role,
} from '@draftorb/shared';

/** gamesW=50, gamesW2=0.1 -> n_eff = 25000, well above minGames. */
export const HIGH_GAMES = { winsW: 30, gamesW: 50, gamesW2: 0.1 } as const;

interface WeightedCounts {
  winsW: number;
  gamesW: number;
  gamesW2: number;
}

/** Every champion at 30/50 (60%) in `bucket`. */
export function makeBaselines(
  champions: ChampionId[],
  bucket: RankBucket = 'DIAMOND',
): BaselineTable {
  return champions.map((c): BaselineEntry => [c, bucket, 30, 50, 0.1, 50]);
}

export function makeAllyPairs(
  entries: Array<{ championId: ChampionId; allyId: ChampionId; role: Role } & WeightedCounts>,
  bucket: RankBucket = 'DIAMOND',
): AllyPairTable {
  return entries.map((e): AllyPairEntry => [
    e.championId,
    e.allyId,
    e.role,
    bucket,
    e.winsW,
    e.gamesW,
    e.gamesW2,
  ]);
}

export function makeEnemyPairs(
  entries: Array<{ championId: ChampionId; enemyId: ChampionId; role: Role } & WeightedCounts>,
  bucket: RankBucket = 'DIAMOND',
): EnemyPairTable {
  return entries.map((e): EnemyPairEntry => [
    e.championId,
    e.enemyId,
    e.role,
    bucket,
    e.winsW,
    e.gamesW,
    e.gamesW2,
  ]);
}

export function makeLaneVs(
  entries: Array<
    { championId: ChampionId; opp1Id: ChampionId; opp2Id: ChampionId | null } & WeightedCounts
  >,
  bucket: RankBucket = 'DIAMOND',
): LaneVsTable {
  return entries.map((e): LaneVsEntry => [
    e.championId,
    e.opp1Id,
    e.opp2Id,
    bucket,
    e.winsW,
    e.gamesW,
    e.gamesW2,
  ]);
}

export function makeLaneFull(
  entries: Array<
    {
      championId: ChampionId;
      partnerId: ChampionId | null;
      opp1Id: ChampionId;
      opp2Id: ChampionId | null;
    } & WeightedCounts
  >,
  bucket: RankBucket = 'DIAMOND',
): LaneFullTable {
  return entries.map((e): LaneFullEntry => [
    e.championId,
    e.partnerId,
    e.opp1Id,
    e.opp2Id,
    bucket,
    e.winsW,
    e.gamesW,
    e.gamesW2,
  ]);
}

export function makeRoleProb(
  champions: ChampionId[],
  role: Role = 'SUPPORT',
): ChampionRoleProbabilities {
  const result: Record<string, Partial<Record<Role, number>>> = {};
  for (const c of champions) result[String(c)] = { [role]: 1.0 };
  return result as ChampionRoleProbabilities;
}

/** A tag entry; defaults to an engage/peel/waveclear MIXED tank. */
export function makeTag(championId: ChampionId, overrides: Partial<ChampionTags> = {}): ChampionTags {
  return {
    championId,
    damageType: 'MIXED',
    archetype: 'tank',
    hardEngage: true,
    peel: true,
    poke: false,
    waveclear: true,
    scaling: { early: false, mid: true, late: true },
    range: 'MELEE',
    ccCount: 2,
    ...overrides,
  };
}

export function makeChampionTags(champions: ChampionId[]): ChampionTagsMap {
  const result: Record<string, ChampionTags> = {};
  for (const c of champions) result[String(c)] = makeTag(c);
  return result;
}

/** A marksman tag with no utility (engage/peel/poke/waveclear all false). */
export function noUtilityTag(championId: ChampionId): ChampionTags {
  return makeTag(championId, {
    damageType: 'AD',
    archetype: 'marksman',
    hardEngage: false,
    peel: false,
    waveclear: false,
    range: 'RANGED',
    ccCount: 0,
  });
}

export function makeInput(
  overrides: Partial<{
    allies: Array<{ championId: ChampionId; role?: Role }>;
    enemies: Array<{ championId: ChampionId; role?: Role }>;
    blindPick: boolean;
    pool: ChampionId[];
    userRank: Rank;
    userRole: Role;
  }> = {},
): DraftInput {
  return {
    userRank: overrides.userRank ?? 'DIAMOND',
    userRole: overrides.userRole ?? 'SUPPORT',
    allies: overrides.allies ?? [],
    enemies: overrides.enemies ?? [],
    blindPick: overrides.blindPick ?? false,
    pool: overrides.pool,
  };
}

export function makeData(opts: {
  champions: ChampionId[];
  baselines?: BaselineTable;
  allyPairs?: AllyPairTable;
  enemyPairs?: EnemyPairTable;
  laneVs?: LaneVsTable;
  laneFull?: LaneFullTable;
  roleProb?: ChampionRoleProbabilities;
  tags?: ChampionTagsMap;
}): RecommendData {
  return {
    baselines: opts.baselines ?? makeBaselines(opts.champions),
    allyPairs: opts.allyPairs ?? [],
    enemyPairs: opts.enemyPairs ?? [],
    laneVs: opts.laneVs ?? [],
    laneFull: opts.laneFull ?? [],
    roleProb: opts.roleProb ?? makeRoleProb(opts.champions),
    tags: opts.tags ?? makeChampionTags(opts.champions),
    championIds: opts.champions,
  };
}

/** Cast a literal role-probability map. */
export function asRoleProb(
  r: Record<string, Partial<Record<Role, number>>>,
): ChampionRoleProbabilities {
  return r as ChampionRoleProbabilities;
}

/** Bot-lane role probabilities shared by most scenarios. */
export const BOT_ROLE_PROB = asRoleProb({
  '1': { SUPPORT: 1 },
  '2': { SUPPORT: 1 },
  '10': { ADC: 1 },
  '11': { ADC: 1 },
  '20': { SUPPORT: 1 },
  '200': { SUPPORT: 1 },
  '201': { ADC: 1 },
  '202': { ADC: 1 },
});

/** Fixed enemy bot lane: 200 SUPPORT, 201 ADC. */
export const FIXED_BOT: Array<{ championId: ChampionId; role: Role }> = [
  { championId: 200, role: 'SUPPORT' },
  { championId: 201, role: 'ADC' },
];
