/**
 * End-to-end edge cases for the recommendation engine (T-023 review follow-up).
 * Kept separate from recommend.test.ts to respect the < 300 lines convention.
 */

import { describe, it, expect } from 'vitest';
import type {
  BaselineTable,
  ChampionId,
  ChampionRoleProbabilities,
  DraftInput,
  EnemyPairTable,
  LaneFullTable,
  LaneVsTable,
  Role,
} from '@draftorb/shared';
import { recommend, type RecommendData } from './recommend.js';

function data(
  champions: ChampionId[],
  roleProb: Record<string, Partial<Record<Role, number>>>,
  extra: Partial<RecommendData> = {},
): RecommendData {
  const baselines: BaselineTable = champions.map((c) => [c, 'DIAMOND', 30, 50, 0.1, 50]);
  return {
    baselines,
    allyPairs: [],
    enemyPairs: [],
    laneVs: [],
    laneFull: [],
    roleProb: roleProb as ChampionRoleProbabilities,
    tags: {},
    championIds: champions,
    ...extra,
  };
}

function input(overrides: Partial<DraftInput> = {}): DraftInput {
  return {
    userRank: 'DIAMOND',
    userRole: 'SUPPORT',
    allies: [],
    enemies: [],
    blindPick: false,
    ...overrides,
  };
}

describe('recommend: edge cases (review follow-up)', () => {
  it('duplicate fixed SUPPORT enemies are dropped but the unique fixed ADC still scores', () => {
    const enemyPairs: EnemyPairTable = [
      [1, 202, 'ADC', 'DIAMOND', 10, 50, 0.1],
      [1, 200, 'SUPPORT', 'DIAMOND', 10, 50, 0.1],
    ];
    const d = data(
      [1, 200, 201, 202],
      { '1': { SUPPORT: 1 }, '200': { SUPPORT: 1 }, '201': { SUPPORT: 1 }, '202': { ADC: 1 } },
      { enemyPairs },
    );
    const rec = recommend(
      input({
        enemies: [
          { championId: 200, role: 'SUPPORT' },
          { championId: 201, role: 'SUPPORT' },
          { championId: 202, role: 'ADC' },
        ],
      }),
      d,
    ).recommendations.find((r) => r.championId === 1);
    const counters = rec?.reasons.filter((r) => r.type === 'counter') ?? [];
    expect(counters.map((r) => r.with)).toEqual([[202]]);
  });

  it('a fixed duplicate after an unfixed copy keeps its known matchup', () => {
    // 300 has no roleProb: only the fixed copy can place it.
    const enemyPairs: EnemyPairTable = [[1, 300, 'SUPPORT', 'DIAMOND', 10, 50, 0.1]];
    const d = data([1, 300], { '1': { SUPPORT: 1 } }, { enemyPairs });
    const rec = recommend(
      input({ enemies: [{ championId: 300 }, { championId: 300, role: 'SUPPORT' }] }),
      d,
    ).recommendations.find((r) => r.championId === 1);
    expect(rec?.reasons.filter((r) => r.type === 'counter')).toHaveLength(1);
  });

  it('blindPick with only the enemy SUPPORT known scores only the unseen ADC role', () => {
    const roleProb = { '1': { SUPPORT: 1 }, '200': { SUPPORT: 1 }, '201': { ADC: 1 } };
    // A bad matchup vs an unseen SUPPORT must not matter: SUPPORT is already known.
    const vsAdc: EnemyPairTable = [[1, 201, 'ADC', 'DIAMOND', 10, 50, 0.1]];
    const blindFor = (enemyPairs: EnemyPairTable): number | undefined =>
      recommend(
        input({ blindPick: true, enemies: [{ championId: 200, role: 'SUPPORT' }] }),
        data([1, 200, 201, 202], { ...roleProb, '202': { SUPPORT: 1 } }, { enemyPairs }),
      )
        .recommendations.find((r) => r.championId === 1)
        ?.reasons.find((r) => r.type === 'blind')?.deltaPp;
    expect(blindFor(vsAdc)).toBeLessThan(0);
    expect(blindFor([[1, 202, 'SUPPORT', 'DIAMOND', 10, 50, 0.1]])).toBeUndefined();
  });

  it('lane_vs ignores the ally partner confidence while lane_full includes it', () => {
    const roleProb = {
      '1': { SUPPORT: 1 },
      '10': { ADC: 0.6, MID: 0.4 },
      '200': { SUPPORT: 1 },
      '201': { ADC: 1 },
    };
    const laneVs: LaneVsTable = [[1, 200, 201, 'DIAMOND', 45, 50, 0.1]];
    const laneFull: LaneFullTable = [[1, 10, 200, 201, 'DIAMOND', 45, 50, 0.1]];
    const d = data([1, 10, 200, 201], roleProb, { laneVs, laneFull });
    const enemies = [
      { championId: 200, role: 'SUPPORT' as Role },
      { championId: 201, role: 'ADC' as Role },
    ];
    const lanes = (fixed: boolean) =>
      recommend(
        input({ allies: [fixed ? { championId: 10, role: 'ADC' } : { championId: 10 }], enemies }),
        d,
      )
        .recommendations.find((r) => r.championId === 1)
        ?.reasons.filter((r) => r.type === 'lane') ?? [];
    const [vsFixed, fullFixed] = lanes(true);
    const [vsInferred, fullInferred] = lanes(false);
    expect(vsInferred?.deltaPp).toBe(vsFixed?.deltaPp);
    expect(Math.abs(fullInferred?.deltaPp ?? 0)).toBeLessThan(Math.abs(fullFixed?.deltaPp ?? 0));
  });

  it('omits rawGames when the baseline raw count is 0 (unknown, B-025)', () => {
    const d = data([1], { '1': { SUPPORT: 1 } }, { baselines: [[1, 'DIAMOND', 5, 10, 10, 0]] });
    expect(recommend(input(), d).insufficientData).toEqual([{ championId: 1, nEff: 10 }]);
  });
});
