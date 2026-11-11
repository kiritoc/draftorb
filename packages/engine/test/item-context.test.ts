import { describe, expect, it } from 'vitest';

import type { ChampionTagsMap } from '@draftorb/shared';

import { DEFAULT_ITEM_CONTEXT_CONFIG } from '../src/config';
import {
  itemPhase,
  itemStateBucket,
  itemTimeBucket,
  threatWeightedDamageProfile,
} from '../src/item-context';
import type { ItemContextConfig } from '../src/config';

const cfg: ItemContextConfig = {
  laneEndSeconds: 840,
  timeBucketSeconds: 300,
  stateAheadGoldDiff: 2000,
  stateAheadKillsDiff: 3,
  stateBehindGoldDiff: 2000,
  stateBehindKillsDiff: 3,
};

describe('itemTimeBucket', () => {
  it('buckets purchase seconds into 5-minute ranges', () => {
    expect(itemTimeBucket(0, cfg)).toBe('0-5');
    expect(itemTimeBucket(299, cfg)).toBe('0-5');
    expect(itemTimeBucket(300, cfg)).toBe('5-10');
    expect(itemTimeBucket(839, cfg)).toBe('10-15');
    expect(itemTimeBucket(1500, cfg)).toBe('25-30');
  });

  it('clamps negative timestamps to the first bucket', () => {
    expect(itemTimeBucket(-1, cfg)).toBe('0-5');
  });

  it('uses the default config', () => {
    expect(itemTimeBucket(600)).toBe('10-15');
    expect(itemTimeBucket(600, DEFAULT_ITEM_CONTEXT_CONFIG)).toBe('10-15');
  });
});

describe('itemStateBucket', () => {
  it('is even inside both thresholds', () => {
    expect(itemStateBucket(0, 0, cfg)).toBe('even');
    expect(itemStateBucket(1999, 2, cfg)).toBe('even');
    expect(itemStateBucket(-1999, -2, cfg)).toBe('even');
  });

  it('is ahead on gold diff alone', () => {
    expect(itemStateBucket(2000, 0, cfg)).toBe('ahead');
    expect(itemStateBucket(5000, -5, cfg)).toBe('ahead');
  });

  it('is ahead on kills diff alone', () => {
    expect(itemStateBucket(0, 3, cfg)).toBe('ahead');
    expect(itemStateBucket(-5000, 3, cfg)).toBe('ahead');
  });

  it('is behind symmetrically', () => {
    expect(itemStateBucket(-2000, 0, cfg)).toBe('behind');
    expect(itemStateBucket(0, -3, cfg)).toBe('behind');
    expect(itemStateBucket(-5000, 2, cfg)).toBe('behind');
  });

  it('resolves conflicting signals deterministically (ahead checked first)', () => {
    // The OR-rule checks `ahead` before `behind`, so any ahead signal wins:
    // gold +5000 beats kills -3, and kills +3 beats gold -5000.
    expect(itemStateBucket(5000, -3, cfg)).toBe('ahead');
    expect(itemStateBucket(-5000, 3, cfg)).toBe('ahead');
    // With no ahead signal, a behind signal still applies.
    expect(itemStateBucket(-5000, 2, cfg)).toBe('behind');
  });
});

describe('itemPhase', () => {
  it('is lane for slot 0 at any time', () => {
    expect(itemPhase(0, 0, cfg)).toBe('lane');
    expect(itemPhase(0, 5000, cfg)).toBe('lane');
  });

  it('is lane for slot 1 bought before laneEndSeconds', () => {
    expect(itemPhase(1, 839.9, cfg)).toBe('lane');
    expect(itemPhase(1, 0, cfg)).toBe('lane');
  });

  it('is mid for slot 1 at or after laneEndSeconds', () => {
    expect(itemPhase(1, 840, cfg)).toBe('mid');
    expect(itemPhase(1, 2000, cfg)).toBe('mid');
  });

  it('is mid for slots >= 2', () => {
    expect(itemPhase(2, 100, cfg)).toBe('mid');
    expect(itemPhase(6, 3000, cfg)).toBe('mid');
  });
});

describe('threatWeightedDamageProfile', () => {
  const tags = {
    '1': { championId: 1, damageType: 'AD' },
    '2': { championId: 2, damageType: 'AP' },
    '3': { championId: 3, damageType: 'MIXED' },
  } as unknown as ChampionTagsMap;

  it('returns AD when AD enemies carry more threat share', () => {
    expect(
      threatWeightedDamageProfile(
        [
          { championId: 1, threatShare: 0.7 },
          { championId: 2, threatShare: 0.3 },
        ],
        tags,
      ),
    ).toBe('AD');
  });

  it('returns AP when AP enemies carry more threat share', () => {
    expect(
      threatWeightedDamageProfile(
        [
          { championId: 1, threatShare: 0.2 },
          { championId: 2, threatShare: 0.8 },
        ],
        tags,
      ),
    ).toBe('AP');
  });

  it('counts MIXED for both sides', () => {
    expect(threatWeightedDamageProfile([{ championId: 3, threatShare: 1 }], tags)).toBe('mixed');
    expect(
      threatWeightedDamageProfile(
        [
          { championId: 1, threatShare: 0.4 },
          { championId: 3, threatShare: 0.6 },
        ],
        tags,
      ),
    ).toBe('AD');
  });

  it('is mixed for ties, untagged and missing tags', () => {
    expect(
      threatWeightedDamageProfile(
        [
          { championId: 1, threatShare: 0.5 },
          { championId: 2, threatShare: 0.5 },
        ],
        tags,
      ),
    ).toBe('mixed');
    expect(threatWeightedDamageProfile([{ championId: 99, threatShare: 1 }], tags)).toBe('mixed');
    expect(threatWeightedDamageProfile([{ championId: 1, threatShare: 1 }], undefined)).toBe(
      'mixed',
    );
  });
});
