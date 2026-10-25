import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { championsMapSchema, itemsMapSchema, runeTreesSchema } from '@draftorb/shared';

import {
  fetchLatestVersion,
  getPatchFromVersion,
  importStaticData,
  mapChampionTagsToRoles,
  transformChampions,
  transformItems,
  transformRunes,
} from './ddragon';

describe('ddragon ETL utilities', () => {
  it('extracts patch correctly from Data Dragon version strings', () => {
    expect(getPatchFromVersion('14.23.1')).toBe('14.23');
    expect(getPatchFromVersion('16.21.1')).toBe('16.21');
    expect(getPatchFromVersion('13.1.2.3')).toBe('13.1');
    expect(() => getPatchFromVersion('14')).toThrow('Invalid version format');
    expect(() => getPatchFromVersion('')).toThrow('Invalid version format');
  });

  it('maps champion tags to valid draft roles with fallback and deduplication', () => {
    expect(mapChampionTagsToRoles(['Support'])).toEqual(['SUPPORT']);
    expect(mapChampionTagsToRoles(['Marksman'])).toEqual(['ADC']);
    expect(mapChampionTagsToRoles(['Support', 'Mage'])).toEqual(['SUPPORT', 'MID']);
    expect(mapChampionTagsToRoles(['Fighter', 'Tank'])).toEqual(['TOP']);
    expect(mapChampionTagsToRoles([])).toEqual(['MID']);
    expect(mapChampionTagsToRoles(undefined)).toEqual(['MID']);
    expect(mapChampionTagsToRoles(['UnknownRole'])).toEqual(['MID']);
  });

  it('documents that the patch 16.21 champion role hint has no jungle entries', () => {
    const champions = championsMapSchema.parse(
      JSON.parse(
        readFileSync(new URL('../../../data/public/16.21/champions.json', import.meta.url), 'utf8'),
      ) as unknown,
    );
    const entries = Object.values(champions);

    expect(entries).toHaveLength(173);
    expect(entries.filter((champion) => champion.roles.includes('JUNGLE'))).toHaveLength(0);
  });

  it('transforms raw champion payloads and passes zod validation', () => {
    const raw = {
      Nami: {
        id: 'Nami',
        key: '267',
        name: 'Nami',
        image: { full: 'Nami.png' },
        tags: ['Support', 'Mage'],
      },
      InvalidChamp: {
        id: 'Invalid',
        key: '-1',
        name: 'Invalid',
      },
    };

    const transformed = transformChampions(raw);
    expect(championsMapSchema.parse(transformed)).toEqual({
      '267': {
        id: 267,
        name: 'Nami',
        icon: 'Nami.png',
        roles: ['SUPPORT', 'MID'],
      },
    });
  });

  it('transforms raw item payloads, filters blank names, and passes zod validation', () => {
    const raw = {
      '1001': {
        name: 'Boots',
        image: { full: '1001.png' },
        gold: { total: 300, purchasable: true },
        tags: ['Boots'],
        into: ['3006', '3009'],
        stats: { FlatMovementSpeedMod: 25 },
      },
      '2008': {
        name: '',
        image: { full: '2008.png' },
        gold: { total: 0, purchasable: false },
      },
      '3006': {
        name: "Berserker's Greaves",
        image: { full: '3006.png' },
        gold: { total: 1100, purchasable: true },
        tags: ['AttackSpeed', 'Boots'],
        from: ['1001'],
        stats: { FlatMovementSpeedMod: 45, PercentAttackSpeedMod: 0.35 },
      },
    };

    const transformed = transformItems(raw);
    expect(Object.keys(transformed)).toEqual(['1001', '3006']);
    expect(itemsMapSchema.parse(transformed)).toEqual(transformed);
    expect(transformed['1001']?.into).toEqual([3006, 3009]);
    expect(transformed['3006']?.from).toEqual([1001]);
  });

  it('transforms raw rune tree payloads and passes zod validation', () => {
    const rawTrees = [
      {
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
      },
    ];

    const transformed = transformRunes(rawTrees);
    expect(runeTreesSchema.parse(transformed)).toEqual(rawTrees);
  });

  it('fetches version directly if specified or queries version endpoint', async () => {
    const custom = await fetchLatestVersion('14.23.1');
    expect(custom).toBe('14.23.1');

    const mockFetch = async () =>
      new Response(JSON.stringify(['14.24.1', '14.23.1']), { status: 200 });

    const latest = await fetchLatestVersion(undefined, mockFetch as typeof fetch);
    expect(latest).toBe('14.24.1');
  });

  it('imports static data end-to-end and writes validated json files', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'draftorb-test-'));

    try {
      const mockFetch: typeof fetch = async (input) => {
        const url = String(input);
        if (url.endsWith('/api/versions.json')) {
          return new Response(JSON.stringify(['14.23.1']), { status: 200 });
        }
        if (url.includes('/champion.json')) {
          return new Response(
            JSON.stringify({
              data: {
                Nami: {
                  id: 'Nami',
                  key: '267',
                  name: 'Nami',
                  image: { full: 'Nami.png' },
                  tags: ['Support'],
                },
              },
            }),
            { status: 200 },
          );
        }
        if (url.includes('/item.json')) {
          return new Response(
            JSON.stringify({
              data: {
                '1001': {
                  name: 'Boots',
                  image: { full: '1001.png' },
                  gold: { total: 300, purchasable: true },
                  tags: ['Boots'],
                },
              },
            }),
            { status: 200 },
          );
        }
        if (url.includes('/runesReforged.json')) {
          return new Response(
            JSON.stringify([
              {
                id: 8000,
                key: 'Precision',
                icon: 'perk-images/Styles/7201_Precision.png',
                name: 'Precision',
                slots: [
                  {
                    runes: [
                      {
                        id: 8005,
                        name: 'Press the Attack',
                        icon: 'perk-images/Styles/Precision/PressTheAttack/PressTheAttack.png',
                      },
                    ],
                  },
                ],
              },
            ]),
            { status: 200 },
          );
        }
        return new Response('Not found', { status: 404 });
      };

      const result = await importStaticData({
        version: '14.23.1',
        outputDir: tempDir,
        fetchFn: mockFetch,
      });

      expect(result.patch).toBe('14.23');
      expect(result.version).toBe('14.23.1');
      expect(result.championsCount).toBe(1);
      expect(result.itemsCount).toBe(1);
      expect(result.runeTreesCount).toBe(1);

      // Verify written files on disk
      const champsFile = JSON.parse(await readFile(result.outputPaths.champions, 'utf-8'));
      const itemsFile = JSON.parse(await readFile(result.outputPaths.items, 'utf-8'));
      const runesFile = JSON.parse(await readFile(result.outputPaths.runes, 'utf-8'));

      expect(championsMapSchema.parse(champsFile)).toEqual(champsFile);
      expect(itemsMapSchema.parse(itemsFile)).toEqual(itemsFile);
      expect(runeTreesSchema.parse(runesFile)).toEqual(runesFile);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
