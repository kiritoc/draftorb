/**
 * Edge-case tests for the recommendation engine (T-023 review follow-up).
 */

import { describe, it, expect } from 'vitest';
import { recommend, type RecommendData } from './recommend.js';
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

type RoleProbInput = Record<string, Partial<Record<Role, number>>>;

function makeData(
  champions: ChampionId[],
  roleProb: RoleProbInput,
  extra: Partial<Pick<RecommendData, 'baselines' | 'enemyPairs' | 'laneVs' | 'laneFull'>> = {},
): RecommendData {
  const baselines: BaselineTable = champions.map((c) => [c, 'DIAMOND', 30, 50, 0.1, 50]);
  return {
    baselines: extra.baselines ?? baselines,
    allyPairs: [],
    enemyPairs: extra.enemyPairs ?? [],
    laneVs: extra.laneVs ?? [],
    laneFull: extra.laneFull ?? [],
    roleProb: roleProb as ChampionRoleProbabilities,
    tags: {},
    championIds: champions,
  };
}

function makeInput(overrides: Partial<DraftInput> & { userRole: Role }): DraftInput {
  return { userRank: 'DIAMOND', allies: [], enemies: [], blindPick: false, ...overrides };
}

const FIXED_BOT = [
  { championId: 200, role: 'SUPPORT' as Role },
  { championId: 201, role: 'ADC' as Role },
];

describe('recommend: edge cases', () => {
  it('ADC lane_vs keys follow [enemy ADC, enemy SUPPORT]', () => {
    const roleProb = { '11': { ADC: 1 }, '200': { SUPPORT: 1 }, '201': { ADC: 1 } };
    const champions = [11, 200, 201];
    const reversed: LaneVsTable = [[11, 200, 201, 'DIAMOND', 45, 50, 0.1]];
    const ordered: LaneVsTable = [[11, 201, 200, 'DIAMOND', 45, 50, 0.1]];
    const input = makeInput({ userRole: 'ADC', enemies: FIXED_BOT });
    const lane = (laneVs: LaneVsTable) =>
      recommend(input, makeData(champions, roleProb, { laneVs }))
        .recommendations.find((r) => r.championId === 11)
        ?.reasons.find((r) => r.type === 'lane');
    expect(lane(reversed)).toBeUndefined();
    expect(lane(ordered)?.with).toEqual([201, 200]);
  });

  it('blindPick with a fully known lane adds no blind reason', () => {
    const roleProb = {
      '1': { SUPPORT: 1 },
      '200': { SUPPORT: 1 },
      '201': { ADC: 1 },
      '202': { ADC: 1 },
    };
    const enemyPairs: EnemyPairTable = [[1, 202, 'ADC', 'DIAMOND', 10, 50, 0.1]];
    const data = makeData([1, 200, 201, 202], roleProb, { enemyPairs });
    const input = makeInput({ userRole: 'SUPPORT', blindPick: true, enemies: FIXED_BOT });
    const rec = recommend(input, data).recommendations.find((r) => r.championId === 1);
    expect(rec?.reasons.some((r) => r.type === 'blind')).toBe(false);
  });

  it('lane_full is scaled by the product of partner and enemy confidences', () => {
    const roleProb = {
      '1': { SUPPORT: 1 },
      '10': { ADC: 0.6, MID: 0.4 },
      '200': { SUPPORT: 0.6, MID: 0.4 },
      '201': { ADC: 1 },
    };
    const laneFull: LaneFullTable = [[1, 10, 200, 201, 'DIAMOND', 45, 50, 0.1]];
    const data = makeData([1, 10, 200, 201], roleProb, { laneFull });
    const delta = (enemyInferred: boolean): number => {
      const enemies = enemyInferred
        ? [{ championId: 200 }, { championId: 201, role: 'ADC' as Role }]
        : FIXED_BOT;
      const input = makeInput({ userRole: 'SUPPORT', allies: [{ championId: 10 }], enemies });
      const rec = recommend(input, data).recommendations.find((r) => r.championId === 1);
      const lane = rec?.reasons.find((r) => r.type === 'lane' && r.with?.length === 3);
      return Math.abs(lane?.deltaPp ?? 0);
    };
    expect(delta(true)).toBeGreaterThan(0);
    expect(delta(true)).toBeLessThan(delta(false));
  });

  it('reliability.games reports the baseline n_eff', () => {
    const data = makeData([1], { '1': { SUPPORT: 1 } });
    const rec = recommend(makeInput({ userRole: 'SUPPORT' }), data).recommendations[0];
    expect(rec?.reliability.games).toBeCloseTo(50 ** 2 / 0.1, 6);
    expect(rec?.reliability.lowData).toBe(false);
  });

  it('scores within one tie quantum are ordered by championId', () => {
    // Identical rows produce bit-identical scores, so the id tie-break decides.
    const data = makeData([9, 4, 7], { '4': { MID: 1 }, '7': { MID: 1 }, '9': { MID: 1 } });
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
    const roleProb = { '1': { MID: 1 }, '2': { MID: 1 }, '3': { MID: 1 } };
    const result = recommend(
      makeInput({ userRole: 'MID' }),
      makeData([1, 2, 3], roleProb, { baselines }),
    );
    const byId = (id: number) => result.insufficientData.find((i) => i.championId === id);
    expect(byId(1)).not.toHaveProperty('rawGames');
    expect(byId(2)).not.toHaveProperty('rawGames');
    expect(byId(3)?.rawGames).toBe(12);
  });

  it('emits hard-counter warnings as codes', () => {
    const roleProb = { '1': { SUPPORT: 1 }, '200': { SUPPORT: 1 } };
    const enemyPairs: EnemyPairTable = [[1, 200, 'SUPPORT', 'DIAMOND', 10, 50, 0.1]];
    const input = makeInput({
      userRole: 'SUPPORT',
      enemies: [FIXED_BOT[0] ?? { championId: 200 }],
    });
    const rec = recommend(input, makeData([1, 200], roleProb, { enemyPairs })).recommendations[0];
    expect(rec?.warnings).toEqual(['counteredBy:SUPPORT:200']);
  });

  it('keeps every resolvable teammate when two unfixed picks conflict', () => {
    // 300 and 301 can only play ADC, which 201 already fixes; 302 is a clean MID.
    const roleProb = {
      '1': { SUPPORT: 1 },
      '201': { ADC: 1 },
      '300': { ADC: 1 },
      '301': { ADC: 1 },
      '302': { MID: 1 },
    };
    const enemyPairs: EnemyPairTable = [[1, 302, 'MID', 'DIAMOND', 10, 50, 0.1]];
    const data = makeData([1, 201, 300, 301, 302], roleProb, { enemyPairs });
    const input = makeInput({
      userRole: 'SUPPORT',
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
