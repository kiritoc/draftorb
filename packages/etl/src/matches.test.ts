import { describe, expect, it, vi } from 'vitest';

import { openDb, migrate } from './db';
import { ingestMatches } from './matches';
import { cursorKey, patchFromGameVersion } from './matches-store';
import type { Platform, RiotClient, RiotMatchDto } from './riot';

const PLATFORM: Platform = 'euw1';

function seedPlayer(db: ReturnType<typeof openDb>, puuid: string, rankScore: number): void {
  db.prepare(
    `INSERT INTO players (puuid, platform, tier, division, lp, rank_score, updated_at)
     VALUES (?, 'euw1', 'DIAMOND', 'II', 50, ?, 0)`,
  ).run(puuid, rankScore);
}

function participant(puuid: string): Record<string, unknown> {
  return {
    puuid,
    teamId: 100,
    championId: 412,
    teamPosition: 'UTILITY',
    win: true,
    kills: 1,
    deaths: 2,
    assists: 10,
  };
}

function makeMatch(matchId: string, over: Record<string, unknown> = {}): RiotMatchDto {
  return {
    metadata: { matchId, participants: ['seed-player'] },
    info: {
      gameCreation: 1_760_000_000_000,
      gameDuration: 1800,
      gameId: 1,
      gameMode: 'CLASSIC',
      gameVersion: '16.21.1.42',
      queueId: 420,
      participants: [participant('seed-player')],
      ...over,
    },
  } as unknown as RiotMatchDto;
}

function mockClient(ids: Record<string, string[]>, matches: Record<string, unknown>) {
  return {
    getMatchIdsByPuuid: vi.fn(async (_platform: Platform, puuid: string) => ids[puuid] ?? []),
    getMatch: vi.fn(async (_platform: Platform, matchId: string) => matches[matchId]),
  } as unknown as RiotClient & {
    getMatchIdsByPuuid: ReturnType<typeof vi.fn>;
    getMatch: ReturnType<typeof vi.fn>;
  };
}

describe('match ingestion', () => {
  it('extracts the patch from a game version', () => {
    expect(patchFromGameVersion('14.21.628.9812')).toBe('14.21');
    expect(patchFromGameVersion('16.21.1')).toBe('16.21');
  });

  it('stores valid matches with avg rank score from known participants', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedPlayer(db, 'p-alpha', 6.5);
    seedPlayer(db, 'p-beta', 7);

    const match = makeMatch('EUW1_1', {
      participants: [participant('p-alpha'), participant('p-beta'), participant('unknown')],
    });
    match.metadata.participants = ['p-alpha', 'p-beta', 'unknown'];
    const client = mockClient({ 'p-alpha': ['EUW1_1'], 'p-beta': [] }, { EUW1_1: match });

    const result = await ingestMatches({ platform: PLATFORM, db, client });

    expect(result.stored).toBe(1);
    const row = db.prepare('SELECT * FROM matches WHERE match_id = ?').get('EUW1_1') as {
      platform: string;
      patch: string;
      queue_id: number;
      duration: number;
      created_at: number;
      avg_rank_score: number;
    };
    expect(row.platform).toBe('euw1');
    expect(row.patch).toBe('16.21');
    expect(row.queue_id).toBe(420);
    expect(row.duration).toBe(1800);
    expect(row.created_at).toBe(1_760_000_000_000);
    expect(row.avg_rank_score).toBeCloseTo(6.75); // mean of p-alpha (6.5) and p-beta (7)
    db.close();
  });

  it('dedupes a match shared by two players without refetching it', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedPlayer(db, 'p-alpha', 6.5);
    seedPlayer(db, 'p-beta', 7);

    const client = mockClient(
      { 'p-alpha': ['EUW1_1'], 'p-beta': ['EUW1_1'] },
      { EUW1_1: makeMatch('EUW1_1') },
    );

    const result = await ingestMatches({ platform: PLATFORM, db, client });

    expect(result.stored).toBe(1);
    expect(result.duplicates).toBe(1);
    const count = db.prepare('SELECT COUNT(*) AS n FROM matches').get() as { n: number };
    expect(count.n).toBe(1); // no duplicate rows
    expect(client.getMatch).toHaveBeenCalledTimes(1);
    db.close();
  });

  it('filters off-queue, short and off-patch matches into match_rejects', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedPlayer(db, 'p-alpha', 6.5);

    const client = mockClient(
      { 'p-alpha': ['EUW1_Q', 'EUW1_S', 'EUW1_P', 'EUW1_OK'] },
      {
        EUW1_Q: makeMatch('EUW1_Q', { queueId: 440 }), // flex queue
        EUW1_S: makeMatch('EUW1_S', { gameDuration: 420 }), // remake
        EUW1_P: makeMatch('EUW1_P', { gameVersion: '16.19.3.1' }), // old patch
        EUW1_OK: makeMatch('EUW1_OK'),
      },
    );

    const result = await ingestMatches({ platform: PLATFORM, patch: '16.21', db, client });

    expect(result.stored).toBe(1);
    expect(result.filtered).toBe(3);
    const rejects = db
      .prepare('SELECT match_id, reason, patch FROM match_rejects ORDER BY match_id')
      .all() as { match_id: string; reason: string; patch: string | null }[];
    expect(rejects).toEqual([
      { match_id: 'EUW1_P', reason: 'patch', patch: '16.19' },
      { match_id: 'EUW1_Q', reason: 'queue', patch: null },
      { match_id: 'EUW1_S', reason: 'short', patch: null },
    ]);
    db.close();
  });

  it('revalidates payloads and marks schema mismatches invalid', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedPlayer(db, 'p-alpha', 6.5);

    const client = mockClient(
      { 'p-alpha': ['EUW1_BAD'] },
      { EUW1_BAD: { unexpected: 'shape' } }, // client returns raw on schema mismatch
    );

    const result = await ingestMatches({ platform: PLATFORM, db, client });

    expect(result.invalid).toBe(1);
    expect(result.stored).toBe(0);
    const count = db.prepare('SELECT COUNT(*) AS n FROM matches').get() as { n: number };
    expect(count.n).toBe(0);
    const reject = db
      .prepare('SELECT reason FROM match_rejects WHERE match_id = ?')
      .get('EUW1_BAD') as {
      reason: string;
    };
    expect(reject.reason).toBe('invalid');
    db.close();
  });

  it('resumes a killed run from the stored cursor', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedPlayer(db, 'p-alpha', 6.5);

    // Simulate a kill after the first of two ids was processed.
    db.prepare(
      `INSERT INTO matches (match_id, platform, patch, queue_id, duration, created_at, avg_rank_score)
       VALUES ('EUW1_1', 'euw1', '16.21', 420, 1800, 1760000000000, 6.5)`,
    ).run();
    db.prepare('INSERT INTO ingest_state (key, value) VALUES (?, ?)').run(
      cursorKey(PLATFORM, 'p-alpha'),
      JSON.stringify({
        status: 'partial',
        snapshot: ['EUW1_1', 'EUW1_2'],
        processed: 1,
        lastGameCreation: 1_760_000_000_000,
        stored: 1,
        duplicates: 0,
        filtered: 0,
        invalid: 0,
        updatedAt: 1,
      }),
    );

    const client = mockClient(
      { 'p-alpha': ['EUW1_1', 'EUW1_2'] },
      { EUW1_2: makeMatch('EUW1_2', { gameCreation: 1_760_000_100_000 }) },
    );

    const result = await ingestMatches({ platform: PLATFORM, db, client });

    expect(result.stored).toBe(1); // only EUW1_2 stored this run
    expect(result.duplicates).toBe(0);
    const count = db.prepare('SELECT COUNT(*) AS n FROM matches').get() as { n: number };
    expect(count.n).toBe(2);
    // No id re-listing and no refetch of the already-processed match.
    expect(client.getMatchIdsByPuuid).not.toHaveBeenCalled();
    expect(client.getMatch).toHaveBeenCalledTimes(1);
    expect(client.getMatch).toHaveBeenCalledWith('euw1', 'EUW1_2');
    db.close();
  });

  it('incrementally picks up new matches for a completed player', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedPlayer(db, 'p-alpha', 6.5);

    const client = mockClient({ 'p-alpha': ['EUW1_1'] }, { EUW1_1: makeMatch('EUW1_1') });
    await ingestMatches({ platform: PLATFORM, db, client });

    // Second run: the player is done, so the client should be queried with
    // startTime ~ lastGameCreation/1000 and pick up only the new id.
    const client2 = mockClient(
      { 'p-alpha': ['EUW1_2'] },
      { EUW1_2: makeMatch('EUW1_2', { gameCreation: 1_760_100_000_000 }) },
    );
    const result = await ingestMatches({ platform: PLATFORM, db, client: client2 });

    expect(client2.getMatchIdsByPuuid).toHaveBeenCalledWith(
      'euw1',
      'p-alpha',
      expect.objectContaining({ startTime: Math.floor(1_760_000_000_000 / 1000) }),
    );
    expect(result.stored).toBe(1);
    const count = db.prepare('SELECT COUNT(*) AS n FROM matches').get() as { n: number };
    expect(count.n).toBe(2);
    db.close();
  });

  it('does not refetch a match rejected for patch until the target patch changes', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedPlayer(db, 'p-alpha', 6.5);
    seedPlayer(db, 'p-beta', 7);

    const oldMatch = makeMatch('EUW1_OLD', { gameVersion: '16.19.3.1' });
    const client = mockClient(
      { 'p-alpha': ['EUW1_OLD'], 'p-beta': ['EUW1_OLD'] },
      { EUW1_OLD: oldMatch },
    );

    const r1 = await ingestMatches({ platform: PLATFORM, patch: '16.21', db, client });
    expect(r1.filtered).toBe(2); // rejected for alpha, known-reject for beta
    expect(client.getMatch).toHaveBeenCalledTimes(1);

    // Same target patch: still no fetch.
    const r2 = await ingestMatches({ platform: PLATFORM, patch: '16.21', db, client, reset: true });
    expect(client.getMatch).toHaveBeenCalledTimes(1);
    expect(r2.filtered).toBe(2);

    // New target patch matching the stored reject: the match is refetched and stored.
    const r3 = await ingestMatches({ platform: PLATFORM, patch: '16.19', db, client, reset: true });
    expect(client.getMatch).toHaveBeenCalledTimes(2);
    expect(r3.stored).toBe(1);
    db.close();
  });

  it('emits a progress log with per-player counts', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedPlayer(db, 'p-alpha', 6.5);

    const lines: string[] = [];
    const client = mockClient({ 'p-alpha': ['EUW1_1'] }, { EUW1_1: makeMatch('EUW1_1') });
    await ingestMatches({ platform: PLATFORM, db, client, onProgress: (m) => lines.push(m) });

    expect(lines.some((l) => l.includes('[1/1]'))).toBe(true);
    expect(lines.some((l) => l.includes('Ingestion complete'))).toBe(true);
    db.close();
  });
});
