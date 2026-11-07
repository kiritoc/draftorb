/**
 * Profile config + export schema tests (T-090, D-068/D-069, SPECS §18).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  PROFILE_EXPORT_SCHEMA_VERSION,
  profileConfigSchema,
  profileExportSchema,
  profileIndexSchema,
} from '../src/index.js';

const validConfig = {
  schemaVersion: 1,
  profiles: [
    {
      id: 'kiritoctoc-euw1',
      riotId: { gameName: 'KiriToc', tagLine: 'Toc' },
      platform: 'EUW1',
      label: "KiriToc's picks",
      options: { profileMaxGames: 500 },
    },
  ],
};

const validGame = {
  createdAtDay: 19877,
  championId: 23,
  role: 'SUPPORT',
  win: true,
  allyAdcId: 67,
  enemySupportId: 143,
  enemyAdcId: 202,
  enemyChampionIds: [143, 202, 35, 121, 7],
  runes: {
    keystoneId: 8112,
    primaryStyleId: 7200,
    subStyleId: 7300,
    perkIds: [9111, 9104, 8005],
    statShardIds: [5008, 5008, 5007],
  },
  items: [2055, 3865],
  itemsOrdered: [3858, 2055, 3865],
  summonerSpells: [4, 7],
};

const validExport = {
  schemaVersion: 1,
  id: 'kiritoctoc-euw1',
  riotId: { gameName: 'KiriToc', tagLine: 'Toc', platform: 'EUW1' },
  label: "KiriToc's picks",
  syncedAt: 1730000000,
  gameCount: 1,
  favorites: { combined: [23, 143], recency: [23, 143], mastery: [999] },
  games: [validGame],
  mastery: [{ championId: 23, points: 152345, level: 7 }],
};

describe('profileConfigSchema', () => {
  it('accepts the committed data/profiles.config.json', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const configPath = join(here, '../../../data/profiles.config.json');
    const parsed = profileConfigSchema.parse(JSON.parse(readFileSync(configPath, 'utf-8')));
    expect(parsed.profiles).toHaveLength(1);
    expect(parsed.profiles[0]?.riotId.gameName).toBe('KiriToc');
  });

  it('accepts a valid config and rejects duplicates, bad ids and extra keys', () => {
    expect(profileConfigSchema.parse(validConfig)).toEqual(validConfig);

    expect(() =>
      profileConfigSchema.parse({
        ...validConfig,
        profiles: [validConfig.profiles[0], validConfig.profiles[0]],
      }),
    ).toThrow();

    expect(() =>
      profileConfigSchema.parse({
        ...validConfig,
        profiles: [{ ...validConfig.profiles[0], id: 'Bad Id!' }],
      }),
    ).toThrow();

    expect(() =>
      profileConfigSchema.parse({
        ...validConfig,
        profiles: [{ ...validConfig.profiles[0], extra: true }],
      }),
    ).toThrow();

    expect(() => profileConfigSchema.parse({ ...validConfig, schemaVersion: 2 })).toThrow();
    expect(profileConfigSchema.safeParse({ schemaVersion: 1, profiles: [] }).success).toBe(false);
  });
});

describe('profileExportSchema', () => {
  it('accepts a valid anonymized export', () => {
    const export_ = { ...validExport, games: [{ ...validGame, itemsOrdered: null }] };
    expect(profileExportSchema.parse(export_)).toEqual(export_);
    expect(PROFILE_EXPORT_SCHEMA_VERSION).toBe(1);
  });

  it('rejects foreign identifiers and match ids (anonymization whitelist)', () => {
    for (const leak of [
      { matchId: 'EUW1_123_abc' },
      { puuid: 'a'.repeat(78) },
      { summonerName: 'EnemyPlayer#EUW' },
      { participantPuuids: ['b'.repeat(78)] },
    ]) {
      expect(
        profileExportSchema.safeParse({ ...validExport, games: [{ ...validGame, ...leak }] })
          .success,
      ).toBe(false);
    }
    expect(profileExportSchema.safeParse({ ...validExport, matchId: 'x' }).success).toBe(false);
  });

  it('requires every whitelisted field and rejects a wrong schema version', () => {
    const { allyAdcId: _omit, ...withoutAlly } = validGame;
    expect(profileExportSchema.safeParse({ ...validExport, games: [withoutAlly] }).success).toBe(
      false,
    );
    expect(profileExportSchema.safeParse({ ...validExport, schemaVersion: 2 }).success).toBe(false);
    expect(profileExportSchema.safeParse({ ...validExport, gameCount: -1 }).success).toBe(false);
  });
});

describe('profileIndexSchema', () => {
  it('accepts a valid index and rejects bad entries', () => {
    const index = {
      schemaVersion: 1,
      profiles: [
        {
          id: 'kiritoctoc-euw1',
          riotId: { gameName: 'KiriToc', tagLine: 'Toc' },
          platform: 'EUW1',
          label: "KiriToc's picks",
          syncedAt: 1730000000,
          gameCount: 412,
          file: 'kiritoctoc-euw1.json',
        },
      ],
    };
    expect(profileIndexSchema.parse(index)).toEqual(index);
    expect(profileIndexSchema.safeParse({ schemaVersion: 2, profiles: [] }).success).toBe(false);
    expect(
      profileIndexSchema.safeParse({
        schemaVersion: 1,
        profiles: [{ ...index.profiles[0], file: '' }],
      }).success,
    ).toBe(false);
  });
});
