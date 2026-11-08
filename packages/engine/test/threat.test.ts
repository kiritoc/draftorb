import { describe, expect, it } from 'vitest';

import type { ChampionTagsMap, ItemsMap, PlayerState } from '@draftorb/shared';
import { DEFAULT_THREAT_CONFIG } from '../src/config.js';
import { computeThreatScores } from '../src/threat.js';
import { makeTag } from '../src/recommend-test-utils.js';

function makeItems(goldById: Record<number, number>): ItemsMap {
  const map: Record<string, ItemsMap[string]> = {};
  for (const [id, gold] of Object.entries(goldById)) {
    map[id] = {
      id: Number(id),
      name: `Item ${id}`,
      icon: `item-${id}.png`,
      goldTotal: gold,
      purchasable: true,
      tags: [],
      from: [],
      into: [],
      stats: {},
    };
  }
  return map as ItemsMap;
}

function makeTags(
  scalingByChamp: Record<number, { early: boolean; mid: boolean; late: boolean }>,
): ChampionTagsMap {
  const map: Record<string, ReturnType<typeof makeTag>> = {};
  for (const [id, scaling] of Object.entries(scalingByChamp)) {
    map[id] = makeTag(Number(id), { scaling });
  }
  return map as ChampionTagsMap;
}

function player(overrides: Partial<PlayerState> & { championId: number }): PlayerState {
  return {
    kills: 0,
    deaths: 0,
    assists: 0,
    items: [],
    ...overrides,
  };
}

const ITEMS = makeItems({ 3089: 2500, 2052: 900, 9999: 4000 });
const TAGS = makeTags({
  1: { early: true, mid: false, late: false },
  2: { early: false, mid: true, late: true },
});

describe('computeThreatScores (SPECS §8.2.2)', () => {
  it('returns empty results for no enemies', () => {
    expect(computeThreatScores([], 600, ITEMS, TAGS)).toEqual({ threats: [], shares: [] });
  });

  it('gives a fed enemy (high KDA + expensive items) the largest threat share', () => {
    const enemies = [
      player({ championId: 1, kills: 12, deaths: 1, assists: 4, items: [3089, 2052] }),
      player({ championId: 1, kills: 1, deaths: 5, assists: 2, items: [2052] }),
      player({ championId: 1, kills: 2, deaths: 3, assists: 3 }),
    ];
    const { threats, shares } = computeThreatScores(enemies, 900, ITEMS, TAGS);
    expect(threats[0]).toBeGreaterThan(threats[1] ?? 0);
    expect(threats[0]).toBeGreaterThan(threats[2] ?? 0);
    expect(shares[0]).toBeGreaterThan(shares[1] ?? 0);
    expect(shares[0]).toBeGreaterThan(shares[2] ?? 0);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it('splits shares evenly for identical players', () => {
    const enemies = [
      player({ championId: 2, kills: 3, deaths: 2, assists: 5, items: [3089] }),
      player({ championId: 2, kills: 3, deaths: 2, assists: 5, items: [3089] }),
      player({ championId: 2, kills: 3, deaths: 2, assists: 5, items: [3089] }),
    ];
    const { shares } = computeThreatScores(enemies, 900, ITEMS, TAGS);
    for (const s of shares) expect(s).toBeCloseTo(1 / 3, 10);
  });

  it('weights KDA through (K + 0.5*A) / (D + 1)', () => {
    const fed = computeThreatScores(
      [player({ championId: 1, kills: 10, deaths: 0, assists: 0 })],
      600,
      ITEMS,
      TAGS,
    );
    const weak = computeThreatScores(
      [player({ championId: 1, kills: 0, deaths: 8, assists: 0 })],
      600,
      ITEMS,
      TAGS,
    );
    expect(fed.threats[0]).toBeGreaterThan(weak.threats[0] ?? 0);
    // Deaths dampen: 10/0/0 vs 10/8/0.
    const deaths = computeThreatScores(
      [player({ championId: 1, kills: 10, deaths: 8, assists: 0 })],
      600,
      ITEMS,
      TAGS,
    );
    expect(fed.threats[0]).toBeGreaterThan(deaths.threats[0] ?? 0);
  });

  it('normalizes item gold by the average item gold at game time', () => {
    // Same items at 10min vs 30min: the earlier purchase is a larger share
    // of the expected item gold curve.
    const early = computeThreatScores([player({ championId: 1, items: [3089] })], 600, ITEMS, TAGS);
    const late = computeThreatScores([player({ championId: 1, items: [3089] })], 1800, ITEMS, TAGS);
    expect(early.threats[0]).toBeGreaterThan(late.threats[0] ?? 0);
  });

  it('scales threat by the champion scaling factor (late > early)', () => {
    const late = computeThreatScores(
      [player({ championId: 2, kills: 4, deaths: 2, assists: 6 })],
      900,
      ITEMS,
      TAGS,
    );
    const early = computeThreatScores(
      [player({ championId: 1, kills: 4, deaths: 2, assists: 6 })],
      900,
      ITEMS,
      TAGS,
    );
    expect(late.threats[0]).toBeGreaterThan(early.threats[0] ?? 0);
  });

  it('ignores unknown item ids and falls back to neutral scaling for untagged champions', () => {
    const enemies = [
      player({ championId: 777, kills: 5, deaths: 1, assists: 5, items: [12345] }),
      player({ championId: 1, kills: 5, deaths: 1, assists: 5 }),
    ];
    const { threats, shares } = computeThreatScores(enemies, 900, ITEMS, TAGS);
    // Untagged champion gets the neutral scaling factor; the tagged early
    // scaler (champion 1) scores lower on the scaling term.
    expect(threats[0]).toBeGreaterThan(threats[1] ?? 0);
    expect(shares[0]).toBeGreaterThan(0.5);
  });

  it('returns zero shares when every threat is zero', () => {
    const zeroConfig = {
      ...DEFAULT_THREAT_CONFIG,
      kdaWeight: 0,
      itemGoldWeight: 0,
      scalingWeight: 0,
    };
    const { threats, shares } = computeThreatScores(
      [player({ championId: 1 })],
      600,
      ITEMS,
      TAGS,
      zeroConfig,
    );
    expect(threats).toEqual([0]);
    expect(shares).toEqual([0]);
  });

  it('is deterministic and accepts a custom config', () => {
    const enemies = [
      player({ championId: 2, kills: 7, deaths: 3, assists: 9, items: [3089, 2052, 9999] }),
      player({ championId: 1, kills: 2, deaths: 6, assists: 1 }),
    ];
    const a = computeThreatScores(enemies, 1200, ITEMS, TAGS);
    const b = computeThreatScores(enemies, 1200, ITEMS, TAGS);
    expect(a).toEqual(b);
    const custom = computeThreatScores(enemies, 1200, ITEMS, TAGS, {
      ...DEFAULT_THREAT_CONFIG,
      kdaWeight: 0,
    });
    expect(custom.threats[0]).not.toBe(a.threats[0]);
  });
});
