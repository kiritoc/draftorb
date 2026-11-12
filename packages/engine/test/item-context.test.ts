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
  starterWindowSeconds: 45,
  stateZAhead: 1,
  minStateMatches: 30,
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

describe('Phase B helpers', () => {
  it('netPurchasedItems nets purchase/sold/undo/destroyed deterministically', async () => {
    const { netPurchasedItems } = await import('../src/item-context');
    const events = [
      {
        ts: 1000,
        seq: 0,
        event_type: 'purchase' as const,
        item_id: 1,
        before_id: null,
        after_id: null,
      },
      {
        ts: 2000,
        seq: 0,
        event_type: 'purchase' as const,
        item_id: 2,
        before_id: null,
        after_id: null,
      },
      {
        ts: 3000,
        seq: 0,
        event_type: 'sold' as const,
        item_id: 1,
        before_id: null,
        after_id: null,
      },
      { ts: 4000, seq: 0, event_type: 'undo' as const, item_id: 2, before_id: 2, after_id: null },
      {
        ts: 5000,
        seq: 0,
        event_type: 'purchase' as const,
        item_id: 3,
        before_id: null,
        after_id: null,
      },
      {
        ts: 6000,
        seq: 0,
        event_type: 'destroyed' as const,
        item_id: 3,
        before_id: null,
        after_id: null,
      },
    ];
    const owned = netPurchasedItems(events);
    expect([...owned.entries()]).toEqual([]);
    const partial = netPurchasedItems(events.slice(0, 4));
    expect(partial.get(1)).toBeUndefined();
    expect(partial.get(2)).toBeUndefined();
  });

  it('ownedItemsAt ignores later events (no leakage)', async () => {
    const { ownedItemsAt } = await import('../src/item-context');
    const events = [
      {
        ts: 1000,
        seq: 0,
        event_type: 'purchase' as const,
        item_id: 1,
        before_id: null,
        after_id: null,
      },
      {
        ts: 9000,
        seq: 0,
        event_type: 'purchase' as const,
        item_id: 2,
        before_id: null,
        after_id: null,
      },
    ];
    const at = ownedItemsAt(events, 5000);
    expect(at.has(1)).toBe(true);
    expect(at.has(2)).toBe(false);
  });

  it('starterBundleKey is stable and window-bounded', async () => {
    const { starterBundleKey } = await import('../src/item-context');
    const events = [
      {
        ts: 5_000,
        seq: 0,
        event_type: 'purchase' as const,
        item_id: 3865,
        before_id: null,
        after_id: null,
      },
      {
        ts: 10_000,
        seq: 0,
        event_type: 'purchase' as const,
        item_id: 2003,
        before_id: null,
        after_id: null,
      },
      {
        ts: 60_000,
        seq: 0,
        event_type: 'purchase' as const,
        item_id: 9001,
        before_id: null,
        after_id: null,
      },
    ];
    expect(starterBundleKey(events, 45)).toBe('2003:1,3865:1');
    expect(starterBundleKey(events, 45)).toBe(starterBundleKey([...events].reverse(), 45));
  });

  it('stateBucket timeNormalized uses z-score and falls back without scale', async () => {
    const { stateBucket } = await import('../src/item-context');
    const c = DEFAULT_ITEM_CONTEXT_CONFIG;
    // gold diff 3000, sd 1000 -> z=3 >= 1 -> ahead even though kills even.
    expect(stateBucket(3000, 0, c, 'timeNormalized', 1000)).toBe('ahead');
    expect(stateBucket(-3000, 0, c, 'timeNormalized', 1000)).toBe('behind');
    expect(stateBucket(500, 0, c, 'timeNormalized', 1000)).toBe('even');
    // No sd -> legacy absolute: 3000 >= 2000 still ahead; 500 even.
    expect(stateBucket(500, 0, c, 'timeNormalized', undefined)).toBe('even');
    expect(stateBucket(500, 5, c, 'timeNormalized', undefined)).toBe('ahead');
    expect(stateBucket(500, 0, c, 'legacyAbsolute')).toBe('even');
  });

  it('laneArchKey extracts the most influential champion archetype', async () => {
    const { laneArchKey } = await import('../src/item-context');
    const tags = {
      '21': { archetype: 'marksman', damageType: 'AD' },
    } as unknown as Parameters<typeof laneArchKey>[1];
    expect(laneArchKey('lane:0.ADC:21|1.SUPPORT:266', tags)).toBe('marksman');
    expect(laneArchKey('', tags)).toBe('');
    expect(laneArchKey('lane:0.ADC:999', tags)).toBe('');
  });
});
