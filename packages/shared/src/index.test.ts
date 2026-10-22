import { describe, expect, it } from 'vitest';

import {
  championIdSchema,
  championRoleProbabilitiesSchema,
  championSchema,
  championTagsMapSchema,
  draftInputSchema,
  gameStateSchema,
  itemIdSchema,
  itemSchema,
  itemsMapSchema,
  itemTagsSchema,
  itemTagsMapSchema,
  manifestSchema,
  rankSchema,
  recommendationSchema,
  roleSchema,
  runePageSchema,
  runeTreeSchema,
  slotSchema,
  supportBaselineEntrySchema,
  supportBaselineTableSchema,
  supportPairEntrySchema,
  supportPairTableSchema,
} from './index';

describe('shared schemas', () => {
  it('accepts valid rank and role values', () => {
    expect(rankSchema.parse('DIAMOND')).toBe('DIAMOND');
    expect(roleSchema.parse('SUPPORT')).toBe('SUPPORT');
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

  it('accepts a recommendation payload and game state', () => {
    const recommendation = {
      championId: 41,
      score: 12.5,
      rank: 1,
      reasons: [{ type: 'synergy', with: 18, level: 2, deltaPp: 1.5, n: 120 }],
      reliability: { games: 80, lowData: false },
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

  it('validates static data payloads', () => {
    const champion = {
      id: 41,
      name: 'Nami',
      icon: 'Nami.png',
      roles: ['SUPPORT'],
    };
    expect(championSchema.parse(champion)).toEqual(champion);

    const roleMap = {
      '41': { SUPPORT: 0.82, ADC: 0.12, MID: 0.06, TOP: 0, JUNGLE: 0 },
    };
    expect(championRoleProbabilitiesSchema.parse(roleMap)).toEqual(roleMap);

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

    const manifest = {
      patch: '14.23',
      generatedAt: '2026-10-22T00:00:00Z',
      region: 'EUW',
      rankBuckets: ['DIAMOND'],
      files: [{ path: 'champions.json' }],
      schemaVersion: 1,
    };
    expect(manifestSchema.parse(manifest)).toEqual(manifest);
  });

  it('rejects invalid champion ids and blanks', () => {
    expect(() => championIdSchema.parse(0)).toThrow();
    expect(() => championSchema.parse({ id: 41, name: '', icon: 'x', roles: ['SUPPORT'] })).toThrow();
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

    const runePage = {
      primaryStyleId: 8000,
      subStyleId: 8400,
      keystoneId: 8005,
      selectedPerkIds: [8005, 9111, 9104, 8299, 8444, 8453],
      statShardIds: [5008, 5002, 5003],
      winrate: 0.534,
      pickShare: 0.41,
    };
    expect(runePageSchema.parse(runePage)).toEqual(runePage);
  });

  it('validates support baseline and support pair tables without loose rest elements', () => {
    const baselineEntry = {
      championId: 41,
      rankBucket: 'DIAMOND',
      winsWeighted: 154.2,
      gamesWeighted: 300.0,
    };
    expect(supportBaselineEntrySchema.parse(baselineEntry)).toEqual(baselineEntry);
    expect(supportBaselineTableSchema.parse([baselineEntry])).toEqual([baselineEntry]);

    const validPair = [41, 18, 'ADC', 'DIAMOND', 52.4, 100.0] as const;
    expect(supportPairEntrySchema.parse(validPair)).toEqual(validPair);
    expect(supportPairTableSchema.parse([validPair])).toEqual([validPair]);

    // Rejects tuples with extra elements (verifies removal of .rest())
    const invalidPairTooLong = [41, 18, 'ADC', 'DIAMOND', 52.4, 100.0, 999.0];
    expect(() => supportPairEntrySchema.parse(invalidPairTooLong)).toThrow();
  });
});
