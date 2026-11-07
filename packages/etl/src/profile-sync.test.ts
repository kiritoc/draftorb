import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { profileExportSchema, profileIndexSchema } from '@draftorb/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { openDb, migrate } from './db';
import { makeMatch } from './matches.test-helpers';
import { syncProfiles, type ProfileSyncOptions } from './profile-sync';
import type { RiotClient, RiotMatchDto } from './riot';
import { CliError } from './cli-args';
import { RiotAuthError } from './riot/types';

const DAY_MS = 86_400_000;
const NOW_MS = 1_760_000_000_000;
const PROFILE_PUUID = 'profile-puuid-0000';

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'profile-sync-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function writeConfig(dir: string, profileMaxGames?: number): string {
  const path = join(dir, 'profiles.config.json');
  writeFileSync(
    path,
    JSON.stringify({
      schemaVersion: 1,
      profiles: [
        {
          id: 'test-profile',
          riotId: { gameName: 'Test', tagLine: 'One' },
          platform: 'EUW1',
          label: "Test's picks",
          options: profileMaxGames === undefined ? {} : { profileMaxGames },
        },
      ],
    }),
  );
  return path;
}

/** Match where participant index 0 (team-100 SUPPORT) is the profile player. */
function profileMatch(matchId: string, createdAtMs: number): RiotMatchDto {
  return makeMatch(matchId, {
    gameCreation: createdAtMs,
    participants: [{ puuid: PROFILE_PUUID, spell1Id: 4, spell2Id: 7 }],
  });
}

const TIMELINE = {
  info: {
    frames: [
      {
        events: [
          { timestamp: 30_000, type: 'ITEM_PURCHASED', participantId: 5, itemId: 3858 },
          { timestamp: 10_000, type: 'ITEM_PURCHASED', participantId: 5, itemId: 3340 },
        ],
      },
    ],
  },
};

interface MockClientSpec {
  ids: string[];
  matches: Record<string, RiotMatchDto>;
  mastery?: { championId: number; championPoints: number; championLevel?: number }[];
  failOn?: string[];
}

function mockClient(spec: MockClientSpec) {
  return {
    getAccountByRiotId: vi.fn(async () => ({
      puuid: PROFILE_PUUID,
      gameName: 'Test',
      tagLine: 'One',
    })),
    getMatchIdsByPuuid: vi.fn(
      async (
        _region: string,
        _puuid: string,
        options?: { startTime?: number },
      ): Promise<string[]> => {
        const startTime = options?.startTime;
        return spec.ids.filter((id) => {
          const match = spec.matches[id];
          if (!match) return true;
          return startTime === undefined || match.info.gameCreation >= startTime * 1000;
        });
      },
    ),
    getMatch: vi.fn(async (_region: string, matchId: string) => {
      if (spec.failOn?.includes(matchId)) throw new Error(`boom ${matchId}`);
      const match = spec.matches[matchId];
      if (!match) throw new Error(`no match ${matchId}`);
      return match;
    }),
    getMatchTimeline: vi.fn(async () => TIMELINE),
    getChampionMasteryTop: vi.fn(async () => spec.mastery ?? []),
  } as unknown as RiotClient & {
    getMatch: ReturnType<typeof vi.fn>;
    getMatchIdsByPuuid: ReturnType<typeof vi.fn>;
  };
}

function baseOptions(
  dir: string,
  client: RiotClient,
  overrides: Partial<ProfileSyncOptions> = {},
): ProfileSyncOptions {
  return {
    configPath: writeConfig(dir),
    exportDir: join(dir, 'out'),
    db: openDb(':memory:'),
    client,
    now: () => NOW_MS,
    ...overrides,
  };
}

describe('syncProfiles', () => {
  it('syncs games + mastery and writes a schema-valid anonymized export', async () => {
    const dir = tempDir();
    const matches = {
      M1: profileMatch('M1', NOW_MS - 5 * DAY_MS),
      M2: profileMatch('M2', NOW_MS - 10 * DAY_MS),
    };
    const client = mockClient({
      ids: ['M1', 'M2'],
      matches,
      mastery: [{ championId: 412, championPoints: 5000, championLevel: 3 }],
    });
    const options = baseOptions(dir, client);
    migrate(options.db!);
    const result = await syncProfiles(options);
    options.db!.close();

    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0]).toMatchObject({
      id: 'test-profile',
      status: 'synced',
      stored: 2,
      mastery: 1,
    });

    const exported = profileExportSchema.parse(
      JSON.parse(readFileSync(join(dir, 'out', 'test-profile.json'), 'utf-8')),
    );
    expect(exported.gameCount).toBe(2);
    expect(exported.games[0]!.itemsOrdered).toEqual([3340, 3858]);
    expect(exported.mastery[0]).toMatchObject({ championId: 412, points: 5000 });
    const serialized = JSON.stringify(exported);
    expect(serialized).not.toContain('M1');
    expect(serialized).not.toContain(PROFILE_PUUID.slice(0, 8));

    const index = profileIndexSchema.parse(
      JSON.parse(readFileSync(join(dir, 'out', 'index.json'), 'utf-8')),
    );
    expect(index.profiles[0]!.file).toBe('test-profile.json');
    expect(result.written.length).toBeGreaterThan(0);
  });

  it('is idempotent: a second run fetches no match details when nothing is new', async () => {
    const dir = tempDir();
    const matches = { M1: profileMatch('M1', NOW_MS - DAY_MS) };
    const client = mockClient({ ids: ['M1'], matches });
    const options = baseOptions(dir, client);
    migrate(options.db!);
    await syncProfiles(options);
    const callsAfterFirst = (client.getMatch as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callsAfterFirst).toBe(1);

    // Second run: same DB (re-open via same instance), same ids -> all duplicates.
    const result2 = await syncProfiles({ ...options, db: options.db });
    options.db!.close();
    expect(result2.profiles[0]!.stored).toBe(0);
    expect(result2.profiles[0]!.duplicates).toBe(1);
    expect((client.getMatch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterFirst);
  });

  it('fetches only newer matches on incremental runs', async () => {
    const dir = tempDir();
    const matches = {
      M1: profileMatch('M1', NOW_MS - 2 * DAY_MS),
      M2: profileMatch('M2', NOW_MS - DAY_MS),
    };
    const client = mockClient({ ids: ['M1', 'M2'], matches });
    const options = baseOptions(dir, client, { maxGames: 1 });
    migrate(options.db!);
    const first = await syncProfiles(options);
    // maxGames=1: only the newest match (M2? ids order M1,M2 — listed order) is fetched.
    expect(first.profiles[0]!.stored).toBe(1);

    const second = await syncProfiles({ ...options, db: options.db });
    options.db!.close();
    const exported = profileExportSchema.parse(
      JSON.parse(readFileSync(join(dir, 'out', 'test-profile.json'), 'utf-8')),
    );
    expect(exported.gameCount).toBe(2);
    expect(second.profiles[0]!.stored + second.profiles[0]!.duplicates).toBe(1);
  });

  it('keeps the previous export and stored rows when a Riot call fails', async () => {
    const dir = tempDir();
    const matches = {
      M1: profileMatch('M1', NOW_MS - 2 * DAY_MS),
      // M2 is newer than M1 so incremental listing (startTime cursor)
      // surfaces it on the second run.
      M2: profileMatch('M2', NOW_MS - DAY_MS),
    };
    const client = mockClient({ ids: ['M1', 'M2'], matches, failOn: ['M2'] });
    const options = baseOptions(dir, client);
    migrate(options.db!);

    // First successful run with only M1.
    const client1 = mockClient({ ids: ['M1'], matches });
    await syncProfiles({ ...options, client: client1 });
    const exportPath = join(dir, 'out', 'test-profile.json');
    const before = readFileSync(exportPath, 'utf-8');

    // Second run: M2 appears but its detail fetch fails -> whole sync fails,
    // previous export untouched, M1 row still stored.
    await expect(syncProfiles({ ...options, db: options.db, client })).rejects.toThrow(CliError);
    options.db!.close();
    expect(readFileSync(exportPath, 'utf-8')).toBe(before);
  });

  it('does not advance syncedAt when a later sync fails', async () => {
    const dir = tempDir();
    const matches = { M1: profileMatch('M1', NOW_MS - 2 * DAY_MS) };
    const client1 = mockClient({ ids: ['M1'], matches });
    const options = baseOptions(dir, client1);
    migrate(options.db!);
    await syncProfiles(options);
    const exportPath = join(dir, 'out', 'test-profile.json');
    const syncedAtBefore = profileExportSchema.parse(
      JSON.parse(readFileSync(exportPath, 'utf-8')),
    ).syncedAt;

    // A newer match appears but its fetch fails, one day later.
    const later = NOW_MS + DAY_MS;
    const failing = mockClient({
      ids: ['M2', 'M1'],
      matches: { ...matches, M2: profileMatch('M2', later - DAY_MS) },
      failOn: ['M2'],
    });
    await expect(
      syncProfiles({ ...options, db: options.db, client: failing, now: () => later }),
    ).rejects.toThrow(CliError);
    options.db!.close();
    const syncedAtAfter = profileExportSchema.parse(
      JSON.parse(readFileSync(exportPath, 'utf-8')),
    ).syncedAt;
    expect(syncedAtAfter).toBe(syncedAtBefore);
  });

  it('skips games older than the 180-day export window', async () => {
    const dir = tempDir();
    const matches = {
      NEW: profileMatch('NEW', NOW_MS - DAY_MS),
      OLD: profileMatch('OLD', NOW_MS - 200 * DAY_MS),
    };
    const client = mockClient({ ids: ['NEW', 'OLD'], matches });
    const options = baseOptions(dir, client);
    migrate(options.db!);
    const result = await syncProfiles(options);
    options.db!.close();
    expect(result.profiles[0]!.stored).toBe(1);
    const exported = profileExportSchema.parse(
      JSON.parse(readFileSync(join(dir, 'out', 'test-profile.json'), 'utf-8')),
    );
    expect(exported.gameCount).toBe(1);
  });

  it('aborts the whole run on auth errors without writing exports', async () => {
    const dir = tempDir();
    const client = mockClient({
      ids: ['M1'],
      matches: { M1: profileMatch('M1', NOW_MS - DAY_MS) },
    });
    client.getMatch.mockImplementation(async () => {
      throw new RiotAuthError('unauthorized', 401, 'https://example.test');
    });
    const options = baseOptions(dir, client);
    migrate(options.db!);
    await expect(syncProfiles(options)).rejects.toThrow(RiotAuthError);
    options.db!.close();
    // No export files at all: a bad key must not publish partial state (D-070).
    expect(() => readFileSync(join(dir, 'out', 'test-profile.json'), 'utf-8')).toThrow();
  });

  it('rejects an unknown profile id as a usage error', async () => {
    const dir = tempDir();
    const client = mockClient({ ids: [], matches: {} });
    const options = baseOptions(dir, client, { profileId: 'nope' });
    migrate(options.db!);
    await expect(syncProfiles(options)).rejects.toThrow(/Unknown profile id/);
    options.db!.close();
  });
});
