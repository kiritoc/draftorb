/**
 * Unit tests for the summoner-spell-pair recommender (BL-031a, SPECS §8.1).
 */

import { describe, it, expect } from 'vitest';

import {
  summonerRecommendationResultSchema,
  type ChampionRoleProbabilities,
  type ChampionTagsMap,
  type DamageType,
  type DraftInput,
  type RankBucket,
  type Role,
  type SummonerContextEntry,
  type SummonerExport,
  type SummonerPairExport,
  type SummonerRecommendData,
} from '@draftorb/shared';
import { DEFAULT_CONFIG, DEFAULT_SUMMONER_CONFIG } from '../src/config.js';
import { recommendSummoners } from '../src/summoners.js';
import { makeTag } from '../src/recommend-test-utils.js';

const LANE3_KEY = 'lane:a.ADC:10,e.SUPPORT:20,e.ADC:30';
const LANE1_KEY = 'lane:a.ADC:10';
const CHAMP = 7;

function roleProbMap(): ChampionRoleProbabilities {
  const entries: Record<string, Partial<Record<Role, number>>> = {
    '7': { SUPPORT: 1 },
    '8': { SUPPORT: 1 },
    '9': { SUPPORT: 1 },
    '10': { ADC: 1 },
    '20': { SUPPORT: 1 },
    '30': { ADC: 1 },
    '40': { TOP: 1 },
    '50': { JUNGLE: 1 },
    '60': { MID: 1 },
  };
  return entries as ChampionRoleProbabilities;
}

function tagsMap(types: Record<number, DamageType>): ChampionTagsMap {
  const map: ChampionTagsMap = {};
  for (const [id, damageType] of Object.entries(types)) {
    map[id] = makeTag(Number(id), { damageType });
  }
  return map;
}

function mixedTags(): ChampionTagsMap {
  return tagsMap({
    10: 'MIXED',
    20: 'MIXED',
    30: 'MIXED',
    40: 'MIXED',
    50: 'MIXED',
    60: 'MIXED',
  });
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

function summonerData(tags: ChampionTagsMap = mixedTags()): SummonerRecommendData {
  return { roleProb: roleProbMap(), tags };
}

interface PairOpts {
  pickShare?: number;
  players?: number;
}

function mkPair(
  summoner1Id: number,
  summoner2Id: number,
  winsW: number,
  gamesW: number,
  gamesW2: number,
  opts: PairOpts = {},
): SummonerPairExport {
  return {
    summoner1Id,
    summoner2Id,
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
  pairs: SummonerPairExport[],
  rankBucket: RankBucket = 'DIAMOND',
): SummonerContextEntry {
  return { rankBucket, contextKey, contextLevel, pairs };
}

function summonerExp(
  contexts: SummonerContextEntry[],
  championId: number = CHAMP,
  myRole: Role = 'SUPPORT',
): SummonerExport {
  return { championId, myRole, contexts };
}

describe('recommendSummoners', () => {
  it('scores pairs from the most specific lane context', () => {
    // n_eff = gamesW^2 / gamesW2 = 1600/40 = 40 for both pairs.
    const strong = mkPair(4, 7, 30, 40, 40, { pickShare: 0.6, players: 12 });
    const weak = mkPair(4, 14, 20, 40, 40, { pickShare: 0.4 });
    const exportData = summonerExp([
      ctx(LANE3_KEY, 1, [strong, weak]),
      ctx(LANE1_KEY, 3, [strong, weak]),
      ctx('damagemix:mixed', 4, [strong, weak]),
      ctx('global', 5, [strong, weak]),
    ]);

    const result = recommendSummoners(draft(), CHAMP, exportData, summonerData());

    expect(result.dataAvailable).toBe(true);
    expect(result.schemaVersion).toBe(1);
    expect(result.myRole).toBe('SUPPORT');
    expect(result.damageMix).toBe('mixed');
    expect(result.pairs).toHaveLength(2);
    const top = result.pairs[0];
    expect(top?.summoner1Id).toBe(4);
    expect(top?.summoner2Id).toBe(7);
    expect(top?.contextKey).toBe(LANE3_KEY);
    expect(top?.contextLevel).toBe(1);
    expect(top?.nEff).toBeCloseTo(40, 6);
    expect(top?.players).toBe(12);
    expect(top?.lowData).toBe(false);
    expect(top?.winRate).toBeGreaterThan(result.pairs[1]?.winRate ?? 0);
    expect(() => summonerRecommendationResultSchema.parse(result)).not.toThrow();
  });

  it('keeps pairs normalized as [minId, maxId]', () => {
    // Export rows are already normalized by the ETL; the engine passes them
    // through and merges duplicate pair keys defensively.
    const pair = mkPair(4, 14, 30, 40, 40);
    const exportData = summonerExp([ctx('global', 5, [pair])]);

    const result = recommendSummoners(draft(), CHAMP, exportData, summonerData());

    expect(result.pairs[0]?.summoner1Id).toBe(4);
    expect(result.pairs[0]?.summoner2Id).toBe(14);
    expect(result.pairs[0]?.summoner1Id).toBeLessThan(result.pairs[0]?.summoner2Id ?? 0);
  });

  it('shrinks a pair toward its estimate in the next broader context', () => {
    const lanePair = mkPair(4, 14, 9, 10, 10); // eq counts 9/10
    const globalSame = mkPair(4, 14, 40, 100, 100); // eq counts 40/100
    const globalOther = mkPair(4, 7, 55, 100, 100); // eq counts 55/100
    const exportData = summonerExp([
      ctx(LANE3_KEY, 1, [lanePair]),
      ctx('global', 5, [globalSame, globalOther]),
    ]);

    const result = recommendSummoners(draft(), CHAMP, exportData, summonerData());

    expect(result.pairs).toHaveLength(2);
    // globalOther: (55 + 40*0.5) / (100 + 40) = 75/140 ≈ 0.5357
    expect(result.pairs[0]?.summoner1Id).toBe(4);
    expect(result.pairs[0]?.summoner2Id).toBe(7);
    expect(result.pairs[0]?.winRate).toBeCloseTo(75 / 140, 6);
    // lanePair: global est (40+20)/140 = 3/7, then (9 + 40*3/7)/(10+40)
    expect(result.pairs[1]?.summoner1Id).toBe(4);
    expect(result.pairs[1]?.summoner2Id).toBe(14);
    expect(result.pairs[1]?.contextKey).toBe(LANE3_KEY);
    expect(result.pairs[1]?.winRate).toBeCloseTo((9 + (40 * 60) / 140) / 50, 6);
  });

  it('shrinks toward 0.5 when the pair has no broader context', () => {
    const pair = mkPair(4, 14, 9, 10, 10);
    const exportData = summonerExp([ctx(LANE3_KEY, 1, [pair])]);

    const result = recommendSummoners(draft(), CHAMP, exportData, summonerData());

    expect(result.pairs[0]?.winRate).toBeCloseTo(0.58, 6);
    expect(result.pairs[0]?.lowData).toBe(true); // n_eff = 10 < minGames 25
  });

  it('reports insufficient data when no export or context matches', () => {
    const result = recommendSummoners(draft(), CHAMP, undefined, summonerData());
    expect(result.dataAvailable).toBe(false);
    expect(result.pairs).toEqual([]);

    const otherRole = summonerExp([ctx('global', 5, [mkPair(4, 7, 30, 40, 40)])], CHAMP, 'TOP');
    const mismatched = recommendSummoners(draft(), CHAMP, otherRole, summonerData());
    expect(mismatched.dataAvailable).toBe(false);
  });

  it('restricts evidence to MASTER_PLUS when evidenceMasterPlusOnly is set', () => {
    const diamondPair = mkPair(4, 7, 30, 40, 40, { players: 12 });
    const masterPair = mkPair(4, 14, 35, 40, 40, { players: 9 });
    const exportData = summonerExp([
      ctx('global', 5, [diamondPair], 'DIAMOND'),
      ctx('global', 5, [masterPair], 'MASTER_PLUS'),
    ]);

    const config = { ...DEFAULT_CONFIG, evidenceMasterPlusOnly: true };
    const result = recommendSummoners(draft(), CHAMP, exportData, summonerData(), config);

    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]?.summoner1Id).toBe(4);
    expect(result.pairs[0]?.summoner2Id).toBe(14);
  });

  it('caps the returned pairs at topPairs', () => {
    const pairs = [
      mkPair(4, 7, 30, 40, 40),
      mkPair(4, 14, 25, 40, 40),
      mkPair(11, 4, 20, 40, 40),
      mkPair(3, 4, 15, 40, 40),
    ];
    const exportData = summonerExp([ctx('global', 5, pairs)]);

    const result = recommendSummoners(draft(), CHAMP, exportData, summonerData());

    expect(result.pairs).toHaveLength(DEFAULT_SUMMONER_CONFIG.topPairs);
  });

  it('is deterministic for identical input', () => {
    const exportData = summonerExp([
      ctx(LANE3_KEY, 1, [mkPair(4, 7, 30, 40, 40), mkPair(4, 14, 25, 40, 40)]),
      ctx('global', 5, [mkPair(4, 7, 28, 90, 90)]),
    ]);
    const a = recommendSummoners(draft(), CHAMP, exportData, summonerData());
    const b = recommendSummoners(draft(), CHAMP, exportData, summonerData());
    expect(a).toEqual(b);
  });
});
