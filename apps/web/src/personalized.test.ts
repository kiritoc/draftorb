/**
 * computePersonalizedEntries: the personalized list obeys the same
 * user-pick exclusion as the overall/pool lists (T-096, D-024 invariant).
 */

import { describe, expect, it } from 'vitest';

import {
  PROFILE_EXPORT_SCHEMA_VERSION,
  type DraftInput,
  type ProfileExport,
  type Recommendation,
  type RecommendData,
} from '@draftorb/shared';

import { computePersonalizedEntries } from './personalized.js';

function rec(championId: number, rank: number): Recommendation {
  return {
    championId,
    rank,
    score: 0.6 - rank * 0.01,
    reasons: [],
    reliability: { nEff: 100, lowData: false },
    warnings: [],
  };
}

const profile: ProfileExport = {
  schemaVersion: PROFILE_EXPORT_SCHEMA_VERSION,
  id: 'test-profile',
  riotId: { gameName: 'Test', tagLine: 'One', platform: 'EUW1' },
  label: "Test's picks",
  syncedAt: 1_760_000_000,
  gameCount: 0,
  favorites: { combined: [], recency: [], mastery: [] },
  games: [],
  mastery: [],
};

const draftInput: DraftInput = {
  userRank: 'DIAMOND',
  userRole: 'SUPPORT',
  allies: [],
  enemies: [],
  blindPick: false,
};

const data = {
  baselines: [],
  allyPairs: [],
  enemyPairs: [],
  laneVs: [],
  laneFull: [],
  roleProb: {},
  tags: {},
  championIds: [10, 20, 30],
} as unknown as RecommendData;

describe('computePersonalizedEntries', () => {
  it('excludes the user-picked champion like the other lists', () => {
    const entries = computePersonalizedEntries(
      [rec(10, 1), rec(20, 2), rec(30, 3)],
      profile,
      draftInput,
      data,
      20,
      { rank: 2 },
      1_760_000_000_000,
    );
    expect(entries.map((entry) => entry.championId)).toEqual([10, 30]);
    expect(entries.map((entry) => entry.rank)).toEqual([1, 2]);
  });

  it('keeps every recommendation when nothing is picked', () => {
    const entries = computePersonalizedEntries(
      [rec(10, 1), rec(20, 2), rec(30, 3)],
      profile,
      draftInput,
      data,
      null,
      {},
      1_760_000_000_000,
    );
    expect(entries.map((entry) => entry.championId)).toEqual([10, 20, 30]);
  });
});
