/**
 * recommend(): layer 1 pair terms, reason ordering/levels, hard-counter warnings.
 */

import { describe, it, expect } from 'vitest';
import type { BaselineTable, ChampionId, ChampionTagsMap, Role } from '@draftorb/shared';
import { recommend } from './recommend.js';
import { DEFAULT_CONFIG, DEFAULT_RECOMMEND_CONFIG } from './config.js';
import { indexBaselines, indexPairs, makePairKey } from './recommend-indexes.js';
import { baselineLogOdds, baselinePrior, deltaPp, scorePair } from './levels.js';
import {
  BOT_ROLE_PROB,
  HIGH_GAMES,
  asRoleProb,
  makeAllyPairs,
  makeChampionTags,
  makeData,
  makeEnemyPairs,
  makeInput,
  makeLaneVs,
  makeTag,
} from './recommend-test-utils.js';

describe('recommend: pair terms', () => {
  it('adds synergy from ally pairs', () => {
    const allyPairs = makeAllyPairs([
      { championId: 1, allyId: 100, role: 'ADC', ...HIGH_GAMES, winsW: 40 },
      { championId: 2, allyId: 100, role: 'ADC', ...HIGH_GAMES, winsW: 30 },
    ]);
    const roleProb = asRoleProb({ '1': { SUPPORT: 1 }, '2': { SUPPORT: 1 }, '100': { ADC: 1 } });
    const data = makeData({ champions: [1, 2, 100], allyPairs, roleProb });
    const result = recommend(makeInput({ allies: [{ championId: 100, role: 'ADC' }] }), data);
    expect(result.recommendations.map((r) => r.championId)).toEqual([1, 2]);
    expect(result.recommendations[0]?.reasons.some((r) => r.type === 'synergy')).toBe(true);
  });

  it('adds counter from enemy pairs', () => {
    const enemyPairs = makeEnemyPairs([
      { championId: 1, enemyId: 200, role: 'SUPPORT', ...HIGH_GAMES, winsW: 10 },
      { championId: 2, enemyId: 200, role: 'SUPPORT', ...HIGH_GAMES, winsW: 30 },
    ]);
    const data = makeData({ champions: [1, 2, 200], enemyPairs, roleProb: BOT_ROLE_PROB });
    const result = recommend(makeInput({ enemies: [{ championId: 200, role: 'SUPPORT' }] }), data);
    expect(result.recommendations.map((r) => r.championId)).toEqual([2, 1]);
    expect(result.recommendations[1]?.reasons.some((r) => r.type === 'counter')).toBe(true);
  });

  it('reports exact score and synergy deltaPp per SPECS §5', () => {
    const baselines: BaselineTable = [[1, 'DIAMOND', 30, 50, 0.1, 50]];
    const allyPairs = makeAllyPairs([
      { championId: 1, allyId: 10, role: 'ADC', ...HIGH_GAMES, winsW: 40 },
    ]);
    const data = makeData({ champions: [1, 10], roleProb: BOT_ROLE_PROB, baselines, allyPairs });
    const rec = recommend(makeInput({ allies: [{ championId: 10, role: 'ADC' }] }), data)
      .recommendations[0];
    const base = indexBaselines(baselines, 'DIAMOND').get(1);
    const pair = indexPairs(allyPairs, 'DIAMOND').get(makePairKey(1, 10, 'ADC'));
    if (!base || !pair) throw new Error('missing rows');
    const cfg = DEFAULT_CONFIG;
    const p0 = baselinePrior(base.winsE, base.gamesE, cfg.k0);
    const x0 = baselineLogOdds(base.winsE, base.gamesE, cfg.k0, cfg.eps);
    const term = cfg.s * scorePair(pair.winsE, pair.gamesE, p0, cfg).term;
    expect(rec?.reasons.map((r) => r.type)).toEqual(['synergy']);
    expect(rec?.reasons[0]?.deltaPp).toBe(Math.round(deltaPp(x0, term) * 100) / 100);
    expect(rec?.score).toBeCloseTo(1 / (1 + Math.exp(-(x0 + term))), 12);
  });

  it('a lowData pair term adds exactly 0 and has level 0', () => {
    const lowPair = makeAllyPairs([
      { championId: 1, allyId: 10, role: 'ADC', winsW: 10, gamesW: 10, gamesW2: 10 },
    ]);
    const input = makeInput({ allies: [{ championId: 10, role: 'ADC' }] });
    const champions: ChampionId[] = [1, 10];
    const withRow = recommend(
      input,
      makeData({ champions, roleProb: BOT_ROLE_PROB, allyPairs: lowPair }),
    ).recommendations.find((r) => r.championId === 1);
    const without = recommend(
      input,
      makeData({ champions, roleProb: BOT_ROLE_PROB }),
    ).recommendations.find((r) => r.championId === 1);
    expect(withRow?.score).toBe(without?.score);
    const synergy = withRow?.reasons.find((r) => r.type === 'synergy');
    expect(synergy?.lowData).toBe(true);
    expect(synergy?.deltaPp).toBe(0);
    expect(synergy?.level).toBe(0);
  });

  it('falls back to L1 for a large positive delta below highLevelMinGames', () => {
    // n_eff = 50^2 / 50 = 50: above minGames (25), below highLevelMinGames (100).
    const allyPairs = makeAllyPairs([
      { championId: 1, allyId: 10, role: 'ADC', winsW: 45, gamesW: 50, gamesW2: 50 },
    ]);
    const data = makeData({ champions: [1, 10], roleProb: BOT_ROLE_PROB, allyPairs });
    const rec = recommend(makeInput({ allies: [{ championId: 10, role: 'ADC' }] }), data)
      .recommendations[0];
    const synergy = rec?.reasons.find((r) => r.type === 'synergy');
    expect(synergy?.deltaPp).toBeGreaterThan(4.5);
    expect(synergy?.level).toBe(1);
  });
});

describe('recommend: reasons', () => {
  it('reasons reference only known slots', () => {
    const allyPairs = makeAllyPairs([
      { championId: 1, allyId: 100, role: 'ADC', ...HIGH_GAMES, winsW: 40 },
    ]);
    const enemyPairs = makeEnemyPairs([
      { championId: 1, enemyId: 200, role: 'SUPPORT', ...HIGH_GAMES, winsW: 10 },
    ]);
    const roleProb = asRoleProb({ '1': { SUPPORT: 1 }, '100': { ADC: 1 }, '200': { SUPPORT: 1 } });
    const data = makeData({ champions: [1, 100, 200], allyPairs, enemyPairs, roleProb });
    const input = makeInput({
      allies: [{ championId: 100, role: 'ADC' }],
      enemies: [{ championId: 200, role: 'SUPPORT' }],
    });
    for (const rec of recommend(input, data).recommendations) {
      for (const id of rec.reasons.flatMap((r) => r.with ?? [])) expect([100, 200]).toContain(id);
    }
  });

  it('orders reasons: pairs by descending influence, then lane_vs, lane_full, comp, blind', () => {
    const roleProb = asRoleProb({
      '1': { SUPPORT: 1 },
      '10': { ADC: 1 },
      '100': { SUPPORT: 1 },
      '201': { ADC: 1 },
    });
    const allyPairs = makeAllyPairs([
      { championId: 1, allyId: 10, role: 'ADC', ...HIGH_GAMES, winsW: 45 },
    ]);
    const enemyPairs = makeEnemyPairs([
      { championId: 1, enemyId: 100, role: 'SUPPORT', ...HIGH_GAMES, winsW: 15 },
      { championId: 1, enemyId: 201, role: 'ADC', ...HIGH_GAMES, winsW: 15 },
    ]);
    const laneVs = makeLaneVs([
      { championId: 1, opp1Id: 100, opp2Id: 201, ...HIGH_GAMES, winsW: 40 },
    ]);
    const tags: ChampionTagsMap = {
      ...makeChampionTags([1, 10, 100, 201]),
      '1': makeTag(1, { damageType: 'AP', peel: false, poke: true, waveclear: false }),
      '10': makeTag(10, { damageType: 'AD', hardEngage: false, peel: false, poke: true }),
    };
    const data = makeData({
      champions: [1, 10, 100, 201],
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
    const rec = recommend(input, data).recommendations[0];
    expect(rec?.reasons.map((r) => r.type)).toEqual([
      'synergy',
      'counter',
      'counter',
      'lane',
      'comp',
    ]);
    expect(rec?.reasons.slice(0, 3).map((r) => r.with)).toEqual([[10], [100], [201]]);
  });
});

describe('recommend: hard-counter warnings', () => {
  const warningsFor = (
    enemy: { championId: ChampionId; role?: Role },
    winsW: number,
    roleProb = BOT_ROLE_PROB,
    rc = DEFAULT_RECOMMEND_CONFIG,
  ): string[] => {
    const enemyPairs = makeEnemyPairs([
      {
        championId: 1,
        enemyId: enemy.championId,
        role: enemy.role ?? 'SUPPORT',
        ...HIGH_GAMES,
        winsW,
      },
    ]);
    const data = makeData({ champions: [1, enemy.championId], roleProb, enemyPairs });
    return (
      recommend(makeInput({ enemies: [enemy] }), data, DEFAULT_CONFIG, rc).recommendations.find(
        (r) => r.championId === 1,
      )?.warnings ?? []
    );
  };
  const hasCounter = (w: string[]): boolean => w.some((x) => x.startsWith('counteredBy:'));

  it('emits a code for a strong counter, and nothing for a neutral matchup', () => {
    expect(warningsFor({ championId: 200, role: 'SUPPORT' }, 10)).toEqual([
      'counteredBy:SUPPORT:200',
    ]);
    expect(hasCounter(warningsFor({ championId: 200, role: 'SUPPORT' }, 30))).toBe(false);
  });

  it('an inferred enemy role weakens the warning below the threshold', () => {
    // ~-7pp at full strength (warns); scaled by confidence 0.6 it is ~-4.2pp.
    const roleProb = asRoleProb({ '1': { SUPPORT: 1 }, '200': { SUPPORT: 0.6, MID: 0.4 } });
    expect(warningsFor({ championId: 200, role: 'SUPPORT' }, 26.5, roleProb)).toContain(
      'counteredBy:SUPPORT:200',
    );
    expect(hasCounter(warningsFor({ championId: 200 }, 26.5, roleProb))).toBe(false);
  });

  it('a low-influence enemy (TOP for SUPPORT) does not warn', () => {
    const roleProb = asRoleProb({ '1': { SUPPORT: 1 }, '300': { TOP: 1 } });
    expect(hasCounter(warningsFor({ championId: 300, role: 'TOP' }, 26.5, roleProb))).toBe(false);
  });

  it('a lowData enemy pair never warns', () => {
    const enemyPairs = makeEnemyPairs([
      { championId: 1, enemyId: 200, role: 'SUPPORT', winsW: 0, gamesW: 10, gamesW2: 10 },
    ]);
    const data = makeData({ champions: [1, 200], roleProb: BOT_ROLE_PROB, enemyPairs });
    const rec = recommend(
      makeInput({ enemies: [{ championId: 200, role: 'SUPPORT' }] }),
      data,
    ).recommendations.find((r) => r.championId === 1);
    expect(hasCounter(rec?.warnings ?? [])).toBe(false);
  });

  it('honors an injected hardCounterDeltaPp', () => {
    const strict = { ...DEFAULT_RECOMMEND_CONFIG, hardCounterDeltaPp: -50 };
    expect(
      hasCounter(warningsFor({ championId: 200, role: 'SUPPORT' }, 26.5, BOT_ROLE_PROB, strict)),
    ).toBe(false);
  });

  it('a duplicated championId on one team is resolved once', () => {
    const enemyPairs = makeEnemyPairs([
      { championId: 1, enemyId: 200, role: 'SUPPORT', ...HIGH_GAMES, winsW: 10 },
    ]);
    const data = makeData({ champions: [1, 2, 200], roleProb: BOT_ROLE_PROB, enemyPairs });
    const input = makeInput({
      enemies: [{ championId: 200, role: 'SUPPORT' }, { championId: 200 }],
    });
    const rec = recommend(input, data).recommendations.find((r) => r.championId === 1);
    expect(rec?.reasons.filter((r) => r.type === 'counter')).toHaveLength(1);
    expect(rec?.warnings).toEqual(['counteredBy:SUPPORT:200']);
  });
});
