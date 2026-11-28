import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ProfileConfigEntry } from '@draftorb/shared';
import { profileExportSchema, profileIndexSchema } from '@draftorb/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { openDb, migrate } from './db';
import { buildProfileExport, computeFavorites, writeProfileExports } from './profile-export';

const DAY_MS = 86_400_000;
const NOW_MS = 1_760_000_000_000;

const ENTRY: ProfileConfigEntry = {
  id: 'test-profile',
  riotId: { gameName: 'Test', tagLine: 'One' },
  platform: 'EUW1',
  label: "Test's picks",
  options: {},
};

function seedProfile(db: ReturnType<typeof openDb>, id = ENTRY.id): void {
  db.prepare(
    `INSERT INTO profiles (id, puuid, game_name, tag_line, platform, region, synced_at, last_game_creation)
     VALUES (?, 'puuid-secret', 'Test', 'One', 'EUW1', 'europe', ?, NULL)`,
  ).run(id, NOW_MS);
}

interface GameSeed {
  matchId: string;
  createdAt: number;
  championId?: number;
  role?: string;
  win?: number;
  allyAdcId?: number | null;
  enemySupportId?: number | null;
  enemyAdcId?: number | null;
  enemyChampions?: number[];
  keystone?: number | null;
  perksJson?: string | null;
  items?: number[];
  itemsOrdered?: number[] | null;
}

function seedGame(db: ReturnType<typeof openDb>, seed: GameSeed, profileId = ENTRY.id): void {
  db.prepare(
    `INSERT INTO profile_games (
      profile_id, match_id, created_at, champion_id, role, win,
      ally_adc_id, enemy_support_id, enemy_adc_id, enemy_champions_json,
      keystone, primary_style, sub_style, perks_json,
      items_json, items_ordered_json, summoner1_id, summoner2_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    profileId,
    seed.matchId,
    seed.createdAt,
    seed.championId ?? 23,
    seed.role ?? 'SUPPORT',
    seed.win ?? 1,
    seed.allyAdcId ?? 67,
    seed.enemySupportId ?? 143,
    seed.enemyAdcId ?? 202,
    JSON.stringify(seed.enemyChampions ?? [143, 202, 35, 121, 7]),
    seed.keystone === undefined ? 8112 : seed.keystone,
    seed.keystone === null ? null : 7200,
    seed.keystone === null ? null : 7300,
    seed.perksJson === undefined
      ? JSON.stringify({
          statPerks: { defense: 5001, flex: 5008, offense: 5008 },
          styles: [
            { description: 'primaryStyle', style: 7200, selections: [{ perk: 8112 }] },
            { description: 'subStyle', style: 7300, selections: [{ perk: 9111 }] },
          ],
        })
      : seed.perksJson,
    JSON.stringify(seed.items ?? [2055, 3865]),
    seed.itemsOrdered === undefined
      ? null
      : seed.itemsOrdered === null
        ? null
        : JSON.stringify(seed.itemsOrdered),
    4,
    7,
  );
}

function seedMastery(
  db: ReturnType<typeof openDb>,
  rows: { championId: number; points: number; level?: number | null }[],
  profileId = ENTRY.id,
): void {
  const insert = db.prepare(
    `INSERT INTO profile_mastery (profile_id, champion_id, mastery_points, mastery_level, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const row of rows) {
    insert.run(profileId, row.championId, row.points, row.level ?? null, NOW_MS);
  }
}

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'profile-export-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Narrows a possibly-undefined lookup in tests (no-non-null-assertion). */
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('expected a defined value');
  }
  return value;
}

describe('buildProfileExport', () => {
  it('exports only whitelisted fields — no match ids or foreign identifiers', () => {
    const db = openDb(':memory:');
    migrate(db);
    seedProfile(db);
    seedGame(db, {
      matchId: 'EUW1_SECRET_MATCH_ID',
      createdAt: NOW_MS - 10 * DAY_MS,
      itemsOrdered: [3858, 2055],
    });
    const exported = buildProfileExport(db, ENTRY, NOW_MS);
    expect(exported.gameCount).toBe(1);
    const serialized = JSON.stringify(exported);
    expect(serialized).not.toContain('EUW1_SECRET_MATCH_ID');
    expect(serialized).not.toContain('puuid-secret');
    expect(serialized).not.toContain('matchId');
    expect(serialized).not.toContain('puuid');
    const game = must(exported.games[0]);
    expect(game.itemsOrdered).toEqual([3858, 2055]);
    expect(game.runes?.keystoneId).toBe(8112);
    expect(game.runes?.perkIds).toEqual([8112, 9111]);
    expect(game.runes?.statShardIds).toEqual([5001, 5008, 5008]);
    db.close();
  });

  it('applies the 180-day and profileMaxGames caps', () => {
    const db = openDb(':memory:');
    migrate(db);
    seedProfile(db);
    const maxGames = 3;
    const entry = { ...ENTRY, options: { profileMaxGames: maxGames } };
    // 5 in-window games (newest first by created_at) + 1 older than 180 days.
    for (let i = 0; i < 5; i += 1) {
      seedGame(db, { matchId: `M${i}`, createdAt: NOW_MS - i * DAY_MS });
    }
    seedGame(db, { matchId: 'OLD', createdAt: NOW_MS - 200 * DAY_MS });
    const exported = buildProfileExport(db, entry, NOW_MS);
    expect(exported.gameCount).toBe(maxGames);
    expect(exported.games.map((g) => g.createdAtDay)).toEqual([
      Math.floor((NOW_MS - 0 * DAY_MS) / DAY_MS),
      Math.floor((NOW_MS - 1 * DAY_MS) / DAY_MS),
      Math.floor((NOW_MS - 2 * DAY_MS) / DAY_MS),
    ]);
    db.close();
  });

  it('exports runes: null when the game carried no rune data', () => {
    const db = openDb(':memory:');
    migrate(db);
    seedProfile(db);
    seedGame(db, {
      matchId: 'NORUNES',
      createdAt: NOW_MS - DAY_MS,
      keystone: null,
      perksJson: null,
    });
    const exported = buildProfileExport(db, ENTRY, NOW_MS);
    expect(must(exported.games[0]).runes).toBeNull();
    db.close();
  });
});

describe('computeFavorites', () => {
  const game = (
    championId: number,
    role: 'SUPPORT' | 'TOP' | 'JUNGLE' | 'MID' | 'ADC',
    ageDays: number,
  ) => ({
    createdAtDay: Math.floor((NOW_MS - ageDays * DAY_MS) / DAY_MS),
    championId,
    role,
    win: true,
    allyAdcId: null,
    enemySupportId: null,
    enemyAdcId: null,
    enemyChampionIds: [],
    runes: null,
    items: [],
    itemsOrdered: null,
    summonerSpells: [4, 7] as [number, number],
  });

  it('computes favorites per role: recency within the role, mastery unioned everywhere', () => {
    const games = [
      // SUPPORT: champion 23 played 4 recent games -> highest weight.
      ...Array.from({ length: 4 }, (_, i) => game(23, 'SUPPORT', i)),
      // SUPPORT: champion 99 one game 80 days ago -> low but non-zero weight.
      game(99, 'SUPPORT', 80),
      // TOP: champion 7 dominates the TOP recency list.
      ...Array.from({ length: 3 }, () => game(7, 'TOP', 5)),
      // MID games of champion 23 must NOT leak into SUPPORT or TOP.
      ...Array.from({ length: 10 }, () => game(23, 'MID', 1)),
    ];
    const favorites = computeFavorites(
      games,
      [
        { championId: 500, points: 300_000 },
        { championId: 23, points: 200_000 },
        { championId: 600, points: 100_000 },
      ],
      NOW_MS,
    );

    const support = must(favorites.SUPPORT);
    expect(support.recency).toEqual([23, 99]);
    expect(support.mastery).toEqual([500, 23, 600]);
    expect(support.combined[0]).toBe(23);
    expect(support.combined).toContain(500);
    expect(new Set(support.combined).size).toBe(support.combined.length);

    const top = must(favorites.TOP);
    expect(top.recency).toEqual([7]);
    // Mastery is role-agnostic: the same top-N joins every role's combined.
    expect(top.mastery).toEqual([500, 23, 600]);
    expect(top.combined).toEqual([7, 500, 23, 600]);

    // MID games produce a MID entry; champion 23's MID games never leak
    // into the SUPPORT/TOP lists.
    const mid = must(favorites.MID);
    expect(mid.recency).toEqual([23]);
    expect(favorites.JUNGLE).toBeUndefined();
    expect(favorites.ADC).toBeUndefined();
  });

  it('returns an empty record when there are no games', () => {
    expect(computeFavorites([], [{ championId: 500, points: 300_000 }], NOW_MS)).toEqual({});
  });
});

describe('writeProfileExports', () => {
  it('writes <id>.json and index.json, both schema-valid', () => {
    const db = openDb(':memory:');
    migrate(db);
    seedProfile(db);
    seedGame(db, { matchId: 'M1', createdAt: NOW_MS - DAY_MS });
    seedMastery(db, [{ championId: 23, points: 1000, level: 7 }]);
    const dir = tempDir();
    const config = { schemaVersion: 1 as const, profiles: [ENTRY] };
    const { written } = writeProfileExports(db, config, { dir, nowMs: NOW_MS });
    expect(written).toHaveLength(2);
    const exported = profileExportSchema.parse(
      JSON.parse(readFileSync(join(dir, 'test-profile.json'), 'utf-8')),
    );
    expect(exported.gameCount).toBe(1);
    // Per-role favorites (BL-057): the SUPPORT game produces a SUPPORT entry.
    expect(exported.favorites.SUPPORT?.recency).toEqual([23]);
    expect(exported.favorites.TOP).toBeUndefined();
    const index = profileIndexSchema.parse(
      JSON.parse(readFileSync(join(dir, 'index.json'), 'utf-8')),
    );
    expect(index.profiles).toHaveLength(1);
    expect(index.profiles[0]).toMatchObject({
      id: 'test-profile',
      file: 'test-profile.json',
      gameCount: 1,
      platform: 'EUW1',
    });
    db.close();
  });
});
