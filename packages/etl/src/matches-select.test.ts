import type Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import type { PoolConfig } from '@draftorb/shared';

import { openDb, migrate } from './db';
import { cursorKey, newCursor, writeCursor } from './matches-store';
import { selectPlayers } from './matches-select';
import { PLATFORM, seedParticipant, seedPlayer } from './matches.test-helpers';

const POOL: PoolConfig = {
  schemaVersion: 1,
  pools: {
    SUPPORT: [{ championId: 267 }],
    TOP: [{ championId: 98 }],
  },
};

function markDone(db: Database.Database, puuid: string): void {
  writeCursor(db, cursorKey(PLATFORM, puuid), { ...newCursor([], 0), status: 'done' });
}

describe('selectPlayers', () => {
  it('prioritizes pending players with pool champion×role participant rows', () => {
    const db = openDb(':memory:');
    migrate(db);
    seedPlayer(db, 'p-high', 9);
    seedPlayer(db, 'p-mid', 7);
    seedPlayer(db, 'p-low', 5);
    // p-low played a pool pair (267 SUPPORT); p-mid saw pool champions in
    // other roles only, so neither champion nor role alone is enough.
    seedParticipant(db, {
      matchId: 'm1',
      puuid: 'p-low',
      championId: 267,
      role: 'SUPPORT',
    });
    seedParticipant(db, {
      matchId: 'm2',
      puuid: 'p-mid',
      championId: 267,
      role: 'TOP',
    });
    seedParticipant(db, {
      matchId: 'm3',
      puuid: 'p-mid',
      championId: 98,
      role: 'JUNGLE',
    });

    const selected = selectPlayers(db, PLATFORM, { poolConfig: POOL });

    expect(selected.map((p) => p.puuid)).toEqual(['p-low', 'p-high', 'p-mid']);
    expect(selected.map((p) => p.poolMatch)).toEqual([true, false, false]);
    db.close();
  });

  it('keeps rank order when no pool is configured', () => {
    const db = openDb(':memory:');
    migrate(db);
    seedPlayer(db, 'p-high', 9);
    seedPlayer(db, 'p-mid', 7);
    seedPlayer(db, 'p-low', 5);
    seedParticipant(db, {
      matchId: 'm1',
      puuid: 'p-low',
      championId: 267,
      role: 'SUPPORT',
    });

    const withoutPool = selectPlayers(db, PLATFORM, {});
    const emptyPool = selectPlayers(db, PLATFORM, {
      poolConfig: { schemaVersion: 1, pools: {} },
    });

    expect(withoutPool.map((p) => p.puuid)).toEqual(['p-high', 'p-mid', 'p-low']);
    expect(emptyPool.map((p) => p.puuid)).toEqual(withoutPool.map((p) => p.puuid));
    expect(withoutPool.every((p) => !p.poolMatch)).toBe(true);
    db.close();
  });

  it('keeps pending players ahead of done ones while prioritizing pool matches inside each group', () => {
    const db = openDb(':memory:');
    migrate(db);
    seedPlayer(db, 'p-done-pool', 9);
    seedPlayer(db, 'p-done-plain', 8);
    seedPlayer(db, 'p-pending-plain', 7);
    seedPlayer(db, 'p-pending-pool', 6);
    markDone(db, 'p-done-pool');
    markDone(db, 'p-done-plain');
    seedParticipant(db, {
      matchId: 'm1',
      puuid: 'p-done-pool',
      championId: 267,
      role: 'SUPPORT',
    });
    seedParticipant(db, {
      matchId: 'm2',
      puuid: 'p-pending-pool',
      championId: 98,
      role: 'TOP',
    });

    const selected = selectPlayers(db, PLATFORM, { poolConfig: POOL });

    expect(selected.map((p) => p.puuid)).toEqual([
      'p-pending-pool',
      'p-pending-plain',
      'p-done-pool',
      'p-done-plain',
    ]);
    expect(selected.map((p) => p.done)).toEqual([false, false, true, true]);
    db.close();
  });

  it('ignores participant rows from other platforms', () => {
    const db = openDb(':memory:');
    migrate(db);
    seedPlayer(db, 'p-low', 5);
    seedParticipant(db, {
      matchId: 'm-na',
      puuid: 'p-low',
      championId: 267,
      role: 'SUPPORT',
      platform: 'na1',
    });

    const selected = selectPlayers(db, PLATFORM, { poolConfig: POOL });

    expect(selected[0]?.poolMatch).toBe(false);
    db.close();
  });

  it('still scopes refresh runs to players with an ingest cursor', () => {
    const db = openDb(':memory:');
    migrate(db);
    seedPlayer(db, 'p-cursor', 5);
    seedPlayer(db, 'p-no-cursor', 9);
    seedParticipant(db, {
      matchId: 'm1',
      puuid: 'p-no-cursor',
      championId: 267,
      role: 'SUPPORT',
    });
    writeCursor(db, cursorKey(PLATFORM, 'p-cursor'), newCursor([], 0));

    const selected = selectPlayers(db, PLATFORM, { poolConfig: POOL, refresh: true });

    expect(selected.map((p) => p.puuid)).toEqual(['p-cursor']);
    db.close();
  });
});
