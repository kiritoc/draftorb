/**
 * Enemy role inference UI helpers (BL-015): the view model must use the same
 * engine slot resolution as `recommend`, mark manual overrides as confidence 1,
 * and let a dropdown change flow into a recomputed recommendation.
 */

import { describe, expect, it } from 'vitest';

import { recommend } from '@draftorb/engine';
import type { ChampionRoleProbabilities, DraftInput, RecommendData, Role } from '@draftorb/shared';

import { enemyRoleViews, formatRoleConfidence } from './enemy-roles';

const roleProb = {
  '1': { SUPPORT: 1 },
  '200': { ADC: 0.75, SUPPORT: 0.25 },
} as ChampionRoleProbabilities;

function makeRecommendData(): RecommendData {
  return {
    baselines: [[1, 'DIAMOND', 30, 50, 0.1, 50]],
    allyPairs: [],
    enemyPairs: [[1, 200, 'ADC', 'DIAMOND', 40, 50, 0.1]],
    laneVs: [],
    laneFull: [],
    roleProb,
    tags: {},
    championIds: [1, 200],
  };
}

function draftInput(enemies: ReadonlyArray<{ championId: number; role?: Role }>): DraftInput {
  return {
    userRank: 'DIAMOND',
    userRole: 'SUPPORT',
    allies: [],
    enemies: [...enemies],
    blindPick: false,
  };
}

describe('enemyRoleViews', () => {
  it('returns the engine inferred role and confidence for an enemy without a role', () => {
    const views = enemyRoleViews([{ championId: 200 }], roleProb);

    expect(views).toEqual([{ championId: 200, source: 'inferred', role: 'ADC', confidence: 0.75 }]);
  });

  it('marks a chosen role as a manual override with confidence 1', () => {
    const views = enemyRoleViews([{ championId: 200, role: 'SUPPORT' }], roleProb);

    expect(views).toEqual([{ championId: 200, source: 'manual', role: 'SUPPORT', confidence: 1 }]);
  });

  it('marks a slot the engine cannot resolve as unresolved', () => {
    const views = enemyRoleViews([{ championId: 999 }], roleProb);

    expect(views).toEqual([
      { championId: 999, source: 'unresolved', role: null, confidence: null },
    ]);
  });

  it('marks manually fixed roles dropped as ambiguous as unresolved', () => {
    const views = enemyRoleViews(
      [
        { championId: 200, role: 'SUPPORT' as Role },
        { championId: 201, role: 'SUPPORT' as Role },
      ],
      roleProb,
    );

    expect(views).toEqual([
      { championId: 200, source: 'unresolved', role: null, confidence: null },
      { championId: 201, source: 'unresolved', role: null, confidence: null },
    ]);
  });

  it('recomputes recommendations when the dropdown changes inferred to manual', () => {
    const inferredSlots = [{ championId: 200 }];
    const overriddenSlots = [{ championId: 200, role: 'SUPPORT' as Role }];
    const data = makeRecommendData();

    const [beforeView] = enemyRoleViews(inferredSlots, roleProb);
    const [afterView] = enemyRoleViews(overriddenSlots, roleProb);
    expect(beforeView).toMatchObject({ source: 'inferred', role: 'ADC', confidence: 0.75 });
    expect(afterView).toMatchObject({ source: 'manual', role: 'SUPPORT', confidence: 1 });

    const before = recommend(draftInput(inferredSlots), data).recommendations.find(
      (entry) => entry.championId === 1,
    );
    const after = recommend(draftInput(overriddenSlots), data).recommendations.find(
      (entry) => entry.championId === 1,
    );

    expect(before).toBeDefined();
    expect(after).toBeDefined();
    expect(after?.score).not.toBe(before?.score);
  });
});

describe('formatRoleConfidence', () => {
  it('formats a fraction as a whole percent', () => {
    expect(formatRoleConfidence(0.7)).toBe('70%');
    expect(formatRoleConfidence(1)).toBe('100%');
  });
});
