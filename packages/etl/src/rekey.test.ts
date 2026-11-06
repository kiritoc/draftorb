import { describe, expect, it, vi } from 'vitest';

import type { Platform, RiotClient, RiotMatchDto } from './riot';
import { openDb, migrate } from './db';
import { makeMatch, PLATFORM } from './matches.test-helpers';
import { planMatchPairs, rekeyPuuids, type StoredParticipantRef } from './rekey';

const ROLE_BY_TEAM_POSITION: Record<string, string> = {
  TOP: 'TOP',
  JUNGLE: 'JUNGLE',
  MIDDLE: 'MID',
  BOTTOM: 'ADC',
  UTILITY: 'SUPPORT',
};

function storedRowsFor(match: RiotMatchDto, oldPuuids: string[]): StoredParticipantRef[] {
  return match.info.participants.map((p, i) => ({
    puuid: oldPuuids[i] ?? `old-${i}`,
    team_id: p.teamId,
    champion_id: p.championId,
    kills: p.kills,
    deaths: p.deaths,
    assists: p.assists,
  }));
}

function insertStoredMatch(
  db: ReturnType<typeof openDb>,
  matchId: string,
  stored: StoredParticipantRef[],
  roles: string[],
): void {
  db.prepare(
    `INSERT INTO matches (match_id, platform, patch, queue_id, duration, created_at, avg_rank_score)
     VALUES (?, ?, '16.22', 420, 1800, 1760000000000, 5.0)`,
  ).run(matchId, PLATFORM);
  const insert = db.prepare(
    `INSERT INTO participants (
       match_id, puuid, team_id, champion_id, role, win, rank_score,
       keystone, primary_style, sub_style, perks_json, items_json,
       kills, deaths, assists
     ) VALUES (?, ?, ?, ?, ?, 1, 5.0, 1, 2, 3, '{}', '[]', ?, ?, ?)`,
  );
  stored.forEach((row, i) => {
    insert.run(
      matchId,
      row.puuid,
      row.team_id,
      row.champion_id,
      roles[i] ?? 'MID',
      row.kills,
      row.deaths,
      row.assists,
    );
  });
}

function rolesFor(match: RiotMatchDto): string[] {
  return match.info.participants.map((p) => ROLE_BY_TEAM_POSITION[p.teamPosition] ?? 'MID');
}

function seedCursor(db: ReturnType<typeof openDb>, puuid: string): void {
  db.prepare('INSERT INTO ingest_state (key, value) VALUES (?, ?)').run(
    `match-ingest:${PLATFORM}:${puuid}`,
    '{"status":"done"}',
  );
}

function mockClient(matches: Record<string, RiotMatchDto>) {
  return {
    getMatch: vi.fn(async (_platform: Platform, matchId: string) => {
      const match = matches[matchId];
      if (!match) throw new Error(`no match ${matchId}`);
      return match;
    }),
  } as unknown as RiotClient;
}

function first<T>(items: readonly T[]): T {
  const item = items[0];
  if (item === undefined) throw new Error('expected a non-empty array');
  return item;
}

function newPuuidsFor(match: RiotMatchDto, prefix: string): string[] {
  return match.info.participants.map((_, i) => `${prefix}-${i}`);
}

describe('planMatchPairs', () => {
  it('returns null when participant counts differ', () => {
    const match = makeMatch('M1');
    const stored = storedRowsFor(match, []).slice(0, 9);
    expect(planMatchPairs(stored, match.info.participants)).toBeNull();
  });

  it('returns null on duplicate fingerprints', () => {
    const match = makeMatch('M1');
    const stored = storedRowsFor(match, []);
    stored[1] = { ...first(stored) };
    expect(planMatchPairs(stored, match.info.participants)).toBeNull();
  });
});

describe('rekeyPuuids', () => {
  it('rewrites participants, players and cursors to the new puuids', async () => {
    const db = openDb(':memory:');
    migrate(db);
    const match = makeMatch('EUW1_1');
    const newIds = newPuuidsFor(match, 'new');
    const fresh = makeMatch('EUW1_1', {
      participants: match.info.participants.map((_, i) => ({ puuid: newIds[i] })),
    });
    const stored = storedRowsFor(match, []);
    insertStoredMatch(db, 'EUW1_1', stored, rolesFor(match));
    for (const row of stored) {
      db.prepare(
        `INSERT INTO players (puuid, platform, tier, division, lp, rank_score, updated_at)
         VALUES (?, 'euw1', 'DIAMOND', 'II', 50, 5.0, 0)`,
      ).run(row.puuid);
      seedCursor(db, row.puuid);
    }
    // A stale discovered player that never appears in any match.
    db.prepare(
      `INSERT INTO players (puuid, platform, tier, division, lp, rank_score, updated_at)
       VALUES ('stale-player', 'euw1', 'GOLD', 'IV', 0, 3.0, 0)`,
    ).run();
    seedCursor(db, 'stale-player');

    const stats = await rekeyPuuids(db, mockClient({ EUW1_1: fresh }), { log: () => undefined });

    expect(stats.matchesScanned).toBe(1);
    expect(stats.matchesFailed).toBe(0);
    const participantPuuids = (
      db.prepare('SELECT puuid FROM participants').all() as Array<{ puuid: string }>
    ).map((r) => r.puuid);
    expect(new Set(participantPuuids)).toEqual(new Set(newIds));
    const playerPuuids = new Set(
      (db.prepare('SELECT puuid FROM players').all() as Array<{ puuid: string }>).map(
        (r) => r.puuid,
      ),
    );
    expect(playerPuuids).toEqual(new Set(newIds));
    const cursorKeys = (
      db.prepare("SELECT key FROM ingest_state WHERE key LIKE 'match-ingest:%'").all() as Array<{
        key: string;
      }>
    ).map((r) => r.key);
    expect(cursorKeys.sort()).toEqual(newIds.map((p) => `match-ingest:${PLATFORM}:${p}`).sort());
    db.close();
  });

  it('merges players rows when the new puuid already exists', async () => {
    const db = openDb(':memory:');
    migrate(db);
    const match = makeMatch('EUW1_1');
    const newIds = newPuuidsFor(match, 'new');
    const fresh = makeMatch('EUW1_1', {
      participants: match.info.participants.map((_, i) => ({ puuid: newIds[i] })),
    });
    const stored = storedRowsFor(match, []);
    insertStoredMatch(db, 'EUW1_1', stored, rolesFor(match));
    for (const row of stored) {
      db.prepare(
        `INSERT INTO players (puuid, platform, tier, division, lp, rank_score, updated_at)
         VALUES (?, 'euw1', 'DIAMOND', 'II', 50, 5.0, 0)`,
      ).run(row.puuid);
    }
    db.prepare(
      `INSERT INTO players (puuid, platform, tier, division, lp, rank_score, updated_at)
       VALUES (?, 'euw1', 'MASTER', 'I', 400, 9.0, 0)`,
    ).run(first(newIds));

    const stats = await rekeyPuuids(db, mockClient({ EUW1_1: fresh }), { log: () => undefined });

    expect(stats.playersMerged).toBe(1);
    expect(stats.playersRenamed).toBe(9);
    const remaining = db
      .prepare('SELECT puuid FROM players WHERE puuid = ?')
      .all(first(stored).puuid) as unknown[];
    expect(remaining).toHaveLength(0);
    db.close();
  });

  it('dry run reports the mapping without writing', async () => {
    const db = openDb(':memory:');
    migrate(db);
    const match = makeMatch('EUW1_1');
    const newIds = newPuuidsFor(match, 'new');
    const fresh = makeMatch('EUW1_1', {
      participants: match.info.participants.map((_, i) => ({ puuid: newIds[i] })),
    });
    const stored = storedRowsFor(match, []);
    insertStoredMatch(db, 'EUW1_1', stored, rolesFor(match));

    const stats = await rekeyPuuids(db, mockClient({ EUW1_1: fresh }), {
      dryRun: true,
      log: () => undefined,
    });

    expect(stats.participantsRekeyed).toBe(0);
    const puuid = (db.prepare('SELECT puuid FROM participants LIMIT 1').get() as { puuid: string })
      .puuid;
    expect(puuid).toBe(first(stored).puuid);
    db.close();
  });

  it('keeps unmatched matches untouched and still applies the rest', async () => {
    const db = openDb(':memory:');
    migrate(db);
    const match = makeMatch('EUW1_1');
    const stored = storedRowsFor(match, []);
    insertStoredMatch(db, 'EUW1_1', stored, rolesFor(match));

    const stats = await rekeyPuuids(db, mockClient({}), { log: () => undefined });

    expect(stats.matchesScanned).toBe(0);
    expect(stats.matchesFailed).toBe(1);
    expect(stats.participantsRekeyed).toBe(0);
    const count = db.prepare('SELECT COUNT(*) AS c FROM participants').get() as { c: number };
    expect(count.c).toBe(10);
    db.close();
  });

  it('is idempotent: a second run maps puuids onto themselves', async () => {
    const db = openDb(':memory:');
    migrate(db);
    const match = makeMatch('EUW1_1');
    const newIds = newPuuidsFor(match, 'new');
    const fresh = makeMatch('EUW1_1', {
      participants: match.info.participants.map((_, i) => ({ puuid: newIds[i] })),
    });
    const stored = storedRowsFor(match, []);
    insertStoredMatch(db, 'EUW1_1', stored, rolesFor(match));
    const client = mockClient({ EUW1_1: fresh });

    await rekeyPuuids(db, client, { log: () => undefined });
    const second = await rekeyPuuids(db, client, { log: () => undefined });

    expect(second.participantsRekeyed).toBe(0);
    const puuids = new Set(
      (db.prepare('SELECT puuid FROM participants').all() as Array<{ puuid: string }>).map(
        (r) => r.puuid,
      ),
    );
    expect(puuids).toEqual(new Set(newIds));
    db.close();
  });
});
