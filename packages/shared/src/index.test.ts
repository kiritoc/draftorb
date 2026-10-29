import { describe, it, expect } from 'vitest';

import {
  type BaselineEntry,
  type DraftResult,
  type RankBucket,
  type Rank,
  allyPairEntrySchema,
  baselineEntrySchema,
  championIdSchema,
  championPoolSchema,
  championRangeSchema,
  championRoleProbabilitiesSchema,
  championSchema,
  championsMapSchema,
  championTagsMapSchema,
  championTagsSchema,
  damageTypeSchema,
  draftInputSchema,
  draftResultSchema,
  enemyPairEntrySchema,
  gameStateSchema,
  itemIdSchema,
  itemBuildExportSchema,
  itemSchema,
  itemsMapSchema,
  itemTagsSchema,
  itemTagsMapSchema,
  laneFullEntrySchema,
  laneVsEntrySchema,
  manifestSchema,
  rankBucketSchema,
  rankSchema,
  recommendationSchema,
  reasonTypeSchema,
  roleSchema,
  runeExportSchema,
  runePageSchema,
  runeTreeSchema,
  runeTreesSchema,
  slotSchema,
  supportBaselineEntrySchema,
  supportBaselineTableSchema,
  supportPairEntrySchema,
  supportPairTableSchema,
} from './index';

describe('shared schemas', () => {
  it('accepts valid rank and role values', () => {
    expect(rankSchema.parse('DIAMOND')).toBe('DIAMOND');
    expect(rankSchema.parse('CHALLENGER')).toBe('CHALLENGER');
    expect(roleSchema.parse('SUPPORT')).toBe('SUPPORT');
  });

  it('rankBucketSchema accepts the 8 buckets and rejects raw tiers', () => {
    const buckets: RankBucket[] = [
      'IRON',
      'BRONZE',
      'SILVER',
      'GOLD',
      'PLATINUM',
      'EMERALD',
      'DIAMOND',
      'MASTER_PLUS',
    ];
    for (const b of buckets) {
      expect(rankBucketSchema.parse(b)).toBe(b);
    }
    expect(() => rankSchema.parse('PLAT')).toThrow();
    expect(() => rankBucketSchema.parse('MASTER' as Rank)).toThrow();
    expect(() => rankBucketSchema.parse('CHALLENGER' as Rank)).toThrow();
    expect(() => rankBucketSchema.parse('GRANDMASTER' as Rank)).toThrow();
  });

  it('accepts a valid draft input', () => {
    const input = {
      userRank: 'DIAMOND',
      userRole: 'SUPPORT',
      allies: [{ championId: 18, role: 'ADC' }],
      enemies: [{ championId: 34, role: 'TOP' }],
      blindPick: false,
      pool: [18, 34, 40],
    };

    expect(draftInputSchema.parse(input)).toEqual(input);
  });

  it('rejects invalid slots and invalid ranks', () => {
    expect(() => slotSchema.parse({ championId: -1 })).toThrow();
    expect(() => rankSchema.parse('PLAT')).toThrow();
  });

  it('accepts a recommendation payload with new reason fields and game state', () => {
    const recommendation = {
      championId: 41,
      score: 12.5,
      rank: 1,
      reasons: [
        { type: 'lane', with: [41, 34], level: 2, deltaPp: 1.5, n: 120.5, lowData: false },
        { type: 'synergy', with: [18], level: 1, deltaPp: 0.8, lowData: true },
      ],
      reliability: { games: 80.5, lowData: false },
      warnings: ['countered by enemy support'],
    };

    expect(recommendationSchema.parse(recommendation)).toEqual(recommendation);

    const gameState = {
      time: 560,
      me: { championId: 41, kills: 3, deaths: 1, assists: 8, items: [1001, 3020], level: 12 },
      allies: [{ championId: 18, kills: 2, deaths: 2, assists: 4, items: [2003], level: 11 }],
      enemies: [{ championId: 34, kills: 5, deaths: 2, assists: 3, items: [3089], level: 13 }],
      goldDiff: -300,
      kills: 8,
      towers: 1,
      dragons: 0,
    };

    expect(gameStateSchema.parse(gameState)).toEqual(gameState);
  });

  it('reasonTypeSchema includes lane', () => {
    expect(reasonTypeSchema.parse('synergy')).toBe('synergy');
    expect(reasonTypeSchema.parse('counter')).toBe('counter');
    expect(reasonTypeSchema.parse('comp')).toBe('comp');
    expect(reasonTypeSchema.parse('blind')).toBe('blind');
    expect(reasonTypeSchema.parse('lane')).toBe('lane');
  });

  it('rejects non-array Reason.with', () => {
    expect(() =>
      recommendationSchema.parse({
        championId: 41,
        score: 12.5,
        rank: 1,
        reasons: [{ type: 'synergy', with: 18 }],
        reliability: { games: 80, lowData: false },
        warnings: [],
      }),
    ).toThrow();
  });

  it('recommendation accepts optional poolRank', () => {
    const rec = {
      championId: 41,
      score: 12.5,
      rank: 1,
      poolRank: 1,
      reasons: [],
      reliability: { games: 80, lowData: false },
      warnings: [],
    };
    expect(recommendationSchema.parse(rec)).toEqual(rec);
  });

  it('validates static data payloads', () => {
    const champion = {
      id: 41,
      name: 'Nami',
      icon: 'Nami.png',
      roles: ['SUPPORT'],
    };
    expect(championSchema.parse(champion)).toEqual(champion);
    expect(championsMapSchema.parse({ '41': champion })).toEqual({ '41': champion });

    const roleMap = {
      '41': { SUPPORT: 0.82, ADC: 0.12, MID: 0.06 },
    };
    expect(championRoleProbabilitiesSchema.parse(roleMap)).toEqual(roleMap);

    const sparseRoleMap = {
      '41': { SUPPORT: 1.0 },
      '34': { TOP: 0.7, JUNGLE: 0.3 },
    };
    expect(championRoleProbabilitiesSchema.parse(sparseRoleMap)).toEqual(sparseRoleMap);

    const tags = {
      '41': {
        championId: 41,
        damageType: 'AP',
        archetype: 'enchanter',
        hardEngage: false,
        peel: true,
        poke: true,
        waveclear: false,
        scaling: { early: false, mid: true, late: true },
        range: 'RANGED',
        ccCount: 2,
      },
    };
    expect(championTagsMapSchema.parse(tags)).toEqual(tags);
    expect(championTagsSchema.parse(tags['41'])).toEqual(tags['41']);
    expect(damageTypeSchema.parse('AP')).toBe('AP');
    expect(championRangeSchema.parse('RANGED')).toBe('RANGED');

    expect(() =>
      championTagsMapSchema.parse({
        '999': {
          championId: 41,
          damageType: 'AP',
          archetype: 'enchanter',
          hardEngage: false,
          peel: true,
          poke: true,
          waveclear: false,
          scaling: { early: false, mid: true, late: true },
          range: 'RANGED',
          ccCount: 2,
        },
      }),
    ).toThrow();

    const manifest = {
      patch: '14.23',
      generatedAt: '2026-10-22T00:00:00Z',
      region: 'EUW',
      rankBuckets: ['DIAMOND'],
      roles: ['SUPPORT'],
      files: [{ path: 'champions.json' }],
      schemaVersion: 1,
    };
    expect(manifestSchema.parse(manifest)).toEqual(manifest);
  });

  it('rejects champion role probabilities that do not sum to 1', () => {
    expect(() =>
      championRoleProbabilitiesSchema.parse({
        '41': { SUPPORT: 0.5, ADC: 0.3 },
      }),
    ).toThrow();
  });

  it('rejects role probabilities with zero-valued roles', () => {
    expect(() =>
      championRoleProbabilitiesSchema.parse({
        '41': { SUPPORT: 1, TOP: 0 },
      }),
    ).toThrow();
  });

  it('rejects invalid champion ids and blanks', () => {
    expect(() => championIdSchema.parse(0)).toThrow();
    expect(() =>
      championSchema.parse({ id: 41, name: '', icon: 'x', roles: ['SUPPORT'] }),
    ).toThrow();
    expect(() => itemIdSchema.parse(-10)).toThrow();
  });

  it('validates items and item tags', () => {
    const item = {
      id: 3089,
      name: "Rabadon's Deathcap",
      icon: '3089.png',
      goldTotal: 3600,
      purchasable: true,
      tags: ['SpellDamage'],
      from: [1058, 1058],
      into: [],
      stats: { FlatMagicDamageMod: 120 },
    };
    expect(itemSchema.parse(item)).toEqual(item);
    expect(itemsMapSchema.parse({ '3089': item })).toEqual({ '3089': item });

    const itemTag = {
      itemId: 3089,
      damageType: 'AP',
      armor: false,
      magicResist: false,
      health: false,
      antiHeal: false,
      antiShield: false,
      mana: false,
      support: false,
    };
    expect(itemTagsSchema.parse(itemTag)).toEqual(itemTag);
    expect(itemTagsMapSchema.parse({ '3089': itemTag })).toEqual({ '3089': itemTag });
  });

  it('validates runes and rune pages', () => {
    const tree = {
      id: 8000,
      key: 'Precision',
      icon: 'perk-images/Styles/7201_Precision.png',
      name: 'Precision',
      slots: [
        {
          runes: [
            {
              id: 8005,
              key: 'PressTheAttack',
              icon: 'perk-images/Styles/Precision/PressTheAttack/PressTheAttack.png',
              name: 'Press the Attack',
              shortDesc: 'Basic attacks grant damage boost',
            },
          ],
        },
      ],
    };
    expect(runeTreeSchema.parse(tree)).toEqual(tree);
    expect(runeTreesSchema.parse([tree])).toEqual([tree]);

    const runePage = {
      primaryStyleId: 8000,
      subStyleId: 8400,
      keystoneId: 8005,
      selectedPerkIds: [8005, 9111, 9104, 8299, 8444, 8453],
      statShardIds: [5008, 5002, 5003],
      winsWeighted: 154.2,
      gamesWeighted: 300.0,
      gamesW2: 900.0,
      winrate: 0.534,
      pickShare: 0.41,
    };
    expect(runePageSchema.parse(runePage)).toEqual(runePage);
  });

  it('validates support baseline and support pair tables with gamesW2', () => {
    const baselineEntry = {
      championId: 41,
      rankBucket: 'DIAMOND',
      winsWeighted: 154.2,
      gamesWeighted: 300.0,
      gamesW2: 900.0,
    };
    expect(supportBaselineEntrySchema.parse(baselineEntry)).toEqual(baselineEntry);
    expect(supportBaselineTableSchema.parse([baselineEntry])).toEqual([baselineEntry]);

    const validPair = [41, 18, 'ADC', 'DIAMOND', 52.4, 100.0, 250.0] as const;
    expect(supportPairEntrySchema.parse(validPair)).toEqual(validPair);
    expect(supportPairTableSchema.parse([validPair])).toEqual([validPair]);

    const invalidPairTooShort = [41, 18, 'ADC', 'DIAMOND', 52.4, 100.0] as const;
    expect(() => supportPairEntrySchema.parse(invalidPairTooShort)).toThrow();
  });

  it('validates role-keyed export tuple schemas', () => {
    const baseline: BaselineEntry = [41, 'DIAMOND', 52.4, 100.0, 250.0];
    expect(baselineEntrySchema.parse(baseline)).toEqual(baseline);

    const allyPair = [41, 18, 'ADC', 'DIAMOND', 52.4, 100.0, 250.0] as const;
    expect(allyPairEntrySchema.parse(allyPair)).toEqual(allyPair);

    const enemyPair = [41, 34, 'TOP', 'EMERALD', 40.0, 80.0, 160.0] as const;
    expect(enemyPairEntrySchema.parse(enemyPair)).toEqual(enemyPair);

    const laneVs1v1 = [41, 34, null, 'DIAMOND', 50.0, 100.0, 250.0] as const;
    expect(laneVsEntrySchema.parse(laneVs1v1)).toEqual(laneVs1v1);

    const laneVs2v2 = [41, 34, 54, 'DIAMOND', 50.0, 100.0, 250.0] as const;
    expect(laneVsEntrySchema.parse(laneVs2v2)).toEqual(laneVs2v2);

    const laneFull1v1 = [41, null, 34, null, 'DIAMOND', 50.0, 100.0, 250.0] as const;
    expect(laneFullEntrySchema.parse(laneFull1v1)).toEqual(laneFull1v1);

    const laneFull2v2 = [41, 18, 34, 54, 'DIAMOND', 50.0, 100.0, 250.0] as const;
    expect(laneFullEntrySchema.parse(laneFull2v2)).toEqual(laneFull2v2);
  });

  it('rejects rankSchema values where rankBucketSchema is expected', () => {
    expect(() => baselineEntrySchema.parse([41, 'MASTER' as Rank, 52.4, 100.0, 250.0])).toThrow();
    expect(() => baselineEntrySchema.parse([41, 'MASTER_PLUS', 52.4, 100.0, 250.0])).not.toThrow();
  });

  it('validates champion pool storage envelope', () => {
    const pool = {
      version: 1,
      pools: {
        SUPPORT: [41, 18, 34, 54],
        ADC: [18, 54],
      },
    };
    expect(championPoolSchema.parse(pool)).toEqual(pool);

    expect(() => championPoolSchema.parse({ version: 2, pools: {} })).toThrow();
    expect(() => championPoolSchema.parse({ version: 1, pools: { TOP: [-1] } })).toThrow();
    expect(() => championPoolSchema.parse({ version: 1, pools: { SUPPORT: [41, 41] } })).toThrow();
  });

  it('validates DraftResult with insufficientData and pool recommendations', () => {
    const result: DraftResult = {
      recommendations: [
        {
          championId: 41,
          score: 0.72,
          rank: 1,
          reasons: [{ type: 'synergy', with: [18], level: 2, n: 120.5, lowData: false }],
          reliability: { games: 150.3, lowData: false },
          warnings: [],
        },
      ],
      insufficientData: [{ championId: 54, nEff: 12.5, rawGames: 20 }],
      poolRecommendations: [
        {
          championId: 41,
          score: 0.72,
          rank: 1,
          poolRank: 1,
          reasons: [],
          reliability: { games: 150.3, lowData: false },
          warnings: [],
        },
      ],
      poolUnavailable: [{ championId: 54, reason: 'insufficientData' }],
    };
    expect(draftResultSchema.parse(result)).toEqual(result);

    expect(() =>
      draftResultSchema.parse({
        recommendations: [],
        insufficientData: [{ championId: 54, nEff: 12.5, rawGames: 20 }],
      }),
    ).not.toThrow();

    expect(() =>
      draftResultSchema.parse({
        recommendations: [],
        insufficientData: [{ championId: 54, nEff: 12.5, rawGames: 20 }],
        poolUnavailable: [{ championId: 999, reason: 'bogus' }],
      }),
    ).toThrow();
  });

  it('validates rune and item build export schemas', () => {
    const runeExport = {
      championId: 41,
      myRole: 'SUPPORT',
      contexts: [
        {
          contextKey: 'lane:enemySupport,enemyAdc',
          contextLevel: 1,
          pages: [
            {
              primaryStyleId: 8000,
              subStyleId: 8400,
              keystoneId: 8005,
              selectedPerkIds: [8005, 9111, 9104, 8299, 8444, 8453],
              winsW: 154.2,
              gamesW: 300.0,
              gamesW2: 900.0,
              winrate: 0.534,
              pickShare: 0.41,
            },
          ],
        },
      ],
    };
    expect(runeExportSchema.parse(runeExport)).toEqual(runeExport);

    const itemExport = {
      championId: 41,
      myRole: 'SUPPORT',
      contexts: [
        {
          slotIdx: 1,
          timeBucket: '5-10min',
          stateBucket: 'ahead',
          profileKey: 'AP',
          laneKey: 'lane:enemySupport,enemyAdc',
          items: [
            {
              itemId: 3089,
              winsW: 154.2,
              gamesW: 300.0,
              gamesW2: 900.0,
              winrate: 0.534,
              pickShare: 0.41,
            },
          ],
        },
      ],
    };
    expect(itemBuildExportSchema.parse(itemExport)).toEqual(itemExport);
  });
});
