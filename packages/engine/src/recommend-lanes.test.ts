/**
 * recommend(): lane layers (lane_vs, lane_full), conf_lane, key order.
 * Role-conflict cases (D-030) live in recommend-role-conflicts.test.ts.
 */

import { describe, it, expect } from 'vitest';
import type { LaneFullTable, LaneVsTable, Role } from '@draftorb/shared';
import { recommend } from './recommend.js';
import {
  BOT_ROLE_PROB,
  FIXED_BOT,
  HIGH_GAMES,
  asRoleProb,
  makeData,
  makeInput,
  makeLaneFull,
  makeLaneVs,
} from './recommend-test-utils.js';

type Rec = ReturnType<typeof recommend>['recommendations'][number];

function laneReasons(rec: Rec | undefined): Rec['reasons'] {
  return rec?.reasons.filter((r) => r.type === 'lane') ?? [];
}

describe('recommend: bot lane', () => {
  it('applies lane_vs then lane_full for a complete SUPPORT bot lane', () => {
    const laneVs = makeLaneVs([
      { championId: 1, opp1Id: 200, opp2Id: 201, ...HIGH_GAMES, winsW: 35 },
    ]);
    const laneFull = makeLaneFull([
      { championId: 1, partnerId: 10, opp1Id: 200, opp2Id: 201, ...HIGH_GAMES, winsW: 45 },
    ]);
    const data = makeData({
      champions: [1, 10, 200, 201],
      roleProb: BOT_ROLE_PROB,
      laneVs,
      laneFull,
    });
    const input = makeInput({ allies: [{ championId: 10, role: 'ADC' }], enemies: FIXED_BOT });
    const rec = recommend(input, data).recommendations.find((r) => r.championId === 1);
    expect(laneReasons(rec).map((l) => l.with)).toEqual([
      [200, 201],
      [10, 200, 201],
    ]);
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
      roleProb: BOT_ROLE_PROB,
      laneVs,
      laneFull,
    });
    const input = makeInput({
      userRole: 'ADC',
      allies: [{ championId: 20, role: 'SUPPORT' }],
      enemies: FIXED_BOT,
    });
    const rec = recommend(input, data).recommendations.find((r) => r.championId === 11);
    expect(laneReasons(rec).map((l) => l.with)).toEqual([
      [201, 200],
      [20, 201, 200],
    ]);
  });

  it('applies lane_vs alone when the lane_full row is missing', () => {
    const laneVs = makeLaneVs([
      { championId: 1, opp1Id: 200, opp2Id: 201, ...HIGH_GAMES, winsW: 40 },
    ]);
    const data = makeData({ champions: [1, 10, 200, 201], roleProb: BOT_ROLE_PROB, laneVs });
    const input = makeInput({ allies: [{ championId: 10, role: 'ADC' }], enemies: FIXED_BOT });
    const rec = recommend(input, data).recommendations.find((r) => r.championId === 1);
    expect(laneReasons(rec).map((l) => l.with)).toEqual([[200, 201]]);
  });

  it('skips lane_full but keeps lane_vs when the ally partner is unknown', () => {
    const laneVs: LaneVsTable = [[1, 200, 201, 'DIAMOND', 40, 50, 0.1]];
    const laneFull: LaneFullTable = [[1, null, 200, 201, 'DIAMOND', 45, 50, 0.1]];
    const data = makeData({ champions: [1, 200, 201], roleProb: BOT_ROLE_PROB, laneVs, laneFull });
    const rec = recommend(makeInput({ enemies: FIXED_BOT }), data).recommendations[0];
    expect(laneReasons(rec).map((l) => l.with)).toEqual([[200, 201]]);
  });
});

describe('recommend: lane key order (contract for T-017)', () => {
  const laneFor = (userRole: Role, c: number, laneVs: LaneVsTable) =>
    laneReasons(
      recommend(
        makeInput({ userRole, enemies: FIXED_BOT }),
        makeData({ champions: [c, 200, 201], roleProb: BOT_ROLE_PROB, laneVs }),
      ).recommendations.find((r) => r.championId === c),
    )[0];

  it('SUPPORT keys follow [enemy SUPPORT, enemy ADC]', () => {
    expect(laneFor('SUPPORT', 1, [[1, 201, 200, 'DIAMOND', 45, 50, 0.1]])).toBeUndefined();
    expect(laneFor('SUPPORT', 1, [[1, 200, 201, 'DIAMOND', 45, 50, 0.1]])?.with).toEqual([
      200, 201,
    ]);
  });

  it('ADC keys follow [enemy ADC, enemy SUPPORT]', () => {
    expect(laneFor('ADC', 11, [[11, 200, 201, 'DIAMOND', 45, 50, 0.1]])).toBeUndefined();
    expect(laneFor('ADC', 11, [[11, 201, 200, 'DIAMOND', 45, 50, 0.1]])?.with).toEqual([201, 200]);
  });
});

describe('recommend: conf_lane', () => {
  const partnerFlex = asRoleProb({ ...BOT_ROLE_PROB, '10': { ADC: 0.6, MID: 0.4 } });

  it('lane_vs ignores the ally partner confidence while lane_full includes it', () => {
    const laneVs: LaneVsTable = [[1, 200, 201, 'DIAMOND', 45, 50, 0.1]];
    const laneFull: LaneFullTable = [[1, 10, 200, 201, 'DIAMOND', 45, 50, 0.1]];
    const data = makeData({
      champions: [1, 10, 200, 201],
      roleProb: partnerFlex,
      laneVs,
      laneFull,
    });
    const lanes = (fixed: boolean) =>
      laneReasons(
        recommend(
          makeInput({
            allies: [fixed ? { championId: 10, role: 'ADC' } : { championId: 10 }],
            enemies: FIXED_BOT,
          }),
          data,
        ).recommendations.find((r) => r.championId === 1),
      );
    const [vsFixed, fullFixed] = lanes(true);
    const [vsInferred, fullInferred] = lanes(false);
    expect(vsInferred?.deltaPp).toBe(vsFixed?.deltaPp);
    expect(Math.abs(fullInferred?.deltaPp ?? 0)).toBeGreaterThan(0);
    expect(Math.abs(fullInferred?.deltaPp ?? 0)).toBeLessThan(Math.abs(fullFixed?.deltaPp ?? 0));
  });

  it('scales lane_vs by the enemy confidence when an enemy role is inferred', () => {
    const laneVs = makeLaneVs([
      { championId: 1, opp1Id: 200, opp2Id: 201, ...HIGH_GAMES, winsW: 45 },
    ]);
    const roleProb = asRoleProb({ ...BOT_ROLE_PROB, '200': { SUPPORT: 0.6, MID: 0.4 } });
    const data = makeData({ champions: [1, 2, 10, 200, 201], roleProb, laneVs });
    const delta = (fixed: boolean): number => {
      const enemies = [
        fixed ? { championId: 200, role: 'SUPPORT' as Role } : { championId: 200 },
        { championId: 201, role: 'ADC' as Role },
      ];
      const rec = recommend(makeInput({ enemies }), data).recommendations.find(
        (r) => r.championId === 1,
      );
      return Math.abs(laneReasons(rec)[0]?.deltaPp ?? 0);
    };
    expect(delta(false)).toBeGreaterThan(0);
    expect(delta(false)).toBeLessThan(delta(true));
  });

  it('scales lane_full by the product of partner and enemy confidences', () => {
    const roleProb = asRoleProb({ ...partnerFlex, '200': { SUPPORT: 0.6, MID: 0.4 } });
    const laneFull: LaneFullTable = [[1, 10, 200, 201, 'DIAMOND', 45, 50, 0.1]];
    const data = makeData({ champions: [1, 10, 200, 201], roleProb, laneFull });
    const delta = (enemyInferred: boolean): number => {
      const enemies = enemyInferred
        ? [{ championId: 200 }, { championId: 201, role: 'ADC' as Role }]
        : FIXED_BOT;
      const rec = recommend(
        makeInput({ allies: [{ championId: 10 }], enemies }),
        data,
      ).recommendations.find((r) => r.championId === 1);
      return Math.abs(laneReasons(rec).find((l) => l.with?.length === 3)?.deltaPp ?? 0);
    };
    expect(delta(true)).toBeGreaterThan(0);
    expect(delta(true)).toBeLessThan(delta(false));
  });
});

describe('recommend: 1v1 lanes', () => {
  it.each<Role>(['TOP', 'MID', 'JUNGLE'])('%s applies one lane_vs and skips lane_full', (role) => {
    const roleProb = asRoleProb({ '1': { [role]: 1 }, '2': { [role]: 1 }, '300': { [role]: 1 } });
    const laneVs = makeLaneVs([
      { championId: 1, opp1Id: 300, opp2Id: null, ...HIGH_GAMES, winsW: 45 },
    ]);
    const laneFull = makeLaneFull([
      { championId: 1, partnerId: null, opp1Id: 300, opp2Id: null, ...HIGH_GAMES, winsW: 5 },
    ]);
    const data = makeData({ champions: [1, 2, 300], roleProb, laneVs, laneFull });
    const result = recommend(
      makeInput({ userRole: role, enemies: [{ championId: 300, role }] }),
      data,
    );
    const rec = result.recommendations[0];
    expect(rec?.championId).toBe(1);
    expect(laneReasons(rec).map((l) => l.with)).toEqual([[300]]);
    expect(rec?.reasons.some((r) => r.type === 'blind')).toBe(false);
  });

  it('TOP ignores a lane_full row even with a known ally jungler', () => {
    const roleProb = asRoleProb({ '1': { TOP: 1 }, '300': { TOP: 1 }, '301': { JUNGLE: 1 } });
    const laneVs = makeLaneVs([
      { championId: 1, opp1Id: 300, opp2Id: null, ...HIGH_GAMES, winsW: 40 },
    ]);
    const laneFull = makeLaneFull([
      { championId: 1, partnerId: 301, opp1Id: 300, opp2Id: null, ...HIGH_GAMES, winsW: 5 },
    ]);
    const data = makeData({ champions: [1, 300, 301], roleProb, laneVs, laneFull });
    const input = makeInput({
      userRole: 'TOP',
      allies: [{ championId: 301, role: 'JUNGLE' }],
      enemies: [{ championId: 300, role: 'TOP' }],
    });
    const rec = recommend(input, data).recommendations.find((r) => r.championId === 1);
    expect(laneReasons(rec).map((l) => l.with)).toEqual([[300]]);
  });
});
