import { describe, expect, it, vi } from 'vitest';

import { openDb, migrate } from './db';
import { UsageError } from './cli-args';
import { ingestMatches } from './matches';
import { pruneMatches } from './prune';
import { seedPatches } from './patches.test-helpers';
import { comparePatches, cursorKey, patchFromGameVersion, windowWidened } from './matches-store';
import { parsePatchLabel, PATCH_LABEL_PATTERN } from './patches';
import {
  makeMatch,
  mockClient,
  PLATFORM,
  seedMatchPatches,
  seedPlayer,
} from './matches.test-helpers';
import { RiotApiError, RiotRateLimitError, RiotSchemaError } from './riot';
import type { Platform, RiotClient } from './riot';

describe('match ingestion', () => {
  it('extracts the patch from a game version', () => {
    expect(patchFromGameVersion('14.21.628.9812')).toBe('14.21');
    expect(patchFromGameVersion('16.21.1')).toBe('16.21');
  });

  it('derives the same major.minor label from gameVersion as Data Dragon versions (D-055)', () => {
    // Representative gameVersion strings: the stored matches.patch label must
    // equal the label Data Dragon assigns to the same patch, or it becomes an
    // orphan that aggregates exclude.
    for (const gameVersion of ['14.21.628.9812', '16.21.1.42', '15.1.1', '16.10.1.5']) {
      const label = patchFromGameVersion(gameVersion);
      expect(label).toBe(parsePatchLabel(gameVersion));
      expect(PATCH_LABEL_PATTERN.test(label)).toBe(true);
    }
  });

  it('stores no match whose patch label is absent from the patches table', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedMatchPatches(db);
    seedPlayer(db, 'p-alpha', 6.5);

    const client = mockClient(
      { 'p-alpha': ['EUW1_1'] },
      { EUW1_1: makeMatch('EUW1_1', { gameVersion: '16.22.1.9' }) },
    );
    await ingestMatches({ platform: PLATFORM, db, client });

    const orphans = db
      .prepare(
        `SELECT DISTINCT m.patch AS patch
         FROM matches m
         LEFT JOIN patches p ON p.version_label = m.patch
         WHERE p.version_label IS NULL`,
      )
      .all();
    expect(orphans).toEqual([]);
    db.close();
  });

  it('compares patches numerically and detects wider windows', () => {
    expect(comparePatches('16.9', '16.10')).toBeLessThan(0);
    expect(comparePatches('15.24', '16.1')).toBeLessThan(0);
    expect(comparePatches('16.10', '16.10')).toBe(0);
    expect(windowWidened(3, 1)).toBe(true);
    expect(windowWidened(3, undefined)).toBe(true);
    expect(windowWidened(1, 3)).toBe(false);
    expect(windowWidened(undefined, 3)).toBe(false);
  });

  it('stores valid matches with avg rank score from known participants', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedMatchPatches(db);
    seedPlayer(db, 'p-alpha', 6.5);
    seedPlayer(db, 'p-beta', 7);

    const match = makeMatch('EUW1_1', {
      participants: [{ puuid: 'p-alpha' }, { puuid: 'p-beta' }],
    });
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
      rank_known_count: number;
    };
    expect(row.platform).toBe('euw1');
    expect(row.patch).toBe('16.21');
    expect(row.queue_id).toBe(420);
    expect(row.duration).toBe(1800);
    expect(row.created_at).toBe(1_760_000_000_000);
    expect(row.avg_rank_score).toBeCloseTo(6.75); // mean of p-alpha (6.5) and p-beta (7)
    expect(row.rank_known_count).toBe(2);
    db.close();
  });

  it('includes the seed rank in every stored match rank summary', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedMatchPatches(db);
    seedPlayer(db, 'p-alpha', 6.5);
    seedPlayer(db, 'p-beta', 7);

    const unknownMatch = makeMatch('EUW1_UNKNOWN');
    const knownMatch = makeMatch('EUW1_KNOWN', {
      participants: [{ puuid: 'p-beta' }],
    });
    const client = mockClient(
      { 'p-alpha': ['EUW1_UNKNOWN', 'EUW1_KNOWN'] },
      { EUW1_UNKNOWN: unknownMatch, EUW1_KNOWN: knownMatch },
    );

    const result = await ingestMatches({ platform: PLATFORM, db, client });

    expect(result.stored).toBe(2);
    const unknownRow = db
      .prepare('SELECT avg_rank_score, rank_known_count FROM matches WHERE match_id = ?')
      .get('EUW1_UNKNOWN') as { avg_rank_score: number; rank_known_count: number };
    expect(unknownRow.avg_rank_score).toBe(6.5);
    expect(unknownRow.rank_known_count).toBe(1);
    const knownRow = db
      .prepare('SELECT avg_rank_score, rank_known_count FROM matches WHERE match_id = ?')
      .get('EUW1_KNOWN') as { avg_rank_score: number; rank_known_count: number };
    expect(knownRow.avg_rank_score).toBeCloseTo(6.75);
    expect(knownRow.rank_known_count).toBe(2);
    const rankCounts = db
      .prepare('SELECT rank_known_count FROM matches ORDER BY match_id')
      .all() as { rank_known_count: number }[];
    expect(rankCounts).toHaveLength(result.stored);
    expect(rankCounts.every(({ rank_known_count }) => rank_known_count >= 1)).toBe(true);
    db.close();
  });

  it('dedupes a match shared by two players without refetching it', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedMatchPatches(db);
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

  it('continues to later players after transient match-ID listing failures', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedMatchPatches(db);
    seedPlayer(db, 'p-alpha', 8);
    seedPlayer(db, 'p-beta', 7);
    seedPlayer(db, 'p-gamma', 6);
    const originalCursor = {
      status: 'partial',
      snapshot: ['EUW1_OLD'],
      processed: 0,
      lastGameCreation: 0,
      sincePatch: '16.21',
      stored: 0,
      duplicates: 0,
      filtered: 0,
      invalid: 0,
      updatedAt: 1,
    };
    db.prepare('INSERT INTO ingest_state (key, value) VALUES (?, ?)').run(
      cursorKey(PLATFORM, 'p-alpha'),
      JSON.stringify(originalCursor),
    );

    const client = {
      getMatchIdsByPuuid: vi.fn(async (_platform: Platform, puuid: string) => {
        if (puuid === 'p-alpha') {
          throw new RiotRateLimitError('Rate limit exhausted', 429, 'url', 1);
        }
        if (puuid === 'p-beta') {
          throw new RiotApiError('Network unavailable', 0, 'url');
        }
        return [];
      }),
      getMatch: vi.fn(),
    } as unknown as RiotClient & {
      getMatchIdsByPuuid: ReturnType<typeof vi.fn>;
      getMatch: ReturnType<typeof vi.fn>;
    };

    const result = await ingestMatches({ platform: PLATFORM, sincePatch: '16.19', db, client });

    expect(result.playersFailed).toBe(2);
    expect(result.playerResults.map(({ puuid, status }) => [puuid, status])).toEqual([
      ['p-alpha', 'failed'],
      ['p-beta', 'failed'],
      ['p-gamma', 'done'],
    ]);
    expect(client.getMatchIdsByPuuid).toHaveBeenCalledTimes(3);
    const savedCursor = db
      .prepare('SELECT value FROM ingest_state WHERE key = ?')
      .get(cursorKey(PLATFORM, 'p-alpha')) as { value: string };
    expect(JSON.parse(savedCursor.value)).toEqual(originalCursor);
    db.close();
  });

  it('applies the consecutive transient-failure limit across listing and detail requests', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedMatchPatches(db);
    seedPlayer(db, 'p-alpha', 10);
    seedPlayer(db, 'p-beta', 9);
    seedPlayer(db, 'p-gamma', 8);
    seedPlayer(db, 'p-delta', 7);

    const client = {
      getMatchIdsByPuuid: vi.fn(async (_platform: Platform, puuid: string) => {
        if (puuid === 'p-beta') return ['EUW1_1'];
        throw new RiotRateLimitError('Rate limit exhausted', 429, 'url', 1);
      }),
      getMatch: vi.fn(async () => {
        throw new RiotApiError('Network unavailable', 0, 'url');
      }),
    } as unknown as RiotClient & {
      getMatchIdsByPuuid: ReturnType<typeof vi.fn>;
      getMatch: ReturnType<typeof vi.fn>;
    };

    const result = await ingestMatches({ platform: PLATFORM, db, client });

    expect(result.playersFailed).toBe(3);
    expect(result.playerResults).toHaveLength(3);
    expect(client.getMatchIdsByPuuid).toHaveBeenCalledTimes(3);
    expect(client.getMatchIdsByPuuid).not.toHaveBeenCalledWith(PLATFORM, 'p-delta');
    db.close();
  });

  it('keeps equal and newer patches and rejects older patches into match_rejects', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedMatchPatches(db);
    seedPlayer(db, 'p-alpha', 6.5);

    const client = mockClient(
      { 'p-alpha': ['EUW1_Q', 'EUW1_S', 'EUW1_E', 'EUW1_P', 'EUW1_OK', 'EUW1_NEWER'] },
      {
        EUW1_Q: makeMatch('EUW1_Q', { queueId: 440 }), // flex queue
        EUW1_S: makeMatch('EUW1_S', { gameDuration: 420 }), // remake
        EUW1_E: makeMatch('EUW1_E', { gameDuration: 900 }), // exactly 15 min: not > 15 min
        EUW1_P: makeMatch('EUW1_P', { gameVersion: '16.19.3.1' }), // old patch
        EUW1_OK: makeMatch('EUW1_OK'),
        EUW1_NEWER: makeMatch('EUW1_NEWER', { gameVersion: '16.22.1.1' }),
      },
    );

    const result = await ingestMatches({ platform: PLATFORM, sincePatch: '16.21', db, client });

    expect(result.stored).toBe(2);
    expect(result.filtered).toBe(4);
    const rejects = db
      .prepare('SELECT match_id, reason, patch FROM match_rejects ORDER BY match_id')
      .all() as { match_id: string; reason: string; patch: string | null }[];
    expect(rejects).toEqual([
      { match_id: 'EUW1_E', reason: 'short', patch: null },
      { match_id: 'EUW1_P', reason: 'patch', patch: '16.19' },
      { match_id: 'EUW1_Q', reason: 'queue', patch: null },
      { match_id: 'EUW1_S', reason: 'short', patch: null },
    ]);
    db.close();
  });

  it('marks client schema failures as invalid matches', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedMatchPatches(db);
    seedPlayer(db, 'p-alpha', 6.5);

    const client = mockClient({ 'p-alpha': ['EUW1_BAD'] }, {});
    client.getMatch.mockRejectedValueOnce(
      new RiotSchemaError(
        'https://europe.api.riotgames.com/lol/match/v5/matches/EUW1_BAD',
        'missing info',
      ),
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
    seedMatchPatches(db);
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
    seedMatchPatches(db);
    seedPlayer(db, 'p-alpha', 6.5);

    const client = mockClient({ 'p-alpha': ['EUW1_1'] }, { EUW1_1: makeMatch('EUW1_1') });
    await ingestMatches({ platform: PLATFORM, sincePatch: '16.19', db, client });
    const firstCursor = db
      .prepare('SELECT value FROM ingest_state WHERE key = ?')
      .get(cursorKey(PLATFORM, 'p-alpha')) as { value: string };
    expect((JSON.parse(firstCursor.value) as { sincePatch?: string }).sincePatch).toBe('16.19');

    // Second run: the player is done, so the client should be queried with
    // startTime ~ lastGameCreation/1000 and pick up only the new id.
    const client2 = mockClient(
      { 'p-alpha': ['EUW1_2'] },
      { EUW1_2: makeMatch('EUW1_2', { gameCreation: 1_760_100_000_000 }) },
    );
    const result = await ingestMatches({
      platform: PLATFORM,
      sincePatch: '16.21',
      db,
      client: client2,
    });

    expect(client2.getMatchIdsByPuuid).toHaveBeenCalledWith(
      'euw1',
      'p-alpha',
      expect.objectContaining({ startTime: Math.floor(1_760_000_000_000 / 1000) }),
    );
    expect(result.stored).toBe(1);
    expect(result.sincePatch).toBe('16.21');
    const secondCursor = db
      .prepare('SELECT value FROM ingest_state WHERE key = ?')
      .get(cursorKey(PLATFORM, 'p-alpha')) as { value: string };
    expect((JSON.parse(secondCursor.value) as { sincePatch?: string }).sincePatch).toBe('16.21');
    const count = db.prepare('SELECT COUNT(*) AS n FROM matches').get() as { n: number };
    expect(count.n).toBe(2);
    db.close();
  });

  it('does not refetch a match rejected for patch until the target patch changes', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedMatchPatches(db);
    seedPlayer(db, 'p-alpha', 6.5);
    seedPlayer(db, 'p-beta', 7);

    const oldMatch = makeMatch('EUW1_OLD', { gameVersion: '16.19.3.1' });
    const client = mockClient(
      { 'p-alpha': ['EUW1_OLD'], 'p-beta': ['EUW1_OLD'] },
      { EUW1_OLD: oldMatch },
    );

    const r1 = await ingestMatches({ platform: PLATFORM, sincePatch: '16.21', db, client });
    expect(r1.filtered).toBe(2); // rejected for alpha, known-reject for beta
    expect(client.getMatch).toHaveBeenCalledTimes(1);

    // Same target patch: still no fetch.
    const r2 = await ingestMatches({ platform: PLATFORM, sincePatch: '16.21', db, client });
    expect(client.getMatch).toHaveBeenCalledTimes(1);
    expect(r2.filtered).toBe(2);

    // Lowering the lower bound relists in full so the rejected id is re-evaluated.
    const r3 = await ingestMatches({ platform: PLATFORM, sincePatch: '16.19', db, client });
    expect(client.getMatch).toHaveBeenCalledTimes(2);
    expect(client.getMatchIdsByPuuid).toHaveBeenLastCalledWith(
      'euw1',
      'p-alpha',
      expect.objectContaining({ startTime: undefined }),
    );
    expect(r3.stored).toBe(1);
    db.close();
  });

  it('removing sincePatch relists in full and recovers a patch-rejected match', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedMatchPatches(db);
    seedPlayer(db, 'p-alpha', 6.5);
    const client = mockClient(
      { 'p-alpha': ['EUW1_OLD'] },
      { EUW1_OLD: makeMatch('EUW1_OLD', { gameVersion: '16.19.3.1' }) },
    );

    const first = await ingestMatches({
      platform: PLATFORM,
      sincePatch: '16.21',
      db,
      client,
    });
    expect(first.filtered).toBe(1);

    const second = await ingestMatches({ platform: PLATFORM, db, client });

    expect(client.getMatchIdsByPuuid).toHaveBeenLastCalledWith(
      'euw1',
      'p-alpha',
      expect.objectContaining({ startTime: undefined }),
    );
    expect(client.getMatch).toHaveBeenCalledTimes(2);
    expect(second.stored).toBe(1);
    expect(second.sincePatch).toBeUndefined();
    db.close();
  });

  it('reset clears rejections so newly eligible matches are re-evaluated', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedMatchPatches(db);
    seedPlayer(db, 'p-alpha', 6.5);

    const client = mockClient(
      { 'p-alpha': ['EUW1_S'] },
      { EUW1_S: makeMatch('EUW1_S', { gameDuration: 600 }) },
    );

    const r1 = await ingestMatches({ platform: PLATFORM, db, client });
    expect(r1.filtered).toBe(1);
    expect(client.getMatch).toHaveBeenCalledTimes(1);

    // Lower the duration floor and reset: the old 'short' reject must not be
    // authoritative anymore — the match is refetched and stored.
    const r2 = await ingestMatches({
      platform: PLATFORM,
      minDurationSeconds: 300,
      db,
      client,
      reset: true,
    });
    expect(client.getMatch).toHaveBeenCalledTimes(2);
    expect(r2.stored).toBe(1);
    const rejects = db.prepare('SELECT COUNT(*) AS n FROM match_rejects').get() as { n: number };
    expect(rejects.n).toBe(0);
    db.close();
  });

  it('limit processes pending players before players already done', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedMatchPatches(db);
    seedPlayer(db, 'p-alpha', 7);
    seedPlayer(db, 'p-beta', 6.5);

    // First batch: only the top-ranked player is ingested.
    const c1 = mockClient({ 'p-alpha': ['EUW1_1'] }, { EUW1_1: makeMatch('EUW1_1') });
    const r1 = await ingestMatches({ platform: PLATFORM, playerLimit: 1, db, client: c1 });
    expect(r1.playerResults[0]?.puuid).toBe('p-alpha');

    // Second batch: the pending player goes first, even though it ranks lower.
    const c2 = mockClient({ 'p-beta': ['EUW1_2'] }, { EUW1_2: makeMatch('EUW1_2') });
    const r2 = await ingestMatches({ platform: PLATFORM, playerLimit: 1, db, client: c2 });
    expect(r2.playerResults[0]?.puuid).toBe('p-beta');
    expect(c2.getMatchIdsByPuuid).toHaveBeenCalledTimes(1);
    expect(c2.getMatchIdsByPuuid).toHaveBeenCalledWith('euw1', 'p-beta', expect.anything());
    db.close();
  });

  it('emits a progress log with per-player counts', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedMatchPatches(db);
    seedPlayer(db, 'p-alpha', 6.5);

    const lines: string[] = [];
    const client = mockClient({ 'p-alpha': ['EUW1_1'] }, { EUW1_1: makeMatch('EUW1_1') });
    await ingestMatches({ platform: PLATFORM, db, client, onProgress: (m) => lines.push(m) });

    expect(lines.some((l) => l.includes('[1/1]'))).toBe(true);
    expect(lines.some((l) => l.includes('Ingestion complete'))).toBe(true);
    db.close();
  });

  it('awaits the unenriched-match reprocess pass before returning (B-044)', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedMatchPatches(db);
    db.prepare(
      `INSERT INTO matches (match_id, platform, patch, queue_id, duration, created_at,
        avg_rank_score, rank_known_count)
       VALUES ('EUW1_OLD', 'euw1', '16.21', 420, 1800, 1, 6.5, 1)`,
    ).run();
    const insert = db.prepare(
      `INSERT INTO participants (
        match_id, puuid, team_id, champion_id, role, win, rank_score,
        champion_games, keystone, primary_style, sub_style, perks_json,
        items_json, kills, deaths, assists
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const roles = ['SUPPORT', 'ADC', 'TOP', 'JUNGLE', 'MID'] as const;
    for (let i = 0; i < 10; i += 1) {
      // p-0 is a ranked bot-lane seed; p-1 (ADC) is unranked so the pass must
      // hit the league-entries endpoint before it can finish.
      insert.run(
        'EUW1_OLD',
        `p-${i}`,
        i < 5 ? 100 : 200,
        100 + i,
        roles[i % 5],
        1,
        i === 0 ? 6.5 : null,
        100,
        8000,
        8000,
        8000,
        '{}',
        '[]',
        0,
        0,
        0,
      );
    }

    const client = mockClient({}, {});
    client.getLeagueEntriesByPuuid.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      return [];
    });
    client.getChampionMastery.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      return null;
    });

    await ingestMatches({ platform: PLATFORM, db, client });

    const row = db.prepare('SELECT enriched FROM matches WHERE match_id = ?').get('EUW1_OLD') as {
      enriched: number;
    };
    expect(row.enriched).toBe(1);
    db.close();
  });

  it('refreshes the patches table once when a match label is unknown, then stores it', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedMatchPatches(db);
    seedPlayer(db, 'p-alpha', 6.5);

    const match = makeMatch('EUW1_FUTURE', { gameVersion: '16.23.1.7' });
    const client = mockClient({ 'p-alpha': ['EUW1_FUTURE'] }, { EUW1_FUTURE: match });
    const versionsFetch = vi.fn(
      async () =>
        new Response(JSON.stringify(['16.23.1', '16.22.1', '16.21.1', '16.20.1', '16.19.1']), {
          status: 200,
        }),
    );

    const result = await ingestMatches({
      platform: PLATFORM,
      db,
      client,
      patchesFetchFn: versionsFetch as unknown as typeof fetch,
    });

    expect(result.stored).toBe(1);
    expect(versionsFetch).toHaveBeenCalledTimes(1);
    const patchRow = db
      .prepare('SELECT patch_index, version_label FROM patches WHERE version_label = ?')
      .get('16.23') as { patch_index: number; version_label: string };
    // Appended after the seeded maximum (4), never renumbered.
    expect(patchRow.patch_index).toBe(5);
    db.close();
  });

  it('rejects a match as invalid when its patch label is still unknown after refresh', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedMatchPatches(db);
    seedPlayer(db, 'p-alpha', 6.5);

    const match = makeMatch('EUW1_ODD', { gameVersion: '99.1.3.3' });
    const client = mockClient({ 'p-alpha': ['EUW1_ODD'] }, { EUW1_ODD: match });
    const versionsFetch = vi.fn(
      async () => new Response(JSON.stringify(['16.23.1', '16.22.1']), { status: 200 }),
    );

    const result = await ingestMatches({
      platform: PLATFORM,
      db,
      client,
      patchesFetchFn: versionsFetch as unknown as typeof fetch,
    });

    expect(result.invalid).toBe(1);
    expect(result.stored).toBe(0);
    expect(
      db.prepare('SELECT reason, patch FROM match_rejects WHERE match_id = ?').get('EUW1_ODD'),
    ).toMatchObject({ reason: 'invalid', patch: '99.1' });
    db.close();
  });

  it('treats a failed patches refresh as a transient player failure, not an invalid reject', async () => {
    const db = openDb(':memory:');
    migrate(db);
    // No seedMatchPatches: every label is unknown, so resolution must refresh.
    seedPlayer(db, 'p-alpha', 6.5);
    seedPlayer(db, 'p-beta', 7);
    seedPlayer(db, 'p-gamma', 6);

    const client = mockClient(
      { 'p-alpha': ['EUW1_1'], 'p-beta': ['EUW1_1'], 'p-gamma': ['EUW1_1'] },
      { EUW1_1: makeMatch('EUW1_1') },
    );
    const versionsFetch = vi.fn(async () => {
      throw new Error('socket hangup');
    });

    const result = await ingestMatches({
      platform: PLATFORM,
      db,
      client,
      patchesFetchFn: versionsFetch as unknown as typeof fetch,
    });

    expect(result.playersFailed).toBe(3);
    expect(result.stored).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM match_rejects').get()).toMatchObject({ n: 0 });
    db.close();
  });

  it('rejects an unknown --since-patch label instead of comparing version strings', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedMatchPatches(db);
    seedPlayer(db, 'p-alpha', 6.5);

    const client = mockClient({ 'p-alpha': [] }, {});
    const versionsFetch = vi.fn(
      async () => new Response(JSON.stringify(['16.23.1', '16.22.1']), { status: 200 }),
    );

    await expect(
      ingestMatches({
        platform: PLATFORM,
        sincePatch: '16.99',
        db,
        client,
        patchesFetchFn: versionsFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow('Unknown patch "16.99"');
    db.close();
  });

  it('keeps pruned tombstones on --reset while clearing other rejects (D-044)', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedMatchPatches(db);
    seedPlayer(db, 'p-alpha', 6.5);
    db.prepare(
      `INSERT INTO match_rejects (match_id, reason, patch, checked_at)
       VALUES ('EUW1_P', 'pruned', '16.19', 1)`,
    ).run();
    db.prepare(
      `INSERT INTO match_rejects (match_id, reason, patch, checked_at)
       VALUES ('EUW1_Q', 'queue', NULL, 1)`,
    ).run();

    const client = mockClient(
      { 'p-alpha': ['EUW1_P', 'EUW1_Q'] },
      { EUW1_Q: makeMatch('EUW1_Q', { gameDuration: 600 }) },
    );
    const result = await ingestMatches({ platform: PLATFORM, db, client, reset: true });

    // EUW1_P stays tombstoned (never fetched); EUW1_Q is re-evaluated and
    // rejected again as 'short' now that --reset cleared the old reject.
    expect(client.getMatch).toHaveBeenCalledTimes(1);
    expect(client.getMatch).toHaveBeenCalledWith('euw1', 'EUW1_Q');
    expect(result.filtered).toBe(2);
    const rejects = db
      .prepare('SELECT match_id, reason FROM match_rejects ORDER BY match_id')
      .all() as { match_id: string; reason: string }[];
    expect(rejects).toEqual([
      { match_id: 'EUW1_P', reason: 'pruned' },
      { match_id: 'EUW1_Q', reason: 'short' },
    ]);
    db.close();
  });

  it('clears pruned tombstones with resetTombstones so matches are fetchable again', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedMatchPatches(db);
    seedPlayer(db, 'p-alpha', 6.5);
    db.prepare(
      `INSERT INTO match_rejects (match_id, reason, patch, checked_at)
       VALUES ('EUW1_P', 'pruned', '16.21', 1)`,
    ).run();

    const client = mockClient({ 'p-alpha': ['EUW1_P'] }, { EUW1_P: makeMatch('EUW1_P') });
    const result = await ingestMatches({
      platform: PLATFORM,
      db,
      client,
      resetTombstones: true,
    });

    expect(client.getMatch).toHaveBeenCalledWith('euw1', 'EUW1_P');
    expect(result.stored).toBe(1);
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM match_rejects').get() as { n: number },
    ).toMatchObject({ n: 0 });
    db.close();
  });

  it('rejects --since-patch below the retention window unless resetTombstones is set', async () => {
    const db = openDb(':memory:');
    migrate(db);
    // 25 patches -> default bound is patch_index >= 6 ('16.6').
    seedPatches(
      db,
      Array.from({ length: 25 }, (_, i) => `16.${i + 1}`),
    );
    seedPlayer(db, 'p-alpha', 6.5);
    const client = mockClient({ 'p-alpha': [] }, {});

    await expect(
      ingestMatches({ platform: PLATFORM, sincePatch: '16.5', db, client }),
    ).rejects.toThrow(UsageError);
    await expect(
      ingestMatches({ platform: PLATFORM, sincePatch: '16.5', db, client }),
    ).rejects.toThrow(/retention window/);

    const result = await ingestMatches({
      platform: PLATFORM,
      sincePatch: '16.5',
      db,
      client,
      resetTombstones: true,
    });
    expect(result.sincePatch).toBe('16.5');
    db.close();
  });

  it('does not resurrect pruned matches when --since-patch widens the window', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedPatches(
      db,
      Array.from({ length: 25 }, (_, i) => `16.${i + 1}`),
    );
    seedPlayer(db, 'p-alpha', 6.5);
    db.prepare(
      `INSERT INTO matches (
        match_id, platform, patch, queue_id, duration, created_at, avg_rank_score, rank_known_count
      ) VALUES ('EUW1_P', 'euw1', '16.20', 420, 1800, 1, 6.5, 1)`,
    ).run();

    // Manual cut keeping 5 patches: cutoff 20 prunes '16.20' (index 20).
    const pruned = pruneMatches(db, { keepPatches: 5 });
    expect(pruned.matchesPruned).toBe(1);

    const client = mockClient(
      { 'p-alpha': ['EUW1_P'] },
      { EUW1_P: makeMatch('EUW1_P', { gameVersion: '16.20.1.1' }) },
    );
    // '16.10' (index 10) is inside the default bound (>= 6) and its window
    // includes the pruned patch: the permanent tombstone still wins.
    const result = await ingestMatches({
      platform: PLATFORM,
      sincePatch: '16.10',
      db,
      client,
    });

    expect(client.getMatch).not.toHaveBeenCalled();
    expect(result.stored).toBe(0);
    expect(result.filtered).toBe(1);
    expect(
      db.prepare('SELECT reason FROM match_rejects WHERE match_id = ?').get('EUW1_P'),
    ).toMatchObject({ reason: 'pruned' });
    db.close();
  });

  it('keeps matches pruned by a manual smaller cut on the next default ingestion', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedPatches(
      db,
      Array.from({ length: 25 }, (_, i) => `16.${i + 1}`),
    );
    seedPlayer(db, 'p-alpha', 6.5);
    db.prepare(
      `INSERT INTO matches (
        match_id, platform, patch, queue_id, duration, created_at, avg_rank_score, rank_known_count
      ) VALUES ('EUW1_P', 'euw1', '16.20', 420, 1800, 1, 6.5, 1)`,
    ).run();
    pruneMatches(db, { keepPatches: 5 });

    const client = mockClient(
      { 'p-alpha': ['EUW1_P'] },
      { EUW1_P: makeMatch('EUW1_P', { gameVersion: '16.20.1.1' }) },
    );
    const result = await ingestMatches({ platform: PLATFORM, db, client });

    expect(client.getMatch).not.toHaveBeenCalled();
    expect(result.stored).toBe(0);
    expect(result.filtered).toBe(1);
    db.close();
  });
});
