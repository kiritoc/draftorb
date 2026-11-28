import type Database from 'better-sqlite3';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { migrate, openDb } from './db';
import { makeMatch } from './matches.test-helpers';
import {
  runProfileStartersBackfill,
  type ProfileStartersBackfillOptions,
} from './profile-starters-backfill';
import type { RiotClient, RiotMatchTimeline } from './riot';

const PROFILE_ID = 'test-profile';
const PROFILE_PUUID = 'profile-puuid-0000';
const OTHER_PUUID = 'other-puuid-1111';

const databases: Database.Database[] = [];
function testDb(): Database.Database {
  const db = openDb(':memory:');
  databases.push(db);
  migrate(db);
  return db;
}
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function seedProfile(db: Database.Database, id = PROFILE_ID): void {
  db.prepare(
    `INSERT INTO profiles (id, puuid, game_name, tag_line, platform, region, synced_at, last_game_creation)
     VALUES (?, ?, 'Test', 'One', 'EUW1', 'europe', 0, NULL)`,
  ).run(id, PROFILE_PUUID);
}

function seedGame(
  db: Database.Database,
  matchId: string,
  starterBundleJson: string | null = null,
  profileId = PROFILE_ID,
  createdAt = 1_760_000_000_000,
): void {
  db.prepare(
    `INSERT INTO profile_games (
      profile_id, match_id, created_at, champion_id, role, win,
      ally_adc_id, enemy_support_id, enemy_adc_id, enemy_champions_json,
      keystone, primary_style, sub_style, perks_json,
      items_json, items_ordered_json, starter_bundle_json, summoner1_id, summoner2_id
    ) VALUES (?, ?, ?, 412, 'SUPPORT', 1, NULL, NULL, NULL, '[]',
      NULL, NULL, NULL, NULL, '[]', NULL, ?, 4, 7)`,
  ).run(profileId, matchId, createdAt, starterBundleJson);
}

function bundleOf(db: Database.Database, matchId: string): string | null {
  const row = db
    .prepare('SELECT starter_bundle_json FROM profile_games WHERE match_id = ?')
    .get(matchId) as { starter_bundle_json: string | null } | undefined;
  return row?.starter_bundle_json ?? null;
}

/** Match where participant index 0 (participantId 5, SUPPORT) is the profile. */
function profileMatch(matchId: string): ReturnType<typeof makeMatch> {
  return makeMatch(matchId, {
    participants: [{ puuid: PROFILE_PUUID, spell1Id: 4, spell2Id: 7 }],
  });
}

const TIMELINE_WITH_PURCHASES: RiotMatchTimeline = {
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
} as RiotMatchTimeline;

const TIMELINE_EMPTY: RiotMatchTimeline = { info: { frames: [] } } as RiotMatchTimeline;

interface MockClientSpec {
  matches?: Record<string, ReturnType<typeof makeMatch>>;
  timelines?: Record<string, RiotMatchTimeline>;
  failMatchOn?: Record<string, Error>;
  failTimelineOn?: Record<string, Error>;
}

function mockClient(spec: MockClientSpec) {
  return {
    getMatch: vi.fn(async (_region: string, matchId: string) => {
      const failure = spec.failMatchOn?.[matchId];
      if (failure) throw failure;
      const match = spec.matches?.[matchId];
      if (!match) throw new Error(`no match ${matchId}`);
      return match;
    }),
    getMatchTimeline: vi.fn(async (_region: string, matchId: string) => {
      const failure = spec.failTimelineOn?.[matchId];
      if (failure) throw failure;
      const timeline = spec.timelines?.[matchId];
      if (!timeline) throw new Error(`no timeline ${matchId}`);
      return timeline;
    }),
  } as unknown as RiotClient & {
    getMatch: ReturnType<typeof vi.fn>;
    getMatchTimeline: ReturnType<typeof vi.fn>;
  };
}

function baseOptions(
  db: Database.Database,
  client: RiotClient,
  overrides: Partial<Omit<ProfileStartersBackfillOptions, 'db' | 'client'>> = {},
): ProfileStartersBackfillOptions {
  return { db, client, ...overrides };
}

describe('runProfileStartersBackfill', () => {
  it('backfills only NULL starter_bundle_json rows and writes the net bundle', async () => {
    const db = testDb();
    seedProfile(db);
    seedGame(db, 'M1');
    seedGame(db, 'M2');
    // Already populated: must be neither selected nor fetched.
    seedGame(db, 'M3', JSON.stringify([{ itemId: 1001, count: 1 }]));

    const client = mockClient({
      matches: { M1: profileMatch('M1'), M2: profileMatch('M2') },
      timelines: { M1: TIMELINE_WITH_PURCHASES, M2: TIMELINE_WITH_PURCHASES },
    });
    const result = await runProfileStartersBackfill(baseOptions(db, client));

    expect(result.candidates).toBe(2);
    expect(result.processed).toBe(2);
    expect(result.failed).toBe(0);
    expect(bundleOf(db, 'M1')).toBe(
      JSON.stringify([
        { itemId: 3340, count: 1 },
        { itemId: 3858, count: 1 },
      ]),
    );
    expect(bundleOf(db, 'M2')).not.toBeNull();
    expect(bundleOf(db, 'M3')).toBe(JSON.stringify([{ itemId: 1001, count: 1 }]));
    expect(client.getMatch).toHaveBeenCalledTimes(2);
    expect(client.getMatchTimeline).toHaveBeenCalledTimes(2);
    // Routing comes from the stored profile region ('europe').
    expect(client.getMatch).toHaveBeenCalledWith('europe', 'M1');
  });

  it('is resumable: a second run finds no candidates once every row is filled', async () => {
    const db = testDb();
    seedProfile(db);
    seedGame(db, 'M1');
    const client = mockClient({
      matches: { M1: profileMatch('M1') },
      timelines: { M1: TIMELINE_EMPTY },
    });
    const first = await runProfileStartersBackfill(baseOptions(db, client));
    expect(first.processed).toBe(1);
    // Empty window is stored as '[]' so the row leaves the pending set.
    expect(bundleOf(db, 'M1')).toBe('[]');

    const second = await runProfileStartersBackfill(baseOptions(db, client));
    expect(second.candidates).toBe(0);
    expect(client.getMatch).toHaveBeenCalledTimes(1);
  });

  it('honours --limit', async () => {
    const db = testDb();
    seedProfile(db);
    seedGame(db, 'M1', null, PROFILE_ID, 3);
    seedGame(db, 'M2', null, PROFILE_ID, 2);
    seedGame(db, 'M3', null, PROFILE_ID, 1);
    const matches = { M1: profileMatch('M1'), M2: profileMatch('M2'), M3: profileMatch('M3') };
    const timelines = {
      M1: TIMELINE_WITH_PURCHASES,
      M2: TIMELINE_WITH_PURCHASES,
      M3: TIMELINE_WITH_PURCHASES,
    };

    const limited = mockClient({ matches, timelines });
    const limitResult = await runProfileStartersBackfill(baseOptions(db, limited, { limit: 2 }));
    // Newest first: M1 then M2; M3 stays pending for the next run.
    expect(limitResult.candidates).toBe(2);
    expect(limitResult.processed).toBe(2);
    expect(bundleOf(db, 'M1')).not.toBeNull();
    expect(bundleOf(db, 'M2')).not.toBeNull();
    expect(bundleOf(db, 'M3')).toBeNull();
  });

  it('honours --call-budget (2 calls per game: detail + timeline)', async () => {
    const db = testDb();
    seedProfile(db);
    seedGame(db, 'M1', null, PROFILE_ID, 2);
    seedGame(db, 'M2', null, PROFILE_ID, 1);
    const matches = { M1: profileMatch('M1'), M2: profileMatch('M2') };
    const timelines = { M1: TIMELINE_WITH_PURCHASES, M2: TIMELINE_WITH_PURCHASES };

    const budgeted = mockClient({ matches, timelines });
    const budgetResult = await runProfileStartersBackfill(
      baseOptions(db, budgeted, { callBudget: 3 }),
    );
    // M1 costs 2 calls; the budget then covers only M2's detail call, so M2
    // stays NULL and the run reports the budget as exhausted.
    expect(budgetResult.budgetExhausted).toBe(true);
    expect(budgetResult.processed).toBe(1);
    expect(bundleOf(db, 'M1')).not.toBeNull();
    expect(bundleOf(db, 'M2')).toBeNull();
    expect(budgeted.getMatchTimeline).toHaveBeenCalledTimes(1);
  });

  it('filters by profile id', async () => {
    const db = testDb();
    seedProfile(db, 'alpha');
    seedProfile(db, 'beta');
    db.prepare(`UPDATE profiles SET puuid = ? WHERE id = 'beta'`).run(OTHER_PUUID);
    seedGame(db, 'MA', null, 'alpha');
    seedGame(db, 'MB', null, 'beta');

    const client = mockClient({
      matches: { MA: profileMatch('MA') },
      timelines: { MA: TIMELINE_WITH_PURCHASES },
    });
    const result = await runProfileStartersBackfill(
      baseOptions(db, client, { profileId: 'alpha' }),
    );
    expect(result.candidates).toBe(1);
    expect(bundleOf(db, 'MA')).not.toBeNull();
    expect(bundleOf(db, 'MB')).toBeNull();
  });

  it('leaves transient failures NULL and counts permanent failures as skipped', async () => {
    const db = testDb();
    seedProfile(db);
    seedGame(db, 'TRANSIENT', null, PROFILE_ID, 3);
    seedGame(db, 'GONE', null, PROFILE_ID, 2);
    seedGame(db, 'OK', null, PROFILE_ID, 1);

    const client = mockClient({
      matches: { OK: profileMatch('OK') },
      timelines: { OK: TIMELINE_WITH_PURCHASES },
      failMatchOn: {
        TRANSIENT: new Error('fetch failed: network timeout'),
        GONE: new Error('match detail no longer available'),
      },
    });
    const result = await runProfileStartersBackfill(baseOptions(db, client));

    expect(result.failed).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.processed).toBe(1);
    // Transient stays pending; permanent is marked checked with '[]'.
    expect(bundleOf(db, 'TRANSIENT')).toBeNull();
    expect(bundleOf(db, 'GONE')).toBe('[]');
    expect(bundleOf(db, 'OK')).not.toBeNull();
  });

  it('stops early after 3 consecutive transient failures', async () => {
    const db = testDb();
    seedProfile(db);
    for (const [i, id] of ['A', 'B', 'C', 'D'].entries()) {
      seedGame(db, id, null, PROFILE_ID, 4 - i);
    }
    const client = mockClient({
      failMatchOn: Object.fromEntries(
        ['A', 'B', 'C', 'D'].map((id) => [id, new Error('network reset')]),
      ),
    });
    const result = await runProfileStartersBackfill(baseOptions(db, client));
    expect(result.stoppedEarly).toBe(true);
    expect(result.failed).toBe(3);
    expect(client.getMatch).toHaveBeenCalledTimes(3);
  });
});
