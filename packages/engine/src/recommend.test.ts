/**
 * Unit tests for the recommendation engine (T-023).
 *
 * Tests focus on: baseline gate, pair scoring, lane terms, comp bonus,
 * blind safety, pool contract, off-role warnings, and determinism.
 */

import { describe, it, expect } from 'vitest';
import { recommend, type RecommendData } from './recommend.js';
import { DEFAULT_COMP_CONFIG, DEFAULT_CONFIG } from './config.js';
import { indexBaselines, indexPairs, makePairKey } from './recommend-indexes.js';
import { baselineLogOdds, deltaPp, scorePair } from './levels.js';
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
  Role,
} from '@draftorb/shared';

/**
 * Helper: build a baseline table for a set of champions.
 * Each champion gets games_w=50, wins_w=30 (60% win rate) at the DIAMOND bucket.
 */
function makeBaselines(champions: ChampionId[], bucket: RankBucket = 'DIAMOND'): BaselineTable {
  return champions.map((c): BaselineEntry => [c, bucket, 30, 50, 0.1, 50]);
}

function makeAllyPairs(
  entries: Array<{
    championId: ChampionId;
    allyId: ChampionId;
    role: Role;
    winsW: number;
    gamesW: number;
    gamesW2: number;
  }>,
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

function makeEnemyPairs(
  entries: Array<{
    championId: ChampionId;
    enemyId: ChampionId;
    role: Role;
    winsW: number;
    gamesW: number;
    gamesW2: number;
  }>,
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

function makeLaneVs(
  entries: Array<{
    championId: ChampionId;
    opp1Id: ChampionId;
    opp2Id: ChampionId | null;
    winsW: number;
    gamesW: number;
    gamesW2: number;
  }>,
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

function makeLaneFull(
  entries: Array<{
    championId: ChampionId;
    partnerId: ChampionId | null;
    opp1Id: ChampionId;
    opp2Id: ChampionId | null;
    winsW: number;
    gamesW: number;
    gamesW2: number;
  }>,
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

function makeRoleProb(champions: ChampionId[], role: Role = 'SUPPORT'): ChampionRoleProbabilities {
  const result: Record<string, Partial<Record<Role, number>>> = {};
  for (const c of champions) {
    result[String(c)] = { [role]: 1.0 };
  }
  return result as ChampionRoleProbabilities;
}

function makeChampionTags(champions: ChampionId[]): ChampionTagsMap {
  const result: Record<string, ChampionTags> = {};
  for (const c of champions) {
    result[String(c)] = {
      championId: c,
      damageType: 'MIXED',
      archetype: 'tank',
      hardEngage: true,
      peel: true,
      poke: false,
      waveclear: true,
      scaling: { early: false, mid: true, late: true },
      range: 'MELEE',
      ccCount: 2,
    };
  }
  return result;
}

function makeInput(
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

function makeData(opts: {
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

// With gamesW=50, gamesW2=0.1, n_eff = 50^2/0.1 = 25000 — well above 25
const HIGH_GAMES = { winsW: 30, gamesW: 50, gamesW2: 0.1 };

describe('recommend: candidate set', () => {
  it('includes all champions passing baseline gate', () => {
    const champions: ChampionId[] = [1, 2, 3];
    const data = makeData({ champions });
    const input = makeInput();
    const result = recommend(input, data);

    expect(result.recommendations).toHaveLength(3);
    expect(result.recommendations.map((r) => r.championId).sort((a, b) => a - b)).toEqual([
      1, 2, 3,
    ]);
  });

  it('excludes champions with n_eff below minGames (insufficientData)', () => {
    const champions: ChampionId[] = [1, 2];
    const baselines: BaselineTable = [
      [champions[0] ?? 1, 'DIAMOND', 5, 10, 10, 10], // n_eff = 10, below 25
      [champions[1] ?? 2, 'DIAMOND', 30, 50, 0.1, 50], // n_eff = 25000, passes
    ];
    const data = makeData({ champions, baselines });
    const input = makeInput();
    const result = recommend(input, data);

    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]?.championId).toBe(2);
    expect(result.insufficientData).toHaveLength(1);
    expect(result.insufficientData[0]?.championId).toBe(1);
    expect(result.insufficientData[0]?.nEff).toBeCloseTo(10, 5);
    expect(result.insufficientData[0]?.rawGames).toBe(10);
  });

  it('excludes champions missing from roleProb entirely', () => {
    const champions: ChampionId[] = [1, 2];
    const roleProb: ChampionRoleProbabilities = {
      '1': { SUPPORT: 1.0 },
    } as ChampionRoleProbabilities;
    const data = makeData({ champions, roleProb });
    const input = makeInput();
    const result = recommend(input, data);

    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]?.championId).toBe(1);
  });
});

describe('recommend: sorting and ranking', () => {
  it('sorts recommendations descending by score', () => {
    const champions: ChampionId[] = [1, 2, 3];
    const baselines: BaselineTable = [
      [1, 'DIAMOND', 40, 50, 0.1, 50], // 80% win rate
      [2, 'DIAMOND', 25, 50, 0.1, 50], // 50% win rate
      [3, 'DIAMOND', 10, 50, 0.1, 50], // 20% win rate
    ];
    const data = makeData({ champions, baselines });
    const input = makeInput();
    const result = recommend(input, data);

    const scores = result.recommendations.map((r) => r.score);
    const score0 = scores[0];
    const score1 = scores[1];
    const score2 = scores[2];
    expect(score0).toBeDefined();
    expect(score1).toBeDefined();
    expect(score2).toBeDefined();
    if (score0 !== undefined && score1 !== undefined && score2 !== undefined) {
      expect(score0).toBeGreaterThan(score1);
      expect(score1).toBeGreaterThan(score2);
    }
    expect(result.recommendations.map((r) => r.championId)).toEqual([1, 2, 3]);
    expect(result.recommendations.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('ranks are 1-based and sequential', () => {
    const champions: ChampionId[] = [10, 20];
    const data = makeData({ champions });
    const input = makeInput();
    const result = recommend(input, data);

    expect(result.recommendations[0]?.rank).toBe(1);
    expect(result.recommendations[1]?.rank).toBe(2);
  });

  it('breaks ties by championId ascending', () => {
    const champions: ChampionId[] = [5, 3];
    const baselines = makeBaselines(champions);
    const data = makeData({ champions, baselines });
    const input = makeInput();
    const result = recommend(input, data);

    expect(result.recommendations.map((r) => r.championId)).toEqual([3, 5]);
  });
});

describe('recommend: pair terms', () => {
  it('adds synergy from ally pairs (positive delta)', () => {
    const champions: ChampionId[] = [1, 2, 100];

    // Pair: champion 1 + ally 100 = 40/50 wins (80%) — better than baseline (60%)
    const allyPairs = makeAllyPairs([
      { championId: 1, allyId: 100, role: 'ADC', ...HIGH_GAMES, winsW: 40 },
      { championId: 2, allyId: 100, role: 'ADC', ...HIGH_GAMES, winsW: 30 },
    ]);

    const roleProb: ChampionRoleProbabilities = {
      '1': { SUPPORT: 1.0 },
      '2': { SUPPORT: 1.0 },
      '100': { ADC: 1.0 },
    } as ChampionRoleProbabilities;

    const data = makeData({
      champions,
      allyPairs,
      roleProb,
      tags: makeChampionTags([1, 2, 100]),
    });

    const input = makeInput({
      allies: [{ championId: 100, role: 'ADC' }],
    });

    const result = recommend(input, data);

    expect(result.recommendations.map((r) => r.championId)).toEqual([1, 2]);
    const firstRec = result.recommendations[0];
    expect(firstRec).toBeDefined();
    expect(firstRec?.reasons.some((r) => r.type === 'synergy')).toBe(true);
  });

  it('adds counter from enemy pairs (negative delta)', () => {
    const champions: ChampionId[] = [1, 2, 200];

    const enemyPairs = makeEnemyPairs([
      { championId: 1, enemyId: 200, role: 'SUPPORT', ...HIGH_GAMES, winsW: 10 },
      { championId: 2, enemyId: 200, role: 'SUPPORT', ...HIGH_GAMES, winsW: 30 },
    ]);

    const roleProb: ChampionRoleProbabilities = {
      '1': { SUPPORT: 1.0 },
      '2': { SUPPORT: 1.0 },
      '200': { SUPPORT: 1.0 },
    } as ChampionRoleProbabilities;

    const data = makeData({
      champions,
      enemyPairs,
      roleProb,
      tags: makeChampionTags([1, 2, 200]),
    });

    const input = makeInput({
      enemies: [{ championId: 200, role: 'SUPPORT' }],
    });

    const result = recommend(input, data);

    expect(result.recommendations.map((r) => r.championId)).toEqual([2, 1]);
    const secondRec = result.recommendations[1];
    expect(secondRec).toBeDefined();
    expect(secondRec?.reasons.some((r) => r.type === 'counter')).toBe(true);
  });
});

describe('recommend: lane terms', () => {
  it('applies lane_vs for bot lane groups (SUPPORT)', () => {
    const champions: ChampionId[] = [1, 2];
    const baselines = makeBaselines(champions);

    const laneVs = makeLaneVs([
      { championId: 1, opp1Id: 200, opp2Id: 201, ...HIGH_GAMES, winsW: 40 },
      { championId: 2, opp1Id: 200, opp2Id: 201, ...HIGH_GAMES, winsW: 20 },
    ]);

    const roleProb: ChampionRoleProbabilities = {
      '1': { SUPPORT: 1.0 },
      '2': { SUPPORT: 1.0 },
      '200': { SUPPORT: 1.0 },
      '201': { ADC: 1.0 },
    } as ChampionRoleProbabilities;

    const data = makeData({
      champions: [1, 2, 200, 201],
      baselines,
      laneVs,
      roleProb,
      tags: makeChampionTags([1, 2, 200, 201]),
    });

    const input = makeInput({
      enemies: [
        { championId: 200, role: 'SUPPORT' },
        { championId: 201, role: 'ADC' },
      ],
    });

    const result = recommend(input, data);
    expect(result.recommendations.map((r) => r.championId)).toEqual([1, 2]);

    const rec1 = result.recommendations[0];
    const rec2 = result.recommendations[1];
    expect(rec1?.reasons.some((r) => r.type === 'lane')).toBe(true);
    expect(rec2?.reasons.some((r) => r.type === 'lane')).toBe(true);
  });

  it('skips lane_full for 1v1 lane groups (TOP)', () => {
    const champions: ChampionId[] = [1, 2];
    const baselines = makeBaselines(champions);

    const laneFull = makeLaneFull([
      { championId: 1, partnerId: 301, opp1Id: 300, opp2Id: null, ...HIGH_GAMES, winsW: 45 },
    ]);

    const roleProb: ChampionRoleProbabilities = {
      '1': { TOP: 1.0 },
      '2': { TOP: 1.0 },
      '300': { TOP: 1.0 },
      '301': { JUNGLE: 1.0 },
    } as ChampionRoleProbabilities;

    const data = makeData({
      champions,
      baselines,
      laneFull,
      roleProb,
      tags: makeChampionTags([1, 2, 300, 301]),
    });

    const input = makeInput({
      userRole: 'TOP',
      allies: [{ championId: 301, role: 'JUNGLE' }],
      enemies: [{ championId: 300, role: 'TOP' }],
    });

    const result = recommend(input, data);
    expect(result.recommendations.map((r) => r.championId)).toEqual([1, 2]);

    for (const rec of result.recommendations) {
      const laneReasons = rec.reasons.filter((r) => r.type === 'lane');
      expect(laneReasons.length).toBeLessThanOrEqual(1);
    }
  });
});

describe('recommend: pool contract (D-024)', () => {
  it('identical scores with and without a pool', () => {
    const champions: ChampionId[] = [1, 2, 3, 4, 5];
    const data = makeData({ champions });

    const inputNoPool = makeInput();
    const inputWithPool = makeInput({ pool: [1, 3] });

    const resultNoPool = recommend(inputNoPool, data);
    const resultWithPool = recommend(inputWithPool, data);

    for (const rec of resultNoPool.recommendations) {
      const pooled = resultWithPool.recommendations.find((r) => r.championId === rec.championId);
      expect(pooled).toBeDefined();
      if (pooled) {
        expect(pooled.score).toBeCloseTo(rec.score, 10);
      }
    }
  });

  it('poolRecommendations is subsequence of recommendations in same overall order', () => {
    const champions: ChampionId[] = [1, 2, 3, 4, 5];
    const data = makeData({ champions });
    const input = makeInput({ pool: [2, 4] });
    const result = recommend(input, data);

    expect(result.recommendations.length).toBe(5);
    expect(result.poolRecommendations).toBeDefined();
    expect(result.poolRecommendations).toHaveLength(2);

    const overallIds = result.recommendations.map((r) => r.championId);
    const poolRecs = result.poolRecommendations ?? [];
    const poolIds = poolRecs.map((r) => r.championId);
    const poolIndices = poolIds.map((id) => overallIds.indexOf(id));

    for (let i = 1; i < poolIndices.length; i++) {
      const prev = poolIndices[i - 1];
      const curr = poolIndices[i];
      expect(prev).toBeDefined();
      expect(curr).toBeDefined();
      if (prev !== undefined && curr !== undefined) {
        expect(curr).toBeGreaterThan(prev);
      }
    }

    expect(poolRecs.map((r) => r.poolRank)).toEqual([1, 2]);
    const firstIdx = poolIndices[0];
    const secondIdx = poolIndices[1];
    if (firstIdx !== undefined && secondIdx !== undefined) {
      expect(poolRecs[0]?.rank).toBe(firstIdx + 1);
      expect(poolRecs[1]?.rank).toBe(secondIdx + 1);
    }
  });

  it('pool champion without data goes to poolUnavailable + insufficientData', () => {
    const champions: ChampionId[] = [1, 2, 3];
    const data = makeData({ champions, baselines: makeBaselines([1, 2]) });

    const input = makeInput({ pool: [3] });
    const result = recommend(input, data);

    expect(result.poolUnavailable).toBeDefined();
    expect(result.poolUnavailable).toHaveLength(1);
    expect(result.poolUnavailable?.[0]?.championId).toBe(3);
    expect(result.poolUnavailable?.[0]?.reason).toBe('insufficientData');
    expect(result.insufficientData.some((i) => i.championId === 3)).toBe(true);
  });

  it('unknown pool champion (not in championIds) goes to poolUnavailable with unknownChampion', () => {
    const champions: ChampionId[] = [1, 2];
    const data = makeData({ champions });

    const input = makeInput({ pool: [999] });
    const result = recommend(input, data);

    expect(result.poolUnavailable).toBeDefined();
    expect(result.poolUnavailable).toHaveLength(1);
    expect(result.poolUnavailable?.[0]?.championId).toBe(999);
    expect(result.poolUnavailable?.[0]?.reason).toBe('unknownChampion');
  });

  it('off-role pool champion (below role prob threshold) gets offRole warning', () => {
    const champions: ChampionId[] = [1, 2, 3];
    const roleProb: ChampionRoleProbabilities = {
      '1': { SUPPORT: 1.0 },
      '2': { SUPPORT: 1.0 },
      '3': { TOP: 1.0 },
    } as ChampionRoleProbabilities;
    const data = makeData({ champions, roleProb });

    const input = makeInput({ pool: [3] });
    const result = recommend(input, data);

    const rec3 = result.recommendations.find((r) => r.championId === 3);
    expect(rec3).toBeDefined();
    expect(rec3?.warnings).toContain('offRole');
  });

  it('always shows best overall list even with empty pool', () => {
    const champions: ChampionId[] = [1, 2, 3];
    const data = makeData({ champions });
    const input = makeInput({ pool: [] });

    const result = recommend(input, data);
    expect(result.recommendations.length).toBe(3);
    expect(result.poolRecommendations).toBeUndefined();
  });

  it('relative order of roleProb-set is preserved when pool inserts extra candidates', () => {
    const champions: ChampionId[] = [1, 2, 3, 99];
    const roleProb: ChampionRoleProbabilities = {
      '1': { SUPPORT: 1.0 },
      '2': { SUPPORT: 1.0 },
      '3': { SUPPORT: 1.0 },
      '99': { TOP: 1.0 },
    } as ChampionRoleProbabilities;
    const data = makeData({ champions, roleProb });

    const inputNoPool = makeInput();
    const inputWithPool = makeInput({ pool: [99] });

    const resultNoPool = recommend(inputNoPool, data);
    const resultWithPool = recommend(inputWithPool, data);

    const withoutPool = resultNoPool.recommendations.map((r) => r.championId);
    const withPool = resultWithPool.recommendations.map((r) => r.championId);

    const filtered = withPool.filter((id) => id !== 99);
    expect(filtered).toEqual(withoutPool);
  });
});

describe('recommend: reasons', () => {
  it('reasons reference only known slots', () => {
    const champions: ChampionId[] = [1, 100, 200];
    const allyPairs = makeAllyPairs([
      { championId: 1, allyId: 100, role: 'ADC', ...HIGH_GAMES, winsW: 40 },
    ]);
    const enemyPairs = makeEnemyPairs([
      { championId: 1, enemyId: 200, role: 'SUPPORT', ...HIGH_GAMES, winsW: 10 },
    ]);
    const roleProb: ChampionRoleProbabilities = {
      '1': { SUPPORT: 1.0 },
      '100': { ADC: 1.0 },
      '200': { SUPPORT: 1.0 },
    } as ChampionRoleProbabilities;
    const data = makeData({
      champions,
      allyPairs,
      enemyPairs,
      roleProb,
      tags: makeChampionTags([1, 100, 200]),
    });
    const input = makeInput({
      allies: [{ championId: 100, role: 'ADC' }],
      enemies: [{ championId: 200, role: 'SUPPORT' }],
    });
    const result = recommend(input, data);

    for (const rec of result.recommendations) {
      for (const reason of rec.reasons) {
        if (reason.with) {
          for (const withId of reason.with) {
            expect([100, 200]).toContain(withId);
          }
        }
      }
    }
  });

  it('lowData flags are set correctly for low n_eff terms', () => {
    const champions: ChampionId[] = [1, 2, 100];
    const allyPairs = makeAllyPairs([
      { championId: 1, allyId: 100, role: 'ADC', winsW: 8, gamesW: 10, gamesW2: 10 }, // n_eff = 10
      { championId: 2, allyId: 100, role: 'ADC', ...HIGH_GAMES, winsW: 40 }, // n_eff = 25000
    ]);
    const roleProb: ChampionRoleProbabilities = {
      '1': { SUPPORT: 1.0 },
      '2': { SUPPORT: 1.0 },
      '100': { ADC: 1.0 },
    } as ChampionRoleProbabilities;
    const data = makeData({
      champions,
      allyPairs,
      roleProb,
      tags: makeChampionTags([1, 2, 100]),
    });
    const input = makeInput({
      allies: [{ championId: 100, role: 'ADC' }],
    });
    const result = recommend(input, data);

    const rec1 = result.recommendations.find((r) => r.championId === 1);
    const rec2 = result.recommendations.find((r) => r.championId === 2);

    const rec1Synergy = rec1?.reasons.find((r) => r.type === 'synergy');
    const rec2Synergy = rec2?.reasons.find((r) => r.type === 'synergy');

    expect(rec1Synergy).toBeDefined();
    expect(rec2Synergy).toBeDefined();
    expect(rec1Synergy?.lowData).toBe(true);
    expect(rec2Synergy?.lowData).toBe(false);
  });

  it('reasons are ordered: pairs by descending influence, then lane_vs, lane_full, comp, blind', () => {
    const champions: ChampionId[] = [1, 10, 100, 201];
    const roleProb: ChampionRoleProbabilities = {
      '1': { SUPPORT: 1.0 },
      '10': { ADC: 1.0 },
      '100': { SUPPORT: 1.0 },
      '201': { ADC: 1.0 },
    } as ChampionRoleProbabilities;

    // Ally ADC (influence 1.0)
    const allyPairs = makeAllyPairs([
      { championId: 1, allyId: 10, role: 'ADC', ...HIGH_GAMES, winsW: 45 },
    ]);
    // Enemy Support (influence 1.0) and Enemy ADC (influence 0.9)
    const enemyPairs = makeEnemyPairs([
      { championId: 1, enemyId: 100, role: 'SUPPORT', ...HIGH_GAMES, winsW: 15 },
      { championId: 1, enemyId: 201, role: 'ADC', ...HIGH_GAMES, winsW: 15 },
    ]);
    const laneVs = makeLaneVs([
      { championId: 1, opp1Id: 100, opp2Id: 201, ...HIGH_GAMES, winsW: 40 },
    ]);

    const tags: ChampionTagsMap = {
      '1': {
        championId: 1,
        damageType: 'AP',
        archetype: 'mage',
        hardEngage: true,
        peel: false,
        poke: true,
        waveclear: false,
        scaling: { early: false, mid: true, late: true },
        range: 'RANGED',
        ccCount: 2,
      },
      '10': {
        championId: 10,
        damageType: 'AD',
        archetype: 'marksman',
        hardEngage: false,
        peel: false,
        poke: true,
        waveclear: true,
        scaling: { early: false, mid: true, late: true },
        range: 'RANGED',
        ccCount: 0,
      },
      '100': {
        championId: 100,
        damageType: 'AP',
        archetype: 'enchanter',
        hardEngage: false,
        peel: true,
        poke: true,
        waveclear: false,
        scaling: { early: false, mid: true, late: true },
        range: 'RANGED',
        ccCount: 1,
      },
      '201': {
        championId: 201,
        damageType: 'AD',
        archetype: 'marksman',
        hardEngage: false,
        peel: false,
        poke: true,
        waveclear: true,
        scaling: { early: false, mid: true, late: true },
        range: 'RANGED',
        ccCount: 0,
      },
    };

    const data = makeData({
      champions,
      allyPairs,
      enemyPairs,
      laneVs,
      roleProb,
      tags,
    });
    const input = makeInput({
      allies: [{ championId: 10, role: 'ADC' }],
      enemies: [
        { championId: 100, role: 'SUPPORT' },
        { championId: 201, role: 'ADC' },
      ],
    });
    const result = recommend(input, data);

    const rec = result.recommendations[0];
    expect(rec).toBeDefined();
    if (!rec) return;

    const reasonTypes = rec.reasons.map((r) => r.type);
    expect(reasonTypes).toEqual(['synergy', 'counter', 'counter', 'lane', 'comp']);

    // Check with field for pairs: ally 10 (influence 1.0, id 10), then enemy 100 (influence 1.0, id 100), then enemy 201 (influence 0.9)
    const synergyReason = rec.reasons[0];
    const counterReason1 = rec.reasons[1];
    const counterReason2 = rec.reasons[2];
    expect(synergyReason?.with).toEqual([10]);
    expect(counterReason1?.with).toEqual([100]);
    expect(counterReason2?.with).toEqual([201]);
  });
});

describe('recommend: review regressions', () => {
  it('TOP with known enemy and blindPick=false emits no blind reason', () => {
    const roleProb = {
      '1': { TOP: 1.0 },
      '2': { TOP: 1.0 },
      '300': { TOP: 1.0 },
    } as ChampionRoleProbabilities;
    const enemyPairs = makeEnemyPairs([
      { championId: 1, enemyId: 300, role: 'TOP', ...HIGH_GAMES, winsW: 10 },
    ]);
    const data = makeData({ champions: [1, 2, 300], roleProb, enemyPairs });
    const input = makeInput({ userRole: 'TOP', enemies: [{ championId: 300, role: 'TOP' }] });
    const result = recommend(input, data);
    for (const rec of result.recommendations) {
      expect(rec.reasons.some((r) => r.type === 'blind')).toBe(false);
    }
  });

  it('blind safety does not re-score a known enemy', () => {
    const roleProb = {
      '1': { SUPPORT: 1.0 },
      '200': { SUPPORT: 1.0 },
    } as ChampionRoleProbabilities;
    const enemyPairs = makeEnemyPairs([
      { championId: 1, enemyId: 200, role: 'SUPPORT', ...HIGH_GAMES, winsW: 10 },
    ]);
    const data = makeData({ champions: [1, 200], roleProb, enemyPairs });
    const input = makeInput({ enemies: [{ championId: 200, role: 'SUPPORT' }] });
    const rec = recommend(input, data).recommendations[0];
    expect(rec?.reasons.some((r) => r.type === 'blind')).toBe(false);
  });

  it('blind safety ranks by unseen likely opponents', () => {
    const roleProb = {
      '1': { SUPPORT: 1.0 },
      '2': { SUPPORT: 1.0 },
      '201': { ADC: 1.0 },
    } as ChampionRoleProbabilities;
    const enemyPairs = makeEnemyPairs([
      { championId: 1, enemyId: 201, role: 'ADC', ...HIGH_GAMES, winsW: 10 },
      { championId: 2, enemyId: 201, role: 'ADC', ...HIGH_GAMES, winsW: 40 },
    ]);
    const data = makeData({ champions: [1, 2, 201], roleProb, enemyPairs });
    const result = recommend(makeInput({ blindPick: true }), data);
    expect(result.recommendations.map((r) => r.championId)).toEqual([2, 1]);
    expect(result.recommendations[0]?.reasons.some((r) => r.type === 'blind')).toBe(true);
  });

  it('unknown pool id with a baseline row is never scored', () => {
    const data = makeData({ champions: [1, 2], baselines: makeBaselines([1, 2, 999]) });
    const result = recommend(makeInput({ pool: [999] }), data);
    expect(result.recommendations.some((r) => r.championId === 999)).toBe(false);
    expect(result.poolUnavailable?.[0]?.reason).toBe('unknownChampion');
  });

  it('keeps fixed-role allies when a teammate has no roleProb', () => {
    const roleProb = {
      '1': { SUPPORT: 1.0 },
      '2': { SUPPORT: 1.0 },
      '10': { ADC: 1.0, SUPPORT: 1.0 },
    } as ChampionRoleProbabilities;
    const allyPairs = makeAllyPairs([
      { championId: 2, allyId: 10, role: 'ADC', ...HIGH_GAMES, winsW: 45 },
    ]);
    const data = makeData({ champions: [1, 2, 10, 77], roleProb, allyPairs });
    const input = makeInput({ allies: [{ championId: 10, role: 'ADC' }, { championId: 77 }] });
    const result = recommend(input, data);
    const ids = result.recommendations.map((r) => r.championId);
    expect(ids).not.toContain(10);
    expect(ids).not.toContain(77);
    expect(ids[0]).toBe(2);
  });
});

describe('recommend: determinism', () => {
  it('same input produces identical output', () => {
    const champions: ChampionId[] = [1, 2, 3];
    const data = makeData({ champions });
    const input = makeInput({
      allies: [{ championId: 2, role: 'ADC' }],
      enemies: [{ championId: 3, role: 'SUPPORT' }],
      pool: [1],
    });

    const result1 = recommend(input, data);
    const result2 = recommend(input, data);

    expect(result1).toEqual(result2);
  });
});

describe('recommend: no crash on edge cases', () => {
  it('empty allies and enemies', () => {
    const champions: ChampionId[] = [1, 2];
    const data = makeData({ champions });
    const input = makeInput();
    const result = recommend(input, data);
    expect(result.recommendations).toHaveLength(2);
  });

  it('blind pick mode', () => {
    const champions: ChampionId[] = [1, 2];
    const data = makeData({ champions });
    const input = makeInput({ blindPick: true });
    const result = recommend(input, data);
    expect(result.recommendations).toHaveLength(2);
  });

  it('no baselines at all', () => {
    const champions: ChampionId[] = [1, 2];
    const data = makeData({ champions, baselines: [] });
    const input = makeInput();
    const result = recommend(input, data);
    expect(result.recommendations).toHaveLength(0);
    expect(result.insufficientData).toHaveLength(2);
  });

  it('no crash with empty champion list', () => {
    const data = makeData({ champions: [] });
    const input = makeInput();
    const result = recommend(input, data);
    expect(result.recommendations).toHaveLength(0);
  });
});

describe('recommend: rawGames', () => {
  it('reports the exported raw match count, not the weighted sum', () => {
    // 20 half-weight games: games_w = 10, games_w2 = 5, n_eff = 20 < 25.
    const baselines: BaselineTable = [
      [1, 'DIAMOND', 5, 10, 5, 20],
      [2, 'DIAMOND', 30, 50, 0.1, 50],
    ];
    const data = makeData({ champions: [1, 2], baselines });
    const result = recommend(makeInput(), data);
    const entry = result.insufficientData.find((i) => i.championId === 1);
    expect(entry?.rawGames).toBe(20);
  });
});

describe('recommend: role-conflict regressions', () => {
  it('keeps a resolvable teammate when another unfixed pick conflicts with a fixed role', () => {
    const champions: ChampionId[] = [1, 2, 201, 202, 300];
    const roleProb: ChampionRoleProbabilities = {
      '1': { SUPPORT: 1.0 },
      '2': { SUPPORT: 1.0 },
      '201': { ADC: 1.0 },
      '202': { ADC: 1.0 },
      // Mostly TOP, but above the SUPPORT candidate threshold: it would be
      // recommended if its known enemy slot were dropped.
      '300': { TOP: 0.9, SUPPORT: 0.1 },
    } as ChampionRoleProbabilities;
    const data = makeData({ champions, roleProb });
    const input = makeInput({
      enemies: [{ championId: 201, role: 'ADC' }, { championId: 202 }, { championId: 300 }],
    });

    const result = recommend(input, data);
    const ids = result.recommendations.map((r) => r.championId);
    expect(ids).not.toContain(300);
    expect(ids).toEqual(expect.arrayContaining([1, 2]));
  });

  it('does not treat duplicate fixed SUPPORT enemies as a complete bot lane', () => {
    const champions: ChampionId[] = [1, 2, 200, 201];
    const roleProb: ChampionRoleProbabilities = {
      '1': { SUPPORT: 1.0 },
      '2': { SUPPORT: 1.0 },
      '200': { SUPPORT: 1.0 },
      '201': { SUPPORT: 1.0 },
    } as ChampionRoleProbabilities;
    const laneVs = makeLaneVs([
      { championId: 1, opp1Id: 200, opp2Id: 201, ...HIGH_GAMES, winsW: 45 },
      { championId: 1, opp1Id: 201, opp2Id: 200, ...HIGH_GAMES, winsW: 45 },
    ]);
    const data = makeData({ champions, roleProb, laneVs });
    const input = makeInput({
      enemies: [
        { championId: 200, role: 'SUPPORT' },
        { championId: 201, role: 'SUPPORT' },
      ],
    });

    const result = recommend(input, data);
    const rec1 = result.recommendations.find((r) => r.championId === 1);
    expect(rec1).toBeDefined();
    expect(rec1?.reasons.some((r) => r.type === 'lane')).toBe(false);
  });
});

describe('recommend: remaining review gaps', () => {
  const botRoleProb = {
    '1': { SUPPORT: 1.0 },
    '2': { SUPPORT: 1.0 },
    '10': { ADC: 1.0 },
    '11': { ADC: 1.0 },
    '200': { SUPPORT: 1.0 },
    '201': { ADC: 1.0 },
  } as ChampionRoleProbabilities;

  it('scales lane_full by the ally partner confidence when its role is inferred', () => {
    const laneFull = makeLaneFull([
      { championId: 1, partnerId: 10, opp1Id: 200, opp2Id: 201, ...HIGH_GAMES, winsW: 45 },
    ]);
    const roleProb = {
      ...botRoleProb,
      '10': { ADC: 0.6, MID: 0.4 },
    } as ChampionRoleProbabilities;
    const data = makeData({ champions: [1, 10, 200, 201], roleProb, laneFull });
    const enemies = [
      { championId: 200, role: 'SUPPORT' as Role },
      { championId: 201, role: 'ADC' as Role },
    ];
    const laneFullDelta = (fixed: boolean): number => {
      const ally = fixed ? { championId: 10, role: 'ADC' as Role } : { championId: 10 };
      const rec = recommend(makeInput({ allies: [ally], enemies }), data).recommendations.find(
        (r) => r.championId === 1,
      );
      const lane = rec?.reasons.find((r) => r.type === 'lane' && r.with?.length === 3);
      return Math.abs(lane?.deltaPp ?? 0);
    };
    expect(laneFullDelta(false)).toBeGreaterThan(0);
    expect(laneFullDelta(false)).toBeLessThan(laneFullDelta(true));
  });

  it.each<Role>(['ADC', 'MID', 'JUNGLE'])(
    'applies blind safety for %s when the lane enemy is unknown and blindPick is false',
    (role) => {
      const roleProb = {
        '11': { [role]: 1.0 },
        '12': { [role]: 1.0 },
        '201': { [role]: 1.0 },
      } as ChampionRoleProbabilities;
      const enemyPairs = makeEnemyPairs([
        { championId: 11, enemyId: 201, role, ...HIGH_GAMES, winsW: 10 },
      ]);
      // 201 has no baseline, so it is never scored itself (only a likely opponent).
      const data = makeData({
        champions: [11, 12, 201],
        baselines: makeBaselines([11, 12]),
        roleProb,
        enemyPairs,
      });
      const result = recommend(makeInput({ userRole: role, blindPick: false }), data);
      const rec11 = result.recommendations.find((r) => r.championId === 11);
      expect(rec11?.reasons.some((r) => r.type === 'blind')).toBe(true);
      expect(result.recommendations.map((r) => r.championId)).toEqual([12, 11]);
    },
  );

  it('maps a MASTER+ userRank to the MASTER_PLUS bucket', () => {
    const baselines: BaselineTable = [
      [1, 'DIAMOND', 30, 50, 0.1, 50],
      [2, 'MASTER_PLUS', 30, 50, 0.1, 50],
    ];
    const data = makeData({ champions: [1, 2], baselines, roleProb: botRoleProb });
    const result = recommend(makeInput({ userRank: 'GRANDMASTER' }), data);
    expect(result.recommendations.map((r) => r.championId)).toEqual([2]);
    expect(result.insufficientData.map((i) => i.championId)).toEqual([1]);
  });

  it('passes a custom compConfig through recommend', () => {
    const tags = makeChampionTags([1, 2]);
    const noEngageAlly: ChampionTags = {
      championId: 77,
      damageType: 'AD',
      archetype: 'marksman',
      hardEngage: false,
      peel: false,
      poke: false,
      waveclear: false,
      scaling: { early: false, mid: true, late: true },
      range: 'RANGED',
      ccCount: 0,
    };
    const data = makeData({
      champions: [1, 77],
      roleProb: { ...botRoleProb, '77': { ADC: 1.0 } } as ChampionRoleProbabilities,
      tags: { ...tags, '77': noEngageAlly },
    });
    const input = makeInput({ allies: [{ championId: 77, role: 'ADC' }] });
    const score = (engage: number): number =>
      recommend(input, data, DEFAULT_CONFIG, { ...DEFAULT_COMP_CONFIG, engage }).recommendations[0]
        ?.score ?? 0;
    expect(score(0.5)).toBeGreaterThan(score(0.1));
  });

  it('a candidate without a baseline row reports nEff 0 and no rawGames', () => {
    const data = makeData({
      champions: [1, 2],
      baselines: makeBaselines([1]),
      roleProb: botRoleProb,
    });
    const entry = recommend(makeInput(), data).insufficientData.find((i) => i.championId === 2);
    expect(entry).toEqual({ championId: 2, nEff: 0 });
  });

  it('reports picked, unknownChampion and insufficientData together in poolUnavailable', () => {
    const baselines: BaselineTable = [
      [1, 'DIAMOND', 30, 50, 0.1, 50],
      [2, 'DIAMOND', 5, 10, 10, 10],
      [200, 'DIAMOND', 30, 50, 0.1, 50],
    ];
    const data = makeData({ champions: [1, 2, 200], baselines, roleProb: botRoleProb });
    const input = makeInput({
      enemies: [{ championId: 200, role: 'SUPPORT' }],
      pool: [1, 2, 200, 999],
    });
    const result = recommend(input, data);
    const unavailable = [...(result.poolUnavailable ?? [])].sort(
      (a, b) => a.championId - b.championId,
    );
    expect(unavailable).toEqual([
      { championId: 2, reason: 'insufficientData' },
      { championId: 200, reason: 'picked' },
      { championId: 999, reason: 'unknownChampion' },
    ]);
    expect(result.poolRecommendations?.map((r) => r.championId)).toEqual([1]);
  });
});

describe('recommend: ambiguous fixed roles (D-030)', () => {
  it('duplicate fixed SUPPORT plus a fixed ADC never scores a wrong lane pair', () => {
    const roleProb = {
      '1': { SUPPORT: 1.0 },
      '200': { SUPPORT: 1.0 },
      '201': { SUPPORT: 1.0 },
      '202': { ADC: 1.0 },
    } as ChampionRoleProbabilities;
    const laneVs = makeLaneVs([
      { championId: 1, opp1Id: 200, opp2Id: 201, ...HIGH_GAMES, winsW: 45 },
      { championId: 1, opp1Id: 201, opp2Id: 200, ...HIGH_GAMES, winsW: 45 },
    ]);
    const data = makeData({ champions: [1, 200, 201, 202], roleProb, laneVs });
    const input = makeInput({
      enemies: [
        { championId: 200, role: 'SUPPORT' },
        { championId: 201, role: 'SUPPORT' },
        { championId: 202, role: 'ADC' },
      ],
    });
    const rec = recommend(input, data).recommendations.find((r) => r.championId === 1);
    expect(rec?.reasons.some((r) => r.type === 'lane')).toBe(false);
  });
});

describe('recommend: review coverage', () => {
  const botRoleProb = {
    '1': { SUPPORT: 1.0 },
    '2': { SUPPORT: 1.0 },
    '10': { ADC: 1.0 },
    '200': { SUPPORT: 1.0 },
    '201': { ADC: 1.0 },
  } as ChampionRoleProbabilities;

  it('applies lane_full for a complete bot lane after lane_vs', () => {
    const laneVs = makeLaneVs([
      { championId: 1, opp1Id: 200, opp2Id: 201, ...HIGH_GAMES, winsW: 35 },
    ]);
    const laneFull = makeLaneFull([
      { championId: 1, partnerId: 10, opp1Id: 200, opp2Id: 201, ...HIGH_GAMES, winsW: 45 },
    ]);
    const data = makeData({
      champions: [1, 2, 10, 200, 201],
      roleProb: botRoleProb,
      laneVs,
      laneFull,
    });
    const input = makeInput({
      allies: [{ championId: 10, role: 'ADC' }],
      enemies: [
        { championId: 200, role: 'SUPPORT' },
        { championId: 201, role: 'ADC' },
      ],
    });
    const rec = recommend(input, data).recommendations.find((r) => r.championId === 1);
    const lanes = rec?.reasons.filter((r) => r.type === 'lane') ?? [];
    expect(lanes).toHaveLength(2);
    expect(lanes[0]?.with).toEqual([200, 201]);
    expect(lanes[1]?.with).toEqual([10, 200, 201]);
  });

  it('scales lane_vs by conf_lane when an enemy role is inferred', () => {
    const laneVs = makeLaneVs([
      { championId: 1, opp1Id: 200, opp2Id: 201, ...HIGH_GAMES, winsW: 45 },
    ]);
    const roleProb = {
      ...botRoleProb,
      '200': { SUPPORT: 0.6, MID: 0.4 },
    } as ChampionRoleProbabilities;
    const data = makeData({ champions: [1, 2, 10, 200, 201], roleProb, laneVs });
    const laneDelta = (fixed: boolean): number => {
      const input = makeInput({
        enemies: [
          fixed ? { championId: 200, role: 'SUPPORT' } : { championId: 200 },
          { championId: 201, role: 'ADC' },
        ],
      });
      const rec = recommend(input, data).recommendations.find((r) => r.championId === 1);
      return Math.abs(rec?.reasons.find((r) => r.type === 'lane')?.deltaPp ?? 0);
    };
    const fixedDelta = laneDelta(true);
    const inferredDelta = laneDelta(false);
    expect(fixedDelta).toBeGreaterThan(0);
    expect(inferredDelta).toBeGreaterThan(0);
    expect(inferredDelta).toBeLessThan(fixedDelta);
  });

  it('warns when a known enemy hard-counters the candidate', () => {
    const enemyPairs = makeEnemyPairs([
      { championId: 1, enemyId: 200, role: 'SUPPORT', ...HIGH_GAMES, winsW: 10 },
      { championId: 2, enemyId: 200, role: 'SUPPORT', ...HIGH_GAMES, winsW: 30 },
    ]);
    const data = makeData({ champions: [1, 2, 200], roleProb: botRoleProb, enemyPairs });
    const input = makeInput({ enemies: [{ championId: 200, role: 'SUPPORT' }] });
    const result = recommend(input, data);
    const rec1 = result.recommendations.find((r) => r.championId === 1);
    const rec2 = result.recommendations.find((r) => r.championId === 2);
    expect(rec1?.warnings).toContain('counteredBy:SUPPORT:200');
    expect(rec2?.warnings.some((w) => w.startsWith('counteredBy:'))).toBe(false);
  });

  it('gives blind reasons a level', () => {
    const enemyPairs = makeEnemyPairs([
      { championId: 1, enemyId: 201, role: 'ADC', ...HIGH_GAMES, winsW: 10 },
    ]);
    const data = makeData({ champions: [1, 201], roleProb: botRoleProb, enemyPairs });
    const rec = recommend(makeInput({ blindPick: true }), data).recommendations[0];
    const blind = rec?.reasons.find((r) => r.type === 'blind');
    expect(blind).toBeDefined();
    expect(blind?.level).toBeLessThan(0);
  });

  it('emits no comp reason when no ally is known', () => {
    const data = makeData({ champions: [1, 2] });
    for (const rec of recommend(makeInput(), data).recommendations) {
      expect(rec.reasons.some((r) => r.type === 'comp')).toBe(false);
    }
  });

  it('applies a 1v1 lane_vs for MID without blind safety', () => {
    const roleProb = {
      '1': { MID: 1.0 },
      '2': { MID: 1.0 },
      '300': { MID: 1.0 },
    } as ChampionRoleProbabilities;
    const laneVs = makeLaneVs([
      { championId: 1, opp1Id: 300, opp2Id: null, ...HIGH_GAMES, winsW: 45 },
    ]);
    const data = makeData({ champions: [1, 2, 300], roleProb, laneVs });
    const input = makeInput({ userRole: 'MID', enemies: [{ championId: 300, role: 'MID' }] });
    const result = recommend(input, data);
    expect(result.recommendations[0]?.championId).toBe(1);
    const rec1 = result.recommendations[0];
    expect(rec1?.reasons.filter((r) => r.type === 'lane')).toHaveLength(1);
    expect(rec1?.reasons.some((r) => r.type === 'blind')).toBe(false);
  });

  it('pool champion already picked on the board is not scored and is reported as picked', () => {
    const data = makeData({ champions: [1, 2, 200], roleProb: botRoleProb });
    const input = makeInput({ enemies: [{ championId: 200, role: 'SUPPORT' }], pool: [200] });
    const result = recommend(input, data);
    expect(result.recommendations.some((r) => r.championId === 200)).toBe(false);
    expect(result.poolRecommendations).toEqual([]);
    expect(result.poolUnavailable).toEqual([{ championId: 200, reason: 'picked' }]);
  });

  it('a lowData reason has level 0', () => {
    const allyPairs = makeAllyPairs([
      { championId: 1, allyId: 10, role: 'ADC', winsW: 10, gamesW: 10, gamesW2: 10 },
    ]);
    const data = makeData({ champions: [1, 10], roleProb: botRoleProb, allyPairs });
    const input = makeInput({ allies: [{ championId: 10, role: 'ADC' }] });
    const rec = recommend(input, data).recommendations.find((r) => r.championId === 1);
    const synergy = rec?.reasons.find((r) => r.type === 'synergy');
    expect(synergy?.lowData).toBe(true);
    expect(synergy?.level).toBe(0);
  });

  it('pool never changes scores with enemies and an off-role pool champion', () => {
    const roleProb = { ...botRoleProb, '99': { TOP: 1.0 } } as ChampionRoleProbabilities;
    const enemyPairs = makeEnemyPairs([
      { championId: 1, enemyId: 200, role: 'SUPPORT', ...HIGH_GAMES, winsW: 20 },
      { championId: 99, enemyId: 200, role: 'SUPPORT', ...HIGH_GAMES, winsW: 40 },
    ]);
    const data = makeData({ champions: [1, 2, 99, 200], roleProb, enemyPairs });
    const enemies = [{ championId: 200, role: 'SUPPORT' as Role }];
    const base = recommend(makeInput({ enemies }), data).recommendations;
    const pooled = recommend(makeInput({ enemies, pool: [99, 1] }), data).recommendations;
    for (const rec of base) {
      const other = pooled.find((r) => r.championId === rec.championId);
      expect(other?.score).toBeCloseTo(rec.score, 12);
      expect(other?.reasons).toEqual(rec.reasons);
    }
    expect(pooled.find((r) => r.championId === 99)?.warnings).toContain('offRole');
  });
});

describe('recommend: second review fixes', () => {
  const botRoleProb = {
    '1': { SUPPORT: 1.0 },
    '2': { SUPPORT: 1.0 },
    '201': { ADC: 1.0 },
    '202': { ADC: 1.0 },
  } as ChampionRoleProbabilities;

  it('caps positive blind levels at L1 even when highLevelMinGames equals minGames', () => {
    const enemyPairs = makeEnemyPairs([
      { championId: 1, enemyId: 201, role: 'ADC', ...HIGH_GAMES, winsW: 48 },
    ]);
    const data = makeData({ champions: [1, 201], roleProb: botRoleProb, enemyPairs });
    const config = { ...DEFAULT_CONFIG, highLevelMinGames: DEFAULT_CONFIG.minGames };
    const rec = recommend(makeInput({ blindPick: true }), data, config).recommendations[0];
    const blind = rec?.reasons.find((r) => r.type === 'blind');
    expect(blind).toBeDefined();
    expect(blind?.level).toBe(1);
  });

  it('keeps negative blind levels when minGames is 0', () => {
    const enemyPairs = makeEnemyPairs([
      { championId: 1, enemyId: 201, role: 'ADC', ...HIGH_GAMES, winsW: 5 },
    ]);
    const data = makeData({ champions: [1, 201], roleProb: botRoleProb, enemyPairs });
    const config = { ...DEFAULT_CONFIG, minGames: 0 };
    const rec = recommend(makeInput({ blindPick: true }), data, config).recommendations[0];
    expect(rec?.reasons.find((r) => r.type === 'blind')?.level).toBeLessThan(0);
  });

  it('missing blind matchups are neutral, not ignored', () => {
    // Candidate 1 has a known bad matchup vs 201 and no data vs 202; the
    // missing matchup must dilute the expected term rather than be skipped.
    const enemyPairs = makeEnemyPairs([
      { championId: 1, enemyId: 201, role: 'ADC', ...HIGH_GAMES, winsW: 10 },
    ]);
    const full = makeData({ champions: [1, 201], roleProb: botRoleProb, enemyPairs });
    const diluted = makeData({ champions: [1, 201, 202], roleProb: botRoleProb, enemyPairs });
    const blind = (d: RecommendData): number =>
      recommend(makeInput({ blindPick: true }), d).recommendations[0]?.reasons.find(
        (r) => r.type === 'blind',
      )?.deltaPp ?? 0;
    expect(blind(diluted)).toBeGreaterThan(blind(full));
  });

  it('deduplicates poolUnavailable entries', () => {
    const data = makeData({ champions: [1, 2] });
    const result = recommend(makeInput({ pool: [999, 999] }), data);
    expect(result.poolUnavailable).toHaveLength(1);
  });

  it('comp uses allies whose role could not be inferred', () => {
    const base = makeChampionTags([1, 2]);
    const tags: ChampionTagsMap = {
      ...base,
      '77': {
        championId: 77,
        damageType: 'AD',
        archetype: 'marksman',
        hardEngage: false,
        peel: false,
        poke: false,
        waveclear: false,
        scaling: { early: false, mid: true, late: true },
        range: 'RANGED',
        ccCount: 0,
      },
    };
    const data = makeData({ champions: [1, 2, 77], roleProb: botRoleProb, tags });
    // 77 has no roleProb, so role inference drops it; its missing engage/peel
    // must still create a comp need for candidates that provide them.
    const result = recommend(makeInput({ allies: [{ championId: 77 }] }), data);
    for (const rec of result.recommendations) {
      expect(rec.reasons.some((r) => r.type === 'comp')).toBe(true);
    }
  });

  it('ignores rows from other rank buckets', () => {
    const baselines: BaselineTable = [
      [1, 'DIAMOND', 30, 50, 0.1, 50],
      [2, 'MASTER_PLUS', 45, 50, 0.1, 50],
    ];
    const data = makeData({ champions: [1, 2], baselines });
    const result = recommend(makeInput(), data);
    expect(result.recommendations.map((r) => r.championId)).toEqual([1]);
    expect(result.insufficientData.map((i) => i.championId)).toEqual([2]);
  });

  it('pool-only candidates keep the rank order of the roleProb set', () => {
    const roleProb = { ...botRoleProb, '99': { TOP: 1.0 } } as ChampionRoleProbabilities;
    const data = makeData({ champions: [1, 2, 99], roleProb });
    const base = recommend(makeInput(), data).recommendations;
    const pooled = recommend(makeInput({ pool: [99] }), data).recommendations;
    const order = (recs: typeof base): number[] =>
      recs.filter((r) => r.championId !== 99).map((r) => r.championId);
    expect(order(pooled)).toEqual(order(base));
  });
});

describe('recommend: review gap coverage', () => {
  const botRoleProb = {
    '1': { SUPPORT: 1.0 },
    '2': { SUPPORT: 1.0 },
    '10': { ADC: 1.0 },
    '11': { ADC: 1.0 },
    '20': { SUPPORT: 1.0 },
    '200': { SUPPORT: 1.0 },
    '201': { ADC: 1.0 },
  } as ChampionRoleProbabilities;

  it('an unresolved, untagged ally creates no comp reason', () => {
    const data = makeData({ champions: [1, 2, 77], roleProb: botRoleProb });
    const result = recommend(makeInput({ allies: [{ championId: 77 }] }), data);
    for (const rec of result.recommendations) {
      expect(rec.reasons.some((r) => r.type === 'comp')).toBe(false);
    }
  });

  it('a lowData pair term adds exactly 0 to the score', () => {
    const lowPair = makeAllyPairs([
      { championId: 1, allyId: 10, role: 'ADC', winsW: 10, gamesW: 10, gamesW2: 10 },
    ]);
    const input = makeInput({ allies: [{ championId: 10, role: 'ADC' }] });
    const champions: ChampionId[] = [1, 10];
    const tags = makeChampionTags(champions);
    const withRow = recommend(
      input,
      makeData({ champions, roleProb: botRoleProb, tags, allyPairs: lowPair }),
    );
    const without = recommend(input, makeData({ champions, roleProb: botRoleProb, tags }));
    const a = withRow.recommendations.find((r) => r.championId === 1);
    const b = without.recommendations.find((r) => r.championId === 1);
    expect(a?.score).toBe(b?.score);
    const synergy = a?.reasons.find((r) => r.type === 'synergy');
    expect(synergy?.lowData).toBe(true);
    expect(synergy?.deltaPp).toBe(0);
  });

  it('applies lane_full for ADC with the ally SUPPORT as partner', () => {
    const laneVs = makeLaneVs([
      { championId: 11, opp1Id: 201, opp2Id: 200, ...HIGH_GAMES, winsW: 30 },
    ]);
    const laneFull = makeLaneFull([
      { championId: 11, partnerId: 20, opp1Id: 201, opp2Id: 200, ...HIGH_GAMES, winsW: 45 },
    ]);
    const data = makeData({
      champions: [11, 20, 200, 201],
      roleProb: botRoleProb,
      laneVs,
      laneFull,
    });
    const input = makeInput({
      userRole: 'ADC',
      allies: [{ championId: 20, role: 'SUPPORT' }],
      enemies: [
        { championId: 200, role: 'SUPPORT' },
        { championId: 201, role: 'ADC' },
      ],
    });
    const rec = recommend(input, data).recommendations.find((r) => r.championId === 11);
    const lanes = rec?.reasons.filter((r) => r.type === 'lane') ?? [];
    expect(lanes).toHaveLength(2);
    expect(lanes[1]?.with).toEqual([20, 201, 200]);
  });

  it('applies a 1v1 lane_vs for JUNGLE and skips lane_full', () => {
    const roleProb = {
      '1': { JUNGLE: 1.0 },
      '300': { JUNGLE: 1.0 },
    } as ChampionRoleProbabilities;
    const laneVs = makeLaneVs([
      { championId: 1, opp1Id: 300, opp2Id: null, ...HIGH_GAMES, winsW: 45 },
    ]);
    const data = makeData({ champions: [1, 300], roleProb, laneVs });
    const enemies = [{ championId: 300, role: 'JUNGLE' as Role }];
    const input = makeInput({ userRole: 'JUNGLE', enemies });
    const rec = recommend(input, data).recommendations[0];
    expect(rec?.reasons.filter((r) => r.type === 'lane')).toHaveLength(1);
  });

  it('falls back to L1 for a large positive pair delta below highLevelMinGames', () => {
    // n_eff = 50^2 / 50 = 50: above minGames (25), below highLevelMinGames (100).
    const allyPairs = makeAllyPairs([
      { championId: 1, allyId: 10, role: 'ADC', winsW: 45, gamesW: 50, gamesW2: 50 },
    ]);
    const data = makeData({ champions: [1, 10], roleProb: botRoleProb, allyPairs });
    const input = makeInput({ allies: [{ championId: 10, role: 'ADC' }] });
    const rec = recommend(input, data).recommendations[0];
    const synergy = rec?.reasons.find((r) => r.type === 'synergy');
    expect(synergy?.deltaPp).toBeGreaterThan(4.5);
    expect(synergy?.level).toBe(1);
  });

  it('a perfect baseline record yields a finite score', () => {
    const baselines: BaselineTable = [[1, 'DIAMOND', 50, 50, 0.1, 50]];
    const data = makeData({ champions: [1], baselines, roleProb: botRoleProb });
    const score = recommend(makeInput(), data).recommendations[0]?.score;
    expect(Number.isFinite(score)).toBe(true);
  });

  it('applies lane_vs alone when the lane_full row is missing', () => {
    const laneVs = makeLaneVs([
      { championId: 1, opp1Id: 200, opp2Id: 201, ...HIGH_GAMES, winsW: 40 },
    ]);
    const data = makeData({ champions: [1, 10, 200, 201], roleProb: botRoleProb, laneVs });
    const input = makeInput({
      allies: [{ championId: 10, role: 'ADC' }],
      enemies: [
        { championId: 200, role: 'SUPPORT' },
        { championId: 201, role: 'ADC' },
      ],
    });
    const rec = recommend(input, data).recommendations.find((r) => r.championId === 1);
    const lanes = rec?.reasons.filter((r) => r.type === 'lane') ?? [];
    expect(lanes).toHaveLength(1);
    expect(lanes[0]?.with).toEqual([200, 201]);
  });

  it('an inferred enemy role weakens the hard-counter warning', () => {
    // p0 ~ 0.60 and the pair win rate ~ 0.53: the full-strength delta is about
    // -7pp (warns), scaled by confidence 0.6 it is about -4.2pp (no warning).
    const enemyPairs = makeEnemyPairs([
      { championId: 1, enemyId: 200, role: 'SUPPORT', ...HIGH_GAMES, winsW: 26.5 },
    ]);
    const roleProb = {
      ...botRoleProb,
      '200': { SUPPORT: 0.6, MID: 0.4 },
    } as ChampionRoleProbabilities;
    const data = makeData({ champions: [1, 200], roleProb, enemyPairs });
    const warnings = (fixed: boolean): string[] => {
      const enemy = fixed ? { championId: 200, role: 'SUPPORT' as Role } : { championId: 200 };
      const input = makeInput({ enemies: [enemy] });
      const rec = recommend(input, data).recommendations.find((r) => r.championId === 1);
      return rec?.warnings ?? [];
    };
    expect(warnings(true)).toContain('counteredBy:SUPPORT:200');
    expect(warnings(false).some((w) => w.startsWith('counteredBy:'))).toBe(false);
  });

  it('a low-influence enemy (TOP for SUPPORT) does not trigger a hard-counter warning', () => {
    // Same moderate matchup (~53% vs p0 ~60%): about -7pp at full influence
    // (enemy SUPPORT, warns), well under the threshold at TOP influence.
    const roleProb = {
      ...botRoleProb,
      '300': { TOP: 1.0 },
      '301': { SUPPORT: 1.0 },
    } as ChampionRoleProbabilities;
    const enemyPairs = makeEnemyPairs([
      { championId: 1, enemyId: 300, role: 'TOP', ...HIGH_GAMES, winsW: 26.5 },
      { championId: 1, enemyId: 301, role: 'SUPPORT', ...HIGH_GAMES, winsW: 26.5 },
    ]);
    const data = makeData({ champions: [1, 300, 301], roleProb, enemyPairs });
    const warnings = (enemy: { championId: ChampionId; role: Role }): string[] =>
      recommend(makeInput({ enemies: [enemy] }), data).recommendations.find(
        (r) => r.championId === 1,
      )?.warnings ?? [];
    expect(warnings({ championId: 301, role: 'SUPPORT' })).toContain('counteredBy:SUPPORT:301');
    expect(
      warnings({ championId: 300, role: 'TOP' }).some((w) => w.startsWith('counteredBy:')),
    ).toBe(false);
  });

  it('a lowData enemy pair never triggers a hard-counter warning', () => {
    const enemyPairs = makeEnemyPairs([
      { championId: 1, enemyId: 200, role: 'SUPPORT', winsW: 0, gamesW: 10, gamesW2: 10 },
    ]);
    const data = makeData({ champions: [1, 200], roleProb: botRoleProb, enemyPairs });
    const input = makeInput({ enemies: [{ championId: 200, role: 'SUPPORT' }] });
    const rec = recommend(input, data).recommendations.find((r) => r.championId === 1);
    expect(rec?.warnings.some((w) => w.startsWith('counteredBy:'))).toBe(false);
  });

  it('pool champion without any roleProb entry is scored with offRole', () => {
    const data = makeData({ champions: [1, 2, 88], roleProb: botRoleProb });
    const result = recommend(makeInput({ pool: [88] }), data);
    const rec = result.recommendations.find((r) => r.championId === 88);
    expect(rec?.warnings).toContain('offRole');
    expect(result.poolRecommendations?.map((r) => r.championId)).toEqual([88]);
  });

  it('pool champion below the gate reports nEff and rawGames in insufficientData', () => {
    const baselines: BaselineTable = [
      [1, 'DIAMOND', 30, 50, 0.1, 50],
      [2, 'DIAMOND', 5, 10, 10, 12],
    ];
    const data = makeData({ champions: [1, 2], roleProb: botRoleProb, baselines });
    const result = recommend(makeInput({ pool: [2] }), data);
    const entry = result.insufficientData.find((i) => i.championId === 2);
    expect(entry?.nEff).toBeCloseTo(10, 5);
    expect(entry?.rawGames).toBe(12);
    expect(result.poolUnavailable).toEqual([{ championId: 2, reason: 'insufficientData' }]);
  });

  it('TOP with a matching lane_full row still emits exactly one lane reason (lane_vs)', () => {
    const roleProb = {
      '1': { TOP: 1.0 },
      '300': { TOP: 1.0 },
      '301': { JUNGLE: 1.0 },
    } as ChampionRoleProbabilities;
    const laneVs = makeLaneVs([
      { championId: 1, opp1Id: 300, opp2Id: null, ...HIGH_GAMES, winsW: 40 },
    ]);
    const laneFull = makeLaneFull([
      { championId: 1, partnerId: null, opp1Id: 300, opp2Id: null, ...HIGH_GAMES, winsW: 5 },
    ]);
    const data = makeData({ champions: [1, 300, 301], roleProb, laneVs, laneFull });
    const input = makeInput({
      userRole: 'TOP',
      allies: [{ championId: 301, role: 'JUNGLE' }],
      enemies: [{ championId: 300, role: 'TOP' }],
    });
    const rec = recommend(input, data).recommendations.find((r) => r.championId === 1);
    const lanes = rec?.reasons.filter((r) => r.type === 'lane') ?? [];
    expect(lanes).toHaveLength(1);
    expect(lanes[0]?.with).toEqual([300]);
  });

  it('reports exact score and synergy deltaPp per SPECS §5', () => {
    const baselines: BaselineTable = [[1, 'DIAMOND', 30, 50, 0.1, 50]];
    const allyPairs = makeAllyPairs([
      { championId: 1, allyId: 10, role: 'ADC', ...HIGH_GAMES, winsW: 40 },
    ]);
    const data = makeData({ champions: [1, 10], roleProb: botRoleProb, baselines, allyPairs });
    const input = makeInput({ allies: [{ championId: 10, role: 'ADC' }] });
    const rec = recommend(input, data).recommendations[0];

    const base = indexBaselines(baselines, 'DIAMOND').get(1);
    const pair = indexPairs(allyPairs, 'DIAMOND').get(makePairKey(1, 10, 'ADC'));
    if (!base || !pair) throw new Error('missing rows');
    const cfg = DEFAULT_CONFIG;
    const p0 = (base.winsE + cfg.k0 * 0.5) / (base.gamesE + cfg.k0);
    const x0 = baselineLogOdds(base.winsE, base.gamesE, cfg.k0, cfg.eps);
    const term = cfg.s * 1 * 1.0 * scorePair(pair.winsE, pair.gamesE, p0, cfg).term;
    const expectedDelta = Math.round(deltaPp(x0, term) * 100) / 100;

    expect(rec?.reasons.map((r) => r.type)).toEqual(['synergy']);
    expect(rec?.reasons[0]?.deltaPp).toBe(expectedDelta);
    expect(rec?.score).toBeCloseTo(1 / (1 + Math.exp(-(x0 + term))), 12);
  });

  it('lane_vs key order follows laneGroup(myRole).enemies (contract for T-017)', () => {
    // SUPPORT expects [enemy SUPPORT, enemy ADC]; a reversed row must not match.
    const reversed = makeLaneVs([
      { championId: 1, opp1Id: 201, opp2Id: 200, ...HIGH_GAMES, winsW: 45 },
    ]);
    const data = makeData({ champions: [1, 200, 201], roleProb: botRoleProb, laneVs: reversed });
    const input = makeInput({
      enemies: [
        { championId: 200, role: 'SUPPORT' },
        { championId: 201, role: 'ADC' },
      ],
    });
    const rec = recommend(input, data).recommendations.find((r) => r.championId === 1);
    expect(rec?.reasons.some((r) => r.type === 'lane')).toBe(false);

    const ordered = makeLaneVs([
      { championId: 1, opp1Id: 200, opp2Id: 201, ...HIGH_GAMES, winsW: 45 },
    ]);
    const data2 = makeData({ champions: [1, 200, 201], roleProb: botRoleProb, laneVs: ordered });
    const rec2 = recommend(input, data2).recommendations.find((r) => r.championId === 1);
    expect(rec2?.reasons.find((r) => r.type === 'lane')?.with).toEqual([200, 201]);
  });

  it('applies the AD/AP damage-mix need with MIXED allies counted on both sides', () => {
    const mk = (id: number, damageType: ChampionTags['damageType']): ChampionTags => ({
      championId: id,
      damageType,
      archetype: 'fighter',
      hardEngage: true,
      peel: true,
      poke: true,
      waveclear: true,
      scaling: { early: false, mid: true, late: true },
      range: 'MELEE',
      ccCount: 1,
    });
    const tags: ChampionTagsMap = {
      '1': mk(1, 'AP'),
      '2': mk(2, 'AD'),
      '10': mk(10, 'AD'),
      '11': mk(11, 'AD'),
      '20': mk(20, 'MIXED'),
    };
    const roleProb = {
      ...botRoleProb,
      '20': { MID: 1.0 },
    } as ChampionRoleProbabilities;
    const data = makeData({ champions: [1, 2, 10, 11, 20], roleProb, tags });
    // AD side: 10, 11, 20 (MIXED) = 3; AP side: 20 = 1 -> AP share 0.25 < 0.5.
    const input = makeInput({
      allies: [
        { championId: 10, role: 'ADC' },
        { championId: 11, role: 'TOP' },
        { championId: 20, role: 'MID' },
      ],
    });
    const result = recommend(input, data);
    const ap = result.recommendations.find((r) => r.championId === 1);
    const ad = result.recommendations.find((r) => r.championId === 2);
    expect(ap?.reasons.some((r) => r.type === 'comp')).toBe(true);
    expect(ad?.reasons.some((r) => r.type === 'comp')).toBe(false);
  });

  it('deduplicates poolRecommendations for a repeated pool id', () => {
    const data = makeData({ champions: [1, 2], roleProb: botRoleProb });
    const result = recommend(makeInput({ pool: [1, 1] }), data);
    expect(result.poolRecommendations?.map((r) => r.championId)).toEqual([1]);
  });
});

describe('recommend: review follow-up edge cases', () => {
  const asRoleProb = (r: Record<string, Partial<Record<Role, number>>>) =>
    r as ChampionRoleProbabilities;
  const fixedBot = [
    { championId: 200, role: 'SUPPORT' as Role },
    { championId: 201, role: 'ADC' as Role },
  ];

  it('ADC lane_vs keys follow [enemy ADC, enemy SUPPORT]', () => {
    const roleProb = asRoleProb({ '11': { ADC: 1 }, '200': { SUPPORT: 1 }, '201': { ADC: 1 } });
    const input = makeInput({ userRole: 'ADC', enemies: fixedBot });
    const lane = (laneVs: LaneVsTable) =>
      recommend(input, makeData({ champions: [11, 200, 201], roleProb, laneVs }))
        .recommendations.find((r) => r.championId === 11)
        ?.reasons.find((r) => r.type === 'lane');
    expect(lane([[11, 200, 201, 'DIAMOND', 45, 50, 0.1]])).toBeUndefined();
    expect(lane([[11, 201, 200, 'DIAMOND', 45, 50, 0.1]])?.with).toEqual([201, 200]);
  });

  it('blindPick with a fully known lane adds no blind reason', () => {
    const roleProb = asRoleProb({
      '1': { SUPPORT: 1 },
      '200': { SUPPORT: 1 },
      '201': { ADC: 1 },
      '202': { ADC: 1 },
    });
    const enemyPairs: EnemyPairTable = [[1, 202, 'ADC', 'DIAMOND', 10, 50, 0.1]];
    const data = makeData({ champions: [1, 200, 201, 202], roleProb, enemyPairs });
    const rec = recommend(
      makeInput({ blindPick: true, enemies: fixedBot }),
      data,
    ).recommendations.find((r) => r.championId === 1);
    expect(rec?.reasons.some((r) => r.type === 'blind')).toBe(false);
  });

  it('lane_full is scaled by the product of partner and enemy confidences', () => {
    const roleProb = asRoleProb({
      '1': { SUPPORT: 1 },
      '10': { ADC: 0.6, MID: 0.4 },
      '200': { SUPPORT: 0.6, MID: 0.4 },
      '201': { ADC: 1 },
    });
    const laneFull: LaneFullTable = [[1, 10, 200, 201, 'DIAMOND', 45, 50, 0.1]];
    const data = makeData({ champions: [1, 10, 200, 201], roleProb, laneFull });
    const delta = (enemyInferred: boolean): number => {
      const enemies = enemyInferred
        ? [{ championId: 200 }, { championId: 201, role: 'ADC' as Role }]
        : fixedBot;
      const input = makeInput({ allies: [{ championId: 10 }], enemies });
      const rec = recommend(input, data).recommendations.find((r) => r.championId === 1);
      const lane = rec?.reasons.find((r) => r.type === 'lane' && r.with?.length === 3);
      return Math.abs(lane?.deltaPp ?? 0);
    };
    expect(delta(true)).toBeGreaterThan(0);
    expect(delta(true)).toBeLessThan(delta(false));
  });

  it('reliability.games reports the baseline n_eff', () => {
    const data = makeData({ champions: [1] });
    const rec = recommend(makeInput(), data).recommendations[0];
    expect(rec?.reliability.games).toBeCloseTo(50 ** 2 / 0.1, 6);
    expect(rec?.reliability.lowData).toBe(false);
  });

  it('identical scores are ordered by championId', () => {
    const roleProb = asRoleProb({ '4': { MID: 1 }, '7': { MID: 1 }, '9': { MID: 1 } });
    const data = makeData({ champions: [9, 4, 7], roleProb });
    const ids = recommend(makeInput({ userRole: 'MID' }), data).recommendations.map(
      (r) => r.championId,
    );
    expect(ids).toEqual([4, 7, 9]);
  });

  it('omits rawGames when the baseline games column is 0 or absent', () => {
    const baselines: BaselineTable = [
      [1, 'DIAMOND', 5, 10, 10, 0],
      [2, 'DIAMOND', 5, 10, 10],
      [3, 'DIAMOND', 5, 10, 10, 12],
    ];
    const result = recommend(makeInput(), makeData({ champions: [1, 2, 3], baselines }));
    const byId = (id: number) => result.insufficientData.find((i) => i.championId === id);
    expect(byId(1)).not.toHaveProperty('rawGames');
    expect(byId(2)).not.toHaveProperty('rawGames');
    expect(byId(3)?.rawGames).toBe(12);
  });

  it('emits hard-counter warnings as codes', () => {
    const roleProb = asRoleProb({ '1': { SUPPORT: 1 }, '200': { SUPPORT: 1 } });
    const enemyPairs: EnemyPairTable = [[1, 200, 'SUPPORT', 'DIAMOND', 10, 50, 0.1]];
    const data = makeData({ champions: [1, 200], roleProb, enemyPairs });
    const input = makeInput({ enemies: [{ championId: 200, role: 'SUPPORT' }] });
    expect(recommend(input, data).recommendations[0]?.warnings).toEqual([
      'counteredBy:SUPPORT:200',
    ]);
  });

  it('keeps every resolvable teammate when two unfixed picks conflict', () => {
    // 300 and 301 can only play ADC, which 201 already fixes; 302 is a clean MID.
    const roleProb = asRoleProb({
      '1': { SUPPORT: 1 },
      '201': { ADC: 1 },
      '300': { ADC: 1 },
      '301': { ADC: 1 },
      '302': { MID: 1 },
    });
    const enemyPairs: EnemyPairTable = [[1, 302, 'MID', 'DIAMOND', 10, 50, 0.1]];
    const data = makeData({ champions: [1, 201, 300, 301, 302], roleProb, enemyPairs });
    const input = makeInput({
      enemies: [
        { championId: 201, role: 'ADC' },
        { championId: 300 },
        { championId: 301 },
        { championId: 302 },
      ],
    });
    const rec = recommend(input, data).recommendations.find((r) => r.championId === 1);
    expect(rec?.reasons.find((r) => r.type === 'counter')?.with).toEqual([302]);
  });
});
