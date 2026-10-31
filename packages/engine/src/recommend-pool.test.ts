/**
 * Unit tests for candidate set and pool output (SPECS §5, §7, D-024).
 */

import { describe, it, expect } from 'vitest';
import type {
  ChampionId,
  ChampionRoleProbabilities,
  DraftInput,
  InsufficientDataEntry,
} from '@draftorb/shared';
import { DEFAULT_CONFIG } from './config.js';
import type { ScoredCandidate } from './recommend-reasons.js';
import { buildCandidateSet, buildPoolOutput, isBelowRoleThreshold } from './recommend-pool.js';

const roleProb = {
  '1': { SUPPORT: 1 },
  '2': { SUPPORT: 0.05 },
  '3': { SUPPORT: 0.04, TOP: 0.96 },
  '4': { TOP: 1 },
  '200': { SUPPORT: 1 },
} as ChampionRoleProbabilities;
const championIds: ChampionId[] = [1, 2, 3, 4, 200];

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

function scored(id: ChampionId, score: number): ScoredCandidate {
  return { championId: id, score, reasons: [], baselineNEff: 1000, warnings: [] };
}

describe('isBelowRoleThreshold', () => {
  it('accepts a probability exactly at the threshold', () => {
    expect(isBelowRoleThreshold(2, 'SUPPORT', roleProb)).toBe(false);
  });

  it('rejects below the threshold, a missing role and a missing champion', () => {
    expect(isBelowRoleThreshold(3, 'SUPPORT', roleProb)).toBe(true);
    expect(isBelowRoleThreshold(4, 'SUPPORT', roleProb)).toBe(true);
    expect(isBelowRoleThreshold(99, 'SUPPORT', roleProb)).toBe(true);
  });
});

describe('buildCandidateSet', () => {
  it('keeps only on-role champions without a pool', () => {
    const set = buildCandidateSet(input(), championIds, roleProb);
    expect([...set.candidates].sort((a, b) => a - b)).toEqual([1, 2, 200]);
  });

  it('excludes board picks, even when they are in the pool', () => {
    const set = buildCandidateSet(
      input({ enemies: [{ championId: 200 }], allies: [{ championId: 1 }], pool: [200] }),
      championIds,
      roleProb,
    );
    expect(set.candidates.has(200)).toBe(false);
    expect(set.candidates.has(1)).toBe(false);
    expect([...set.picked].sort((a, b) => a - b)).toEqual([1, 200]);
  });

  it('adds off-role pool champions but never unknown ids', () => {
    const set = buildCandidateSet(input({ pool: [4, 999] }), championIds, roleProb);
    expect(set.candidates.has(4)).toBe(true);
    expect(set.candidates.has(999)).toBe(false);
  });

  it('deduplicates the pool', () => {
    const set = buildCandidateSet(input({ pool: [1, 1, 4] }), championIds, roleProb);
    expect(set.poolSet.size).toBe(2);
  });
});

describe('buildPoolOutput', () => {
  it('keeps overall order and rank, and numbers poolRank from 1', () => {
    const set = buildCandidateSet(input({ pool: [2, 4] }), championIds, roleProb);
    const sorted = [scored(1, 0.6), scored(4, 0.55), scored(2, 0.5)];
    const out = buildPoolOutput(set, sorted, [], DEFAULT_CONFIG);
    expect(out.poolRecommendations.map((r) => [r.championId, r.rank, r.poolRank])).toEqual([
      [4, 2, 1],
      [2, 3, 2],
    ]);
    expect(out.poolUnavailable).toEqual([]);
  });

  it('reports picked, unknownChampion and insufficientData once each', () => {
    const set = buildCandidateSet(
      input({ enemies: [{ championId: 200 }], pool: [200, 999, 999, 3] }),
      championIds,
      roleProb,
    );
    const insufficient: InsufficientDataEntry[] = [{ championId: 3, nEff: 4 }];
    const out = buildPoolOutput(set, [], insufficient, DEFAULT_CONFIG);
    expect(out.poolUnavailable).toEqual([
      { championId: 200, reason: 'picked' },
      { championId: 999, reason: 'unknownChampion' },
      { championId: 3, reason: 'insufficientData' },
    ]);
    expect(out.poolRecommendations).toEqual([]);
  });

  it('ignores insufficientData entries for champions outside the pool', () => {
    const set = buildCandidateSet(input({ pool: [1] }), championIds, roleProb);
    const out = buildPoolOutput(
      set,
      [scored(1, 0.5)],
      [{ championId: 2, nEff: 1 }],
      DEFAULT_CONFIG,
    );
    expect(out.poolUnavailable).toEqual([]);
    expect(out.poolRecommendations.map((r) => r.championId)).toEqual([1]);
  });
});
