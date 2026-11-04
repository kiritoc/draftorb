import { describe, expect, it } from 'vitest';

import { createRecommendData } from './recommend-data.js';

const champions = [{ id: 412, name: 'Soraka', icon: 'Soraka.png', roles: ['SUPPORT' as const] }];
const tags = {
  '412': {
    championId: 412,
    damageType: 'AP' as const,
    archetype: 'enchanter',
    hardEngage: false,
    peel: true,
    poke: false,
    waveclear: false,
    scaling: { early: false, mid: true, late: true },
    range: 'RANGED' as const,
    ccCount: 1,
  },
};

describe('createRecommendData', () => {
  it('validates and connects all role-specific recommendation files', () => {
    const data = createRecommendData(
      {
        'roles/SUPPORT/baseline.json': [[412, 'IRON', 6, 10, 10, 3]],
        'roles/SUPPORT/ally-pairs.json': [[412, 22, 'ADC', 'IRON', 2, 4, 4]],
        'roles/SUPPORT/enemy-pairs.json': [[412, 89, 'SUPPORT', 'IRON', 1, 3, 3]],
        'roles/SUPPORT/lane-vs.json': [[412, 89, 22, 'IRON', 1, 3, 3]],
        'roles/SUPPORT/lane-full.json': [[412, 22, 89, 22, 'IRON', 1, 3, 3]],
        'role-prob.json': { '412': { SUPPORT: 1 } },
      },
      champions,
      tags,
    );

    expect(data.baselines).toHaveLength(1);
    expect(data.allyPairs).toHaveLength(1);
    expect(data.enemyPairs).toHaveLength(1);
    expect(data.laneVs).toHaveLength(1);
    expect(data.laneFull).toHaveLength(1);
    expect(data.roleProb['412']?.SUPPORT).toBe(1);
    expect(data.tags['412']?.peel).toBe(true);
    expect(data.championIds).toEqual([412]);
  });

  it('fails explicitly when a required recommendation file is missing', () => {
    expect(() => createRecommendData({}, champions, tags)).toThrow(
      'Required recommendation data file is missing: roles/SUPPORT/baseline.json',
    );
  });

  it('rejects malformed export data', () => {
    expect(() =>
      createRecommendData(
        {
          'roles/SUPPORT/baseline.json': [['not-a-champion', 'IRON', 6, 10, 10, 3]],
          'roles/SUPPORT/ally-pairs.json': [],
          'roles/SUPPORT/enemy-pairs.json': [],
          'roles/SUPPORT/lane-vs.json': [],
          'roles/SUPPORT/lane-full.json': [],
          'role-prob.json': {},
        },
        champions,
        tags,
      ),
    ).toThrow();
  });
});
