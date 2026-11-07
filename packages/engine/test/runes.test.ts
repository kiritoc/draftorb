/**
 * Unit tests for the rune page recommender (T-040, SPECS §8.1).
 */

import { describe, it, expect } from 'vitest';

import {
  runeRecommendationResultSchema,
  type ChampionRoleProbabilities,
  type ChampionTagsMap,
  type DamageType,
  type DraftInput,
  type RankBucket,
  type Role,
  type RuneContextEntry,
  type RuneContextPage,
  type RuneExport,
  type RuneRecommendData,
} from '@draftorb/shared';
import { DEFAULT_RUNE_CONFIG } from '../src/config.js';
import { recommendRunes } from '../src/runes.js';
import { computeEnemyDamageMix } from '../src/runes-context.js';
import { makeTag } from '../src/recommend-test-utils.js';

const LANE3_KEY = 'lane:a.ADC:10,e.SUPPORT:20,e.ADC:30';
const LANE2_KEY = 'lane:a.ADC:10,e.SUPPORT:20';
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

/** All-MIXED tags: no damage signal, mix resolves to 'mixed'. */
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

function runeData(tags: ChampionTagsMap = mixedTags()): RuneRecommendData {
  return { roleProb: roleProbMap(), tags };
}

interface PageOpts {
  pickShare?: number;
  players?: number;
  statShardIds?: number[];
  perks?: number[];
}

function mkPage(
  keystoneId: number,
  winsW: number,
  gamesW: number,
  gamesW2: number,
  opts: PageOpts = {},
): RuneContextPage {
  return {
    primaryStyleId: 8000,
    subStyleId: 8100,
    keystoneId,
    selectedPerkIds: opts.perks ?? [8010, 8020],
    statShardIds: opts.statShardIds ?? [5001, 5002, 5003],
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
  pages: RuneContextPage[],
  rankBucket: RankBucket = 'DIAMOND',
): RuneContextEntry {
  return { rankBucket, contextKey, contextLevel, pages };
}

function runeExp(
  contexts: RuneContextEntry[],
  championId: number = CHAMP,
  myRole: Role = 'SUPPORT',
): RuneExport {
  return { championId, myRole, contexts };
}

describe('computeEnemyDamageMix', () => {
  it('classifies pure and mixed enemy damage', () => {
    expect(computeEnemyDamageMix([10, 20], tagsMap({ 10: 'AD', 20: 'AD' }))).toBe('AD');
    expect(computeEnemyDamageMix([10, 20], tagsMap({ 10: 'AP', 20: 'AP' }))).toBe('AP');
    expect(computeEnemyDamageMix([10, 20], tagsMap({ 10: 'AD', 20: 'AP' }))).toBe('mixed');
    expect(computeEnemyDamageMix([10], tagsMap({ 10: 'MIXED' }))).toBe('mixed');
    expect(computeEnemyDamageMix([10, 20], tagsMap({ 10: 'AD', 20: 'NONE' }))).toBe('AD');
  });

  it('falls back to mixed with no tagged enemy', () => {
    expect(computeEnemyDamageMix([10, 20], {})).toBe('mixed');
    expect(computeEnemyDamageMix([], mixedTags())).toBe('mixed');
  });
});

describe('recommendRunes', () => {
  it('scores pages from the most specific lane context', () => {
    // n_eff = gamesW^2 / gamesW2 = 1600/40 = 40 for both pages.
    const strong = mkPage(8001, 30, 40, 40, { pickShare: 0.6, players: 12 });
    const weak = mkPage(8002, 20, 40, 40, { pickShare: 0.4 });
    const exportData = runeExp([
      ctx(LANE3_KEY, 1, [strong, weak]),
      ctx(LANE2_KEY, 2, [strong, weak]),
      ctx(LANE1_KEY, 3, [strong, weak]),
      ctx('damagemix:mixed', 4, [strong, weak]),
      ctx('global', 5, [strong, weak]),
    ]);

    const result = recommendRunes(draft(), CHAMP, exportData, runeData());

    expect(result.dataAvailable).toBe(true);
    expect(result.schemaVersion).toBe(1);
    expect(result.myRole).toBe('SUPPORT');
    expect(result.damageMix).toBe('mixed');
    expect(result.pages).toHaveLength(2);
    const top = result.pages[0];
    expect(top?.keystoneId).toBe(8001);
    expect(top?.contextKey).toBe(LANE3_KEY);
    expect(top?.contextLevel).toBe(1);
    expect(top?.nEff).toBeCloseTo(40, 6);
    expect(top?.players).toBe(12);
    expect(top?.lowData).toBe(false);
    expect(top?.winRate).toBeGreaterThan(result.pages[1]?.winRate ?? 0);
    expect(() => runeRecommendationResultSchema.parse(result)).not.toThrow();
  });

  it('shrinks a page toward its estimate in the next broader context', () => {
    // Lane page raw win rate 0.9 on a small sample; the same page is 0.4 on a
    // large global sample, so its lane estimate is pulled down below an
    // honest 0.55 global-only page.
    const lanePage = mkPage(8101, 9, 10, 10); // eq counts 9/10
    const globalSame = mkPage(8101, 40, 100, 100); // eq counts 40/100
    const globalOther = mkPage(8102, 55, 100, 100); // eq counts 55/100
    const exportData = runeExp([
      ctx(LANE3_KEY, 1, [lanePage]),
      ctx('global', 5, [globalSame, globalOther]),
    ]);

    const result = recommendRunes(draft(), CHAMP, exportData, runeData());

    expect(result.pages).toHaveLength(2);
    // globalOther: (55 + 40*0.5) / (100 + 40) = 75/140 ≈ 0.5357
    expect(result.pages[0]?.keystoneId).toBe(8102);
    expect(result.pages[0]?.winRate).toBeCloseTo(75 / 140, 6);
    // lanePage: global est (40+20)/140 = 3/7 ≈ 0.42857, then
    // (9 + 40*3/7) / (10 + 40) = (9 + 120/7) / 50 ≈ 0.52286
    expect(result.pages[1]?.keystoneId).toBe(8101);
    expect(result.pages[1]?.contextKey).toBe(LANE3_KEY);
    expect(result.pages[1]?.winRate).toBeCloseTo((9 + (40 * 60) / 140) / 50, 6);
  });

  it('shrinks toward 0.5 when the page has no broader context', () => {
    // Single lane context: prior is 0.5 -> (9 + 40*0.5)/(10+40) = 29/50 = 0.58.
    const page = mkPage(8201, 9, 10, 10);
    const exportData = runeExp([ctx(LANE3_KEY, 1, [page])]);

    const result = recommendRunes(draft(), CHAMP, exportData, runeData());

    expect(result.pages[0]?.winRate).toBeCloseTo(0.58, 6);
    expect(result.pages[0]?.lowData).toBe(true); // n_eff = 10 < minGames 25
  });

  it('falls back to the damage-mix context when lane keys are absent', () => {
    const adTags = tagsMap({
      10: 'AD',
      20: 'AD',
      30: 'AD',
      40: 'AD',
      50: 'AD',
      60: 'AD',
    });
    const page = mkPage(8301, 30, 40, 40);
    const exportData = runeExp([
      ctx('damagemix:AD', 4, [page]),
      ctx('global', 5, [mkPage(8302, 20, 40, 40)]),
    ]);

    const result = recommendRunes(draft(), CHAMP, exportData, runeData(adTags));

    expect(result.damageMix).toBe('AD');
    expect(result.pages[0]?.contextKey).toBe('damagemix:AD');
    expect(result.pages[0]?.contextLevel).toBe(4);
  });

  it('matches prefix lane keys under partial lane knowledge', () => {
    // Only the ally ADC and the enemy ADC are known: the 2-slot key
    // (a.ADC + e.ADC) does not exist in the data, the 1-slot key does.
    const page = mkPage(8401, 30, 40, 40);
    const exportData = runeExp([
      ctx(LANE1_KEY, 3, [page]),
      ctx('global', 5, [mkPage(8402, 20, 40, 40)]),
    ]);
    const input = draft({ enemies: [{ championId: 30, role: 'ADC' }] });

    const result = recommendRunes(input, CHAMP, exportData, runeData());

    expect(result.pages[0]?.contextKey).toBe(LANE1_KEY);
    expect(result.pages[0]?.contextLevel).toBe(3);
  });

  it('uses the 1v1 lane key for TOP', () => {
    const page = mkPage(8501, 30, 40, 40);
    const exportData = runeExp(
      [ctx('lane:e.TOP:40', 3, [page]), ctx('global', 5, [mkPage(8502, 20, 40, 40)])],
      CHAMP,
      'TOP',
    );
    const input = draft({
      userRole: 'TOP',
      allies: [],
      enemies: [{ championId: 40, role: 'TOP' }],
    });

    const result = recommendRunes(input, CHAMP, exportData, runeData());

    expect(result.myRole).toBe('TOP');
    expect(result.pages[0]?.contextKey).toBe('lane:e.TOP:40');
    expect(result.pages[0]?.contextLevel).toBe(3);
  });

  it('returns no pages when the export or the rank bucket is missing', () => {
    const empty = recommendRunes(draft(), CHAMP, undefined, runeData());
    expect(empty.dataAvailable).toBe(false);
    expect(empty.pages).toEqual([]);
    expect(empty.damageMix).toBe('mixed');

    const wrongBucket = runeExp([ctx(LANE3_KEY, 1, [mkPage(8601, 30, 40, 40)], 'MASTER_PLUS')]);
    const result = recommendRunes(draft(), CHAMP, wrongBucket, runeData());
    expect(result.dataAvailable).toBe(false);
    expect(result.pages).toEqual([]);
  });

  it('treats a mismatched champion or role export as absent', () => {
    const pages = [8651, 8652].map((id) => mkPage(id, 30, 40, 40));
    const wrongChamp = runeExp([ctx('global', 5, pages)], 999);
    const wrongRole = runeExp([ctx('global', 5, pages)], CHAMP, 'MID');

    expect(recommendRunes(draft(), CHAMP, wrongChamp, runeData()).dataAvailable).toBe(false);
    expect(recommendRunes(draft(), CHAMP, wrongRole, runeData()).dataAvailable).toBe(false);
  });

  it('limits to topPages and breaks ties by pick share', () => {
    // Five identical pages in the global context: order by pickShare desc.
    const pages = [8601, 8602, 8603, 8604, 8605].map((id, i) =>
      mkPage(id, 30, 40, 40, { pickShare: [0.1, 0.5, 0.3, 0.9, 0.2][i] ?? 0 }),
    );
    const exportData = runeExp([ctx('global', 5, pages)]);

    const result = recommendRunes(draft(), CHAMP, exportData, runeData());

    expect(result.pages.map((p) => p.keystoneId)).toEqual([8604, 8602, 8603]);
  });

  it('emits the stat-shard hint from the damage-mix context', () => {
    const adTags = tagsMap({
      10: 'AD',
      20: 'AD',
      30: 'AD',
      40: 'AD',
      50: 'AD',
      60: 'AD',
    });
    const popular = mkPage(8701, 30, 100, 100, { statShardIds: [5008, 5008, 5008] });
    const niche = mkPage(8702, 20, 10, 10, { statShardIds: [5001, 5002, 5003] });
    const exportData = runeExp([
      ctx('damagemix:AD', 4, [popular, niche]),
      ctx('global', 5, [popular, niche]),
    ]);

    const result = recommendRunes(draft(), CHAMP, exportData, runeData(adTags));

    expect(result.adaptationHints).toEqual([
      { code: 'statShardsVsDamageMix', damageMix: 'AD', statShardIds: [5008, 5008, 5008] },
    ]);
  });

  it('emits no hint when the damage-mix context has no shards', () => {
    const exportData = runeExp([
      ctx('damagemix:mixed', 4, [mkPage(8801, 30, 40, 40, { statShardIds: [] })]),
      ctx('global', 5, [mkPage(8802, 20, 40, 40)]),
    ]);

    const result = recommendRunes(draft(), CHAMP, exportData, runeData());

    expect(result.adaptationHints).toEqual([]);
  });

  it('merges duplicate page rows within a context', () => {
    const p1 = mkPage(8901, 5, 10, 10);
    const p2 = mkPage(8901, 5, 10, 10); // same exported page fields
    const exportData = runeExp([ctx(LANE3_KEY, 1, [p1, p2])]);

    const result = recommendRunes(draft(), CHAMP, exportData, runeData());

    expect(result.pages).toHaveLength(1);
    // Merged: gamesW 20, gamesW2 20 -> n_eff = 400/20 = 20.
    expect(result.pages[0]?.nEff).toBeCloseTo(20, 6);
  });

  it('recomputes n_eff from merged weights, not summed row n_effs', () => {
    // Same displayed page split across two perk-hash rows with different
    // game weights: ten weight-1 games (n_eff 10) + ten weight-0.1 games
    // (n_eff 10). Summing row n_effs would report 20; the merged
    // n_eff = (10+1)^2 / (10+0.1) = 121/10.1 ≈ 11.98.
    const heavy = mkPage(8902, 6, 10, 10, { pickShare: 0.9 });
    const light = mkPage(8902, 0.5, 1, 0.1, { pickShare: 0.1 });
    const exportData = runeExp([ctx(LANE3_KEY, 1, [heavy, light])]);

    const result = recommendRunes(draft(), CHAMP, exportData, runeData());

    expect(result.pages).toHaveLength(1);
    const page = result.pages[0];
    expect(page?.nEff).toBeCloseTo(121 / 10.1, 6);
    expect(page?.lowData).toBe(true); // ~11.98 < minGames, not the inflated 20
    // Merged winsE = winsW * n_eff / gamesW = 6.5 * (121/10.1) / 11.
    // Shrunk toward 0.5 with k=40: (winsE + 20) / (gamesE + 40).
    const winsE = (6.5 * (121 / 10.1)) / 11;
    expect(page?.winRate).toBeCloseTo((winsE + 40 * 0.5) / (121 / 10.1 + 40), 6);
  });

  it('is deterministic', () => {
    const pages = [9001, 9002, 9003].map((id) => mkPage(id, 30, 40, 40));
    const exportData = runeExp([ctx(LANE3_KEY, 1, pages), ctx('global', 5, pages)]);
    const input = draft();
    const data = runeData();

    expect(recommendRunes(input, CHAMP, exportData, data)).toEqual(
      recommendRunes(input, CHAMP, exportData, data),
    );
  });

  it('honours a custom page count', () => {
    const pages = [9101, 9102, 9103, 9104].map((id) => mkPage(id, 30, 40, 40));
    const exportData = runeExp([ctx('global', 5, pages)]);
    const runeConfig = { ...DEFAULT_RUNE_CONFIG, topPages: 2 };

    const result = recommendRunes(draft(), CHAMP, exportData, runeData(), undefined, runeConfig);

    expect(result.pages).toHaveLength(2);
  });
});
