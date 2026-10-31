/**
 * recommend(): role conflicts and ambiguous fixed roles (D-030).
 */

import { describe, it, expect } from 'vitest';
import type {
  AllyPairTable,
  ChampionRoleProbabilities,
  EnemyPairTable,
  Role,
} from '@draftorb/shared';
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

describe('recommend: role conflicts (D-030)', () => {
  it('keeps a resolvable teammate when another unfixed pick conflicts with a fixed role', () => {
    const roleProb: ChampionRoleProbabilities = asRoleProb({
      ...BOT_ROLE_PROB,
      // Above the SUPPORT threshold: it would be recommended if its enemy slot were dropped.
      '300': { TOP: 0.9, SUPPORT: 0.1 },
    });
    const data = makeData({ champions: [1, 2, 201, 202, 300], roleProb });
    const input = makeInput({
      enemies: [{ championId: 201, role: 'ADC' }, { championId: 202 }, { championId: 300 }],
    });
    const ids = recommend(input, data).recommendations.map((r) => r.championId);
    expect(ids).not.toContain(300);
    expect(ids).toEqual(expect.arrayContaining([1, 2]));
  });

  it('keeps fixed-role allies when a teammate has no roleProb', () => {
    const roleProb = asRoleProb({ ...BOT_ROLE_PROB, '10': { ADC: 1, SUPPORT: 1 } });
    const allyPairs: AllyPairTable = [[2, 10, 'ADC', 'DIAMOND', 45, 50, 0.1]];
    const data = makeData({ champions: [1, 2, 10, 77], roleProb, allyPairs });
    const input = makeInput({ allies: [{ championId: 10, role: 'ADC' }, { championId: 77 }] });
    const ids = recommend(input, data).recommendations.map((r) => r.championId);
    expect(ids).not.toContain(10);
    expect(ids).not.toContain(77);
    expect(ids[0]).toBe(2);
  });

  const supSupRoleProb = asRoleProb({
    '1': { SUPPORT: 1 },
    '200': { SUPPORT: 1 },
    '201': { SUPPORT: 1 },
    '202': { ADC: 1 },
  });
  const swappedLaneVs = makeLaneVs([
    { championId: 1, opp1Id: 200, opp2Id: 201, ...HIGH_GAMES, winsW: 45 },
    { championId: 1, opp1Id: 201, opp2Id: 200, ...HIGH_GAMES, winsW: 45 },
  ]);

  it.each([
    ['without', []],
    ['with', [{ championId: 202, role: 'ADC' as Role }]],
  ])('duplicate fixed SUPPORT enemies %s a fixed ADC never form a lane', (_label, extra) => {
    const data = makeData({
      champions: [1, 200, 201, 202],
      roleProb: supSupRoleProb,
      laneVs: swappedLaneVs,
    });
    const enemies = [
      { championId: 200, role: 'SUPPORT' as Role },
      { championId: 201, role: 'SUPPORT' as Role },
      ...extra,
    ];
    const rec = recommend(makeInput({ enemies }), data).recommendations.find(
      (r) => r.championId === 1,
    );
    expect(laneReasons(rec)).toEqual([]);
  });

  it('duplicate fixed SUPPORT enemies are dropped but the unique fixed ADC still scores', () => {
    const enemyPairs: EnemyPairTable = [
      [1, 202, 'ADC', 'DIAMOND', 10, 50, 0.1],
      [1, 200, 'SUPPORT', 'DIAMOND', 10, 50, 0.1],
    ];
    const data = makeData({ champions: [1, 200, 201, 202], roleProb: supSupRoleProb, enemyPairs });
    const enemies = [
      { championId: 200, role: 'SUPPORT' as Role },
      { championId: 201, role: 'SUPPORT' as Role },
      { championId: 202, role: 'ADC' as Role },
    ];
    const rec = recommend(makeInput({ enemies }), data).recommendations.find(
      (r) => r.championId === 1,
    );
    expect(rec?.reasons.filter((r) => r.type === 'counter').map((r) => r.with)).toEqual([[202]]);
  });

  it('a fixed duplicate after an unfixed copy keeps its known matchup', () => {
    // 300 has no roleProb: only the fixed copy can place it.
    const enemyPairs: EnemyPairTable = [[1, 300, 'SUPPORT', 'DIAMOND', 10, 50, 0.1]];
    const data = makeData({
      champions: [1, 300],
      roleProb: asRoleProb({ '1': { SUPPORT: 1 } }),
      enemyPairs,
    });
    const input = makeInput({
      enemies: [{ championId: 300 }, { championId: 300, role: 'SUPPORT' }],
    });
    const rec = recommend(input, data).recommendations.find((r) => r.championId === 1);
    expect(rec?.reasons.filter((r) => r.type === 'counter')).toHaveLength(1);
  });

  it('duplicate fixed ally ADCs never form a lane_full partner', () => {
    const laneFull = makeLaneFull([
      { championId: 1, partnerId: 10, opp1Id: 200, opp2Id: 201, ...HIGH_GAMES, winsW: 45 },
    ]);
    const data = makeData({ champions: [1, 10, 11, 200, 201], roleProb: BOT_ROLE_PROB, laneFull });
    const input = makeInput({
      allies: [
        { championId: 10, role: 'ADC' },
        { championId: 11, role: 'ADC' },
      ],
      enemies: FIXED_BOT,
    });
    const rec = recommend(input, data).recommendations.find((r) => r.championId === 1);
    expect(laneReasons(rec).some((l) => l.with?.length === 3)).toBe(false);
  });
});
