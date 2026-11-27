import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, nEff } from '@draftorb/engine';

import { openDb, migrate } from './db';
import {
  aggregateSummonersByContext,
  spellPairKey,
  type SummonerCtxRow,
} from './aggregate-summoners';
import { seedMatch } from './aggregate-runes.test';

const TEST_CONFIG = { ...DEFAULT_CONFIG, evidenceMinDistinctPlayers: 1 };

function dbWith(): ReturnType<typeof openDb> {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

function setSummoners(
  db: ReturnType<typeof openDb>,
  matchId: string,
  spells: Record<string, [number, number]>,
): void {
  const stmt = db.prepare(
    'UPDATE participants SET summoner1_id = ?, summoner2_id = ? WHERE match_id = ? AND puuid = ?',
  );
  for (const [puuid, [s1, s2]] of Object.entries(spells)) {
    stmt.run(s1, s2, matchId, puuid);
  }
}

function rowFor(
  rows: SummonerCtxRow[],
  championId: number,
  myRole: string,
  contextKey: string,
  spellPair: string,
): SummonerCtxRow | undefined {
  return rows.find(
    (r) =>
      r.championId === championId &&
      r.myRole === myRole &&
      r.contextKey === contextKey &&
      r.spellPair === spellPair &&
      r.rankBucket === 'DIAMOND',
  );
}

describe('spellPairKey', () => {
  it('normalizes the unordered pair to min:max', () => {
    expect(spellPairKey(4, 14)).toBe('4:14');
    expect(spellPairKey(14, 4)).toBe('4:14');
    expect(spellPairKey(11, 4)).toBe('4:11');
  });
});

describe('aggregateSummonersByContext', () => {
  it('aggregates spell pairs per champion/role/context with evidence fields', () => {
    const db = dbWith();
    const matchId = seedMatch(db);
    // p-me is Soraka (412) SUPPORT, win=1.
    setSummoners(db, matchId, {
      'p-me': [14, 4], // Ignite + Flash -> normalized 4:14
      'p-adc': [4, 7],
      'p-ensup': [4, 12],
    });

    const rows = aggregateSummonersByContext(db, { config: TEST_CONFIG });

    const me = rowFor(rows, 412, 'SUPPORT', 'global', '4:14');
    expect(me).toBeDefined();
    expect(me?.players).toBe(1);
    expect(nEff(me?.gamesW ?? 0, me?.gamesW2 ?? 0)).toBeGreaterThan(0);
    expect(me?.winsW).toBeGreaterThan(0);

    // The same participant also lands in the champion and lane contexts.
    const lane = rows.find(
      (r) =>
        r.championId === 412 &&
        r.myRole === 'SUPPORT' &&
        r.contextKey.startsWith('lane:') &&
        r.spellPair === '4:14' &&
        r.rankBucket === 'DIAMOND',
    );
    expect(lane).toBeDefined();
    db.close();
  });

  it('skips participants with NULL spell ids (pre-backfill rows)', () => {
    const db = dbWith();
    seedMatch(db); // no setSummoners call: all spell ids stay NULL
    const rows = aggregateSummonersByContext(db, { config: TEST_CONFIG });
    expect(rows).toHaveLength(0);
    db.close();
  });

  it('suppresses rows below evidenceMinDistinctPlayers but still clears the table', () => {
    const db = dbWith();
    const m1 = seedMatch(db);
    setSummoners(db, m1, { 'p-me': [4, 14] });
    const m2 = seedMatch(db, {
      participants: [
        {
          teamId: 100,
          championId: 412,
          role: 'SUPPORT',
          win: 0,
          puuid: 'p-me-2',
          championGames: 100,
          perksJson: '{}',
        },
      ],
    });
    setSummoners(db, m2, { 'p-me-2': [4, 14] });

    // Two distinct players -> passes min 2; min 3 must suppress everything.
    const passing = aggregateSummonersByContext(db, {
      config: { ...DEFAULT_CONFIG, evidenceMinDistinctPlayers: 2 },
    });
    expect(passing.length).toBeGreaterThan(0);

    aggregateSummonersByContext(db, {
      config: { ...DEFAULT_CONFIG, evidenceMinDistinctPlayers: 3 },
      onWrite: () => {
        /* table cleared */
      },
    });
    const after = db.prepare('SELECT COUNT(*) AS n FROM summoner_ctx').get() as { n: number };
    expect(after.n).toBe(0);
    db.close();
  });

  it('is idempotent: a second run reproduces the same rows', () => {
    const db = dbWith();
    const m1 = seedMatch(db);
    setSummoners(db, m1, { 'p-me': [4, 14] });
    const first = aggregateSummonersByContext(db, { config: TEST_CONFIG });
    const second = aggregateSummonersByContext(db, { config: TEST_CONFIG });
    expect(second).toEqual(first);
    db.close();
  });
});
