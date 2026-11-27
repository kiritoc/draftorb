/**
 * recommend(): minimal roles (BL-024, D-097) — ADC and MID rank on
 * champion-level statistics only: no role inference, pair, lane, comp or
 * blind layers, so no synergy/counter/lane/comp/blind reasons can appear.
 */

import { describe, it, expect } from 'vitest';
import type { BaselineTable, ChampionId } from '@draftorb/shared';
import { recommend } from '../src/recommend.js';
import { DEFAULT_CONFIG, DEFAULT_RECOMMEND_CONFIG } from '../src/config.js';
import {
  HIGH_GAMES,
  asRoleProb,
  makeAllyPairs,
  makeChampionTags,
  makeData,
  makeEnemyPairs,
  makeInput,
  makeLaneFull,
  makeLaneVs,
  noUtilityTag,
} from '../src/recommend-test-utils.js';
import type { RecommendData } from '@draftorb/shared';

const CHAMPIONS: ChampionId[] = [1, 2, 100, 200];

// 1 outranks 2 on baseline (40 vs 30 wins out of 50); every matchup table
// below favors 2, so any leaked layer would flip the order or add reasons.
const BASELINES: BaselineTable = [
  [1, 'DIAMOND', 40, 50, 0.1, 50],
  [2, 'DIAMOND', 30, 50, 0.1, 50],
  [100, 'DIAMOND', 30, 50, 0.1, 50],
  [200, 'DIAMOND', 30, 50, 0.1, 50],
];

const ROLE_PROB = asRoleProb({
  '1': { ADC: 1 },
  '2': { ADC: 1 },
  '100': { SUPPORT: 1 },
  '200': { SUPPORT: 1 },
});

function matchupData(): RecommendData {
  return makeData({
    champions: CHAMPIONS,
    baselines: BASELINES,
    roleProb: ROLE_PROB,
    allyPairs: makeAllyPairs([
      { championId: 1, allyId: 100, role: 'SUPPORT', ...HIGH_GAMES, winsW: 5 },
      { championId: 2, allyId: 100, role: 'SUPPORT', ...HIGH_GAMES, winsW: 45 },
    ]),
    enemyPairs: makeEnemyPairs([
      { championId: 1, enemyId: 200, role: 'SUPPORT', ...HIGH_GAMES, winsW: 5 },
      { championId: 2, enemyId: 200, role: 'SUPPORT', ...HIGH_GAMES, winsW: 45 },
    ]),
    laneVs: makeLaneVs([
      { championId: 1, opp1Id: 200, opp2Id: null, ...HIGH_GAMES, winsW: 5 },
      { championId: 2, opp1Id: 200, opp2Id: null, ...HIGH_GAMES, winsW: 45 },
    ]),
    laneFull: makeLaneFull([
      {
        championId: 1,
        partnerId: 100,
        opp1Id: 200,
        opp2Id: null,
        ...HIGH_GAMES,
        winsW: 5,
      },
      {
        championId: 2,
        partnerId: 100,
        opp1Id: 200,
        opp2Id: null,
        ...HIGH_GAMES,
        winsW: 45,
      },
    ]),
    tags: {
      ...makeChampionTags([1, 2, 200]),
      // An ally with no utility leaves engage/peel needs open so the comp
      // layer would fire for a non-minimal role.
      '100': noUtilityTag(100),
    },
  });
}

function bareData(): RecommendData {
  return makeData({
    champions: CHAMPIONS,
    baselines: BASELINES,
    roleProb: ROLE_PROB,
    tags: matchupData().tags,
  });
}

const INPUT = makeInput({
  userRole: 'ADC',
  allies: [{ championId: 100, role: 'SUPPORT' }],
  enemies: [{ championId: 200, role: 'SUPPORT' }],
  blindPick: true,
});

describe('recommend: minimal roles', () => {
  it('ADC output equals champion-level-only data (no pair/lane/comp/blind effect)', () => {
    const full = recommend(INPUT, matchupData());
    const bare = recommend(INPUT, bareData());
    expect(full.recommendations).toEqual(bare.recommendations);
    expect(full.insufficientData).toEqual(bare.insufficientData);
    expect(full.recommendations.map((r) => r.championId)).toEqual([1, 2]);
    for (const rec of full.recommendations) {
      expect(rec.reasons).toEqual([]);
    }
  });

  it('MID is minimal by default too', () => {
    const midProb = asRoleProb({
      '1': { MID: 1 },
      '2': { MID: 1 },
      '100': { SUPPORT: 1 },
      '200': { MID: 1 },
    });
    const data = makeData({
      champions: CHAMPIONS,
      baselines: BASELINES,
      roleProb: midProb,
      enemyPairs: makeEnemyPairs([
        { championId: 1, enemyId: 200, role: 'MID', ...HIGH_GAMES, winsW: 5 },
        { championId: 2, enemyId: 200, role: 'MID', ...HIGH_GAMES, winsW: 45 },
      ]),
    });
    const result = recommend(
      makeInput({
        userRole: 'MID',
        enemies: [{ championId: 200, role: 'MID' }],
      }),
      data,
    );
    expect(result.recommendations.map((r) => r.championId)).toEqual([1, 2]);
    for (const rec of result.recommendations) {
      expect(rec.reasons).toEqual([]);
    }
  });

  it('the same matchup data changes a non-minimal role (SUPPORT sanity check)', () => {
    const supportProb = asRoleProb({
      '1': { SUPPORT: 1 },
      '2': { SUPPORT: 1 },
      '100': { ADC: 1 },
      '200': { SUPPORT: 1 },
    });
    const data = makeData({
      champions: CHAMPIONS,
      baselines: BASELINES,
      roleProb: supportProb,
      enemyPairs: makeEnemyPairs([
        { championId: 1, enemyId: 200, role: 'SUPPORT', ...HIGH_GAMES, winsW: 5 },
        { championId: 2, enemyId: 200, role: 'SUPPORT', ...HIGH_GAMES, winsW: 45 },
      ]),
    });
    const result = recommend(
      makeInput({
        userRole: 'SUPPORT',
        allies: [{ championId: 100, role: 'ADC' }],
        enemies: [{ championId: 200, role: 'SUPPORT' }],
      }),
      data,
    );
    expect(result.recommendations.map((r) => r.championId)).toEqual([2, 1]);
    expect(result.recommendations.some((r) => r.reasons.length > 0)).toBe(true);
  });

  it('minimalRoles config can disable the minimal behavior', () => {
    const rc = { ...DEFAULT_RECOMMEND_CONFIG, minimalRoles: [] as const };
    const result = recommend(INPUT, matchupData(), DEFAULT_CONFIG, rc);
    expect(result.recommendations.some((r) => r.reasons.length > 0)).toBe(true);
  });
});
