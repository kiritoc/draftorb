/**
 * Unit tests for the starter-bundle recommender (BL-031b, SPECS §8.3/§18.5).
 */

import { describe, it, expect } from 'vitest';

import {
  starterRecommendationResultSchema,
  type ChampionRoleProbabilities,
  type DraftInput,
  type RankBucket,
  type Role,
  type StarterBundleItem,
  type StarterBundlePick,
  type StarterChampionExport,
  type StarterContextEntry,
  type StarterRecommendData,
  type StarterRoleExport,
} from '@draftorb/shared';
import { DEFAULT_CONFIG, DEFAULT_STARTER_CONFIG } from '../src/config.js';
import { recommendStarters } from '../src/starters.js';

const CHAMP = 7;
/** SUPPORT lane group: ally ADC 10, enemy SUPPORT 20 + ADC 30 (contextSlots=3). */
const LANE_KEY = 'lane:a.ADC:10|e.SUPPORT:20|e.ADC:30';

function roleProbMap(): ChampionRoleProbabilities {
  const entries: Record<string, Partial<Record<Role, number>>> = {
    '7': { SUPPORT: 1 },
    '10': { ADC: 1 },
    '20': { SUPPORT: 1 },
    '30': { ADC: 1 },
    '40': { TOP: 1 },
    '50': { JUNGLE: 1 },
    '60': { MID: 1 },
  };
  return entries as ChampionRoleProbabilities;
}

function starterData(): StarterRecommendData {
  return { roleProb: roleProbMap() };
}

function draft(overrides: Partial<DraftInput> = {}): DraftInput {
  return {
    userRank: 'DIAMOND',
    userRole: 'SUPPORT',
    allies: [{ championId: 10, role: 'ADC' }],
    enemies: [
      { championId: 20, role: 'SUPPORT' },
      { championId: 30, role: 'ADC' },
      { championId: 40, role: 'TOP' },
      { championId: 50, role: 'JUNGLE' },
      { championId: 60, role: 'MID' },
    ],
    blindPick: false,
    ...overrides,
  };
}

function items(...pairs: Array<[number, number]>): StarterBundleItem[] {
  return pairs.map(([itemId, count]) => ({ itemId, count }));
}

interface BundleOpts {
  pickShare?: number;
  players?: number;
}

function mkBundle(
  bundleItems: StarterBundleItem[],
  winsW: number,
  gamesW: number,
  gamesW2: number,
  opts: BundleOpts = {},
): StarterBundlePick {
  return {
    items: bundleItems,
    winsW,
    gamesW,
    gamesW2,
    winrate: gamesW > 0 ? winsW / gamesW : 0,
    pickShare: opts.pickShare ?? 0.5,
    ...(opts.players !== undefined ? { players: opts.players } : {}),
  };
}

function ctx(
  contextKey: string,
  contextLevel: number,
  bundles: StarterBundlePick[],
  rankBucket: RankBucket = 'DIAMOND',
): StarterContextEntry {
  return { rankBucket, contextKey, contextLevel, bundles };
}

function champExp(
  contexts: StarterContextEntry[],
  championId: number = CHAMP,
  myRole: Role = 'SUPPORT',
): StarterChampionExport {
  return { championId, myRole, contexts };
}

function roleExp(contexts: StarterContextEntry[], myRole: Role = 'SUPPORT'): StarterRoleExport {
  return { myRole, contexts };
}

const BLADE = items([2052, 1]);
const SERRATED = items([2053, 1]);
const BOOTS_PAIR = items([2052, 1], [3340, 1]);

describe('recommendStarters', () => {
  it('scores bundles from the champion context with evidence fields', () => {
    const strong = mkBundle(BLADE, 30, 40, 40, { pickShare: 0.6, players: 12 });
    const weak = mkBundle(SERRATED, 20, 40, 40, { pickShare: 0.4 });
    const result = recommendStarters(
      draft(),
      CHAMP,
      champExp([ctx('champion', 2, [strong, weak])]),
      roleExp([ctx('role', 3, [strong]), ctx('global', 4, [strong])]),
      starterData(),
    );

    expect(result.dataAvailable).toBe(true);
    expect(result.schemaVersion).toBe(1);
    expect(result.myRole).toBe('SUPPORT');
    expect(result.bundles).toHaveLength(2);
    const top = result.bundles[0];
    expect(top?.items).toEqual(BLADE);
    expect(top?.contextKey).toBe('champion');
    expect(top?.contextLevel).toBe(2);
    // n_eff = gamesW^2 / gamesW2 = 1600/40 = 40.
    expect(top?.nEff).toBeCloseTo(40, 6);
    expect(top?.players).toBe(12);
    expect(top?.pickShare).toBe(0.6);
    expect(top?.lowData).toBe(false);
    expect(top?.winRate).toBeGreaterThan(result.bundles[1]?.winRate ?? 0);
    expect(() => starterRecommendationResultSchema.parse(result)).not.toThrow();
  });

  it('prefers the exact lane context over the champion context', () => {
    const laneBundle = mkBundle(BLADE, 9, 10, 10);
    const champBundle = mkBundle(SERRATED, 30, 40, 40);
    const result = recommendStarters(
      draft(),
      CHAMP,
      champExp([ctx(LANE_KEY, 1, [laneBundle]), ctx('champion', 2, [champBundle])]),
      roleExp([ctx('role', 3, [champBundle]), ctx('global', 4, [champBundle])]),
      starterData(),
    );

    const lanePick = result.bundles.find((b) => b.items[0]?.itemId === 2052);
    expect(lanePick?.contextKey).toBe(LANE_KEY);
    expect(lanePick?.contextLevel).toBe(1);
  });

  it('falls back to the role export when the champion export is absent', () => {
    const roleBundle = mkBundle(BLADE, 30, 40, 40, { players: 9 });
    const result = recommendStarters(
      draft(),
      CHAMP,
      undefined,
      roleExp([ctx('role', 3, [roleBundle]), ctx('global', 4, [roleBundle])]),
      starterData(),
    );

    expect(result.dataAvailable).toBe(true);
    expect(result.bundles[0]?.contextKey).toBe('role');
    expect(result.bundles[0]?.contextLevel).toBe(3);
  });

  it('uses the global level when only the global context exists', () => {
    const globalBundle = mkBundle(BLADE, 30, 40, 40);
    const result = recommendStarters(
      draft(),
      CHAMP,
      undefined,
      roleExp([ctx('global', 4, [globalBundle])]),
      starterData(),
    );

    expect(result.dataAvailable).toBe(true);
    expect(result.bundles[0]?.contextLevel).toBe(4);
  });

  it('treats a mismatched champion or role export as absent', () => {
    const bundle = mkBundle(BLADE, 30, 40, 40);
    const result = recommendStarters(
      draft(),
      CHAMP,
      champExp([ctx('champion', 2, [bundle])], 999),
      roleExp([ctx('role', 3, [bundle])], 'TOP'),
      starterData(),
    );
    expect(result.dataAvailable).toBe(false);
    expect(result.bundles).toEqual([]);
  });

  it('shrinks a bundle toward its estimate in the next broader context', () => {
    const laneBundle = mkBundle(BLADE, 9, 10, 10);
    const globalSame = mkBundle(BLADE, 40, 100, 100);
    const globalOther = mkBundle(SERRATED, 55, 100, 100);
    const result = recommendStarters(
      draft(),
      CHAMP,
      champExp([ctx(LANE_KEY, 1, [laneBundle])]),
      roleExp([ctx('global', 4, [globalSame, globalOther])]),
      starterData(),
    );

    expect(result.bundles).toHaveLength(2);
    // Same math as recommendSummoners: globalOther wins the shrunk ranking.
    expect(result.bundles[0]?.items).toEqual(SERRATED);
    expect(result.bundles[0]?.winRate).toBeCloseTo(75 / 140, 6);
    expect(result.bundles[1]?.contextKey).toBe(LANE_KEY);
    expect(result.bundles[1]?.winRate).toBeCloseTo((9 + (40 * 60) / 140) / 50, 6);
  });

  it('merges duplicate bundle keys within one context', () => {
    const a = mkBundle(BLADE, 10, 20, 20);
    const b = mkBundle(BLADE, 10, 20, 20);
    const result = recommendStarters(
      draft(),
      CHAMP,
      champExp([ctx('champion', 2, [a, b])]),
      undefined,
      starterData(),
    );
    expect(result.bundles).toHaveLength(1);
    // Merged n_eff = (40)^2 / 40 = 40.
    expect(result.bundles[0]?.nEff).toBeCloseTo(40, 6);
  });

  it('returns no data for an empty draft lane and no exports', () => {
    const result = recommendStarters(
      draft({ allies: [], enemies: [] }),
      CHAMP,
      undefined,
      undefined,
      starterData(),
    );
    expect(result.dataAvailable).toBe(false);
    expect(result.bundles).toEqual([]);
  });

  it('restricts evidence to MASTER_PLUS when the toggle is on', () => {
    const bundle = mkBundle(BLADE, 30, 40, 40);
    const result = recommendStarters(
      draft(),
      CHAMP,
      champExp([ctx('champion', 2, [bundle])]),
      undefined,
      starterData(),
      { ...DEFAULT_CONFIG, evidenceMasterPlusOnly: true },
    );
    expect(result.dataAvailable).toBe(false);
    expect(result.bundles).toEqual([]);
  });

  it('flags thin bundles as lowData below minGames', () => {
    const bundle = mkBundle(BLADE, 9, 10, 10); // n_eff = 10 < minGames 25
    const result = recommendStarters(
      draft(),
      CHAMP,
      champExp([ctx('champion', 2, [bundle])]),
      undefined,
      starterData(),
    );
    expect(result.bundles[0]?.lowData).toBe(true);
  });

  it('honors a custom topBundles count', () => {
    const bundles = [BLADE, SERRATED, BOOTS_PAIR].map((b, i) =>
      mkBundle(b, 30 - i * 5, 40, 40, { pickShare: 0.5 - i * 0.1 }),
    );
    const result = recommendStarters(
      draft(),
      CHAMP,
      champExp([ctx('champion', 2, bundles)]),
      undefined,
      starterData(),
      DEFAULT_CONFIG,
      { ...DEFAULT_STARTER_CONFIG, topBundles: 2 },
    );
    expect(result.bundles).toHaveLength(2);
  });
});
