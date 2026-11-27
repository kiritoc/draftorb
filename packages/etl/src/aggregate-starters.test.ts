import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, nEff } from '@draftorb/engine';

import { openDb, migrate } from './db';
import { aggregateStarterBundles, STARTER_CONTEXT_LEVELS } from './aggregate-starters';
import { seedMatch } from './aggregate-runes.test';
import type { StarterCtxRow } from './aggregate-starters';

const TEST_CONFIG = { ...DEFAULT_CONFIG, evidenceMinDistinctPlayers: 1 };

function dbWith(): ReturnType<typeof openDb> {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

function addStarter(
  db: ReturnType<typeof openDb>,
  matchId: string,
  puuid: string,
  bundleKey: string,
  participantId = 1,
): void {
  db.prepare(
    `INSERT OR REPLACE INTO participant_starters
     (match_id, participant_id, puuid, bundle_json) VALUES (?, ?, ?, ?)`,
  ).run(matchId, participantId, puuid, bundleKey);
}

function rowFor(
  rows: StarterCtxRow[],
  contextKey: string,
  opts: { championId?: number | null; myRole?: string | null; rankBucket?: string } = {},
): StarterCtxRow | undefined {
  return rows.find(
    (r) =>
      r.contextKey === contextKey &&
      (opts.championId === undefined || r.championId === opts.championId) &&
      (opts.myRole === undefined || r.myRole === opts.myRole) &&
      (opts.rankBucket === undefined || r.rankBucket === opts.rankBucket),
  );
}

describe('aggregateStarterBundles', () => {
  it('emits the four-level back-off chain for each starter bundle', () => {
    const db = dbWith();
    const matchId = seedMatch(db);
    // p-me: Soraka (412) SUPPORT, win=1.
    addStarter(db, matchId, 'p-me', '2052:1,3340:1');

    const rows = aggregateStarterBundles(db, { config: TEST_CONFIG });

    const champion = rowFor(rows, 'champion', { championId: 412, myRole: 'SUPPORT' });
    expect(champion?.contextLevel).toBe(STARTER_CONTEXT_LEVELS.champion);
    expect(champion?.bundleKey).toBe('2052:1,3340:1');
    expect(champion?.players).toBe(1);
    expect(champion?.winsW).toBeGreaterThan(0);

    const role = rowFor(rows, 'role', { championId: null, myRole: 'SUPPORT' });
    expect(role?.contextLevel).toBe(STARTER_CONTEXT_LEVELS.role);

    const global = rowFor(rows, 'global', { championId: null, myRole: null });
    expect(global?.contextLevel).toBe(STARTER_CONTEXT_LEVELS.global);

    // Exact lane level exists for SUPPORT (lane group has slots).
    const lane = rows.find(
      (r) =>
        r.contextKey.startsWith('lane:') &&
        r.championId === 412 &&
        r.myRole === 'SUPPORT' &&
        r.bundleKey === '2052:1,3340:1',
    );
    expect(lane?.contextLevel).toBe(STARTER_CONTEXT_LEVELS.lane);
    expect(nEff(lane?.gamesW ?? 0, lane?.gamesW2 ?? 0)).toBeGreaterThan(0);
    db.close();
  });

  it('keeps distinct bundles in separate rows', () => {
    const db = dbWith();
    const m1 = seedMatch(db);
    addStarter(db, m1, 'p-me', '2052:1');
    const m2 = seedMatch(db);
    addStarter(db, m2, 'p-me', '3340:1,3865:1');

    const rows = aggregateStarterBundles(db, { config: TEST_CONFIG });
    const bundles = new Set(
      rows
        .filter((r) => r.contextKey === 'champion' && r.championId === 412)
        .map((r) => r.bundleKey),
    );
    expect(bundles).toEqual(new Set(['2052:1', '3340:1,3865:1']));
    db.close();
  });

  it('suppresses rows below evidenceMinDistinctPlayers but still clears the table', () => {
    const db = dbWith();
    const m1 = seedMatch(db);
    addStarter(db, m1, 'p-me', '2052:1');

    // One distinct player: min 1 passes, min 2 suppresses and clears.
    const passing = aggregateStarterBundles(db, { config: TEST_CONFIG });
    expect(passing.length).toBeGreaterThan(0);

    aggregateStarterBundles(db, {
      config: { ...DEFAULT_CONFIG, evidenceMinDistinctPlayers: 2 },
    });
    const after = db.prepare('SELECT COUNT(*) AS n FROM starter_ctx').get() as { n: number };
    expect(after.n).toBe(0);
    db.close();
  });

  it('is idempotent: a second run reproduces the same rows', () => {
    const db = dbWith();
    const m1 = seedMatch(db);
    addStarter(db, m1, 'p-me', '2052:1');
    const first = aggregateStarterBundles(db, { config: TEST_CONFIG });
    const second = aggregateStarterBundles(db, { config: TEST_CONFIG });
    expect(second).toEqual(first);
    db.close();
  });
});
