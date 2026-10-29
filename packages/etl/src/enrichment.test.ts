import { describe, expect, it, vi } from 'vitest';

import type Database from 'better-sqlite3';
import { openDb, migrate } from './db';
import { enrichParticipants } from './enrichment';
import type { EnrichmentOptions } from './enrichment';
import type { ParticipantRow } from './participants';
import { extractParticipants } from './participants';
import { seedPlayer, makeMatch, PLATFORM } from './matches.test-helpers';
import { prepareMatchPersist } from './matches-persist';
import { playerRankScore } from './players';
import {
  RiotClient,
  RiotApiError,
  RiotAuthError,
  RiotRateLimitError,
  RiotRateLimiter,
} from './riot';
import type { Platform, RiotChampionMastery } from './riot';

const SEED_PUUID = 'puuid-ally-support';
const SEED_RANK_SCORE = 6.75;
const DUMMY_API_KEY = 'RGAPI-test-api-key-12345';

function createMockResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const isString = typeof body === 'string';
  const textBody = isString ? body : JSON.stringify(body);
  const responseHeaders = new Headers({
    'Content-Type': 'application/json',
    ...headers,
  });

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: responseHeaders,
    text: async () => textBody,
    json: async () => (isString ? JSON.parse(textBody) : body),
  } as unknown as Response;
}

function makeLeagueEntry(tier: string, division: string, lp = 50): Record<string, unknown> {
  return {
    queueType: 'RANKED_SOLO_5x5',
    tier,
    rank: division,
    leaguePoints: lp,
    wins: 100,
    losses: 50,
    veteran: false,
    inactive: false,
    freshBlood: false,
    hotStreak: false,
  };
}

function makeMastery(championId: number, championPoints: number): RiotChampionMastery {
  return {
    championId,
    championPoints,
    championLevel: 5,
    lastPlayTime: 1_700_000_000_000,
    chestGranted: false,
    tokensEarned: 0,
  };
}

type MockClient = RiotClient & {
  getLeagueEntriesByPuuid: ReturnType<typeof vi.fn>;
  getChampionMastery: ReturnType<typeof vi.fn>;
};

function createMockClient(): MockClient {
  return {
    getLeagueEntriesByPuuid: vi.fn(),
    getChampionMastery: vi.fn(),
  } as unknown as MockClient;
}

function setupDb(
  matchId: string,
  seedRankScore = SEED_RANK_SCORE,
): {
  db: Database.Database;
  participants: ParticipantRow[];
} {
  const db = openDb(':memory:');
  migrate(db);
  seedPlayer(db, SEED_PUUID, seedRankScore);

  const stmts = prepareMatchPersist(db);
  const matchRow = {
    match_id: matchId,
    platform: PLATFORM,
    patch: '16.21',
    queue_id: 420,
    duration: 1800,
    created_at: 1_760_000_000_000,
    avg_rank_score: seedRankScore,
    rank_known_count: 1,
  };
  stmts.insertMatch.run(matchRow);

  const match = makeMatch(matchId);
  const ranks = new Map([[SEED_PUUID, seedRankScore]]);
  const participants = extractParticipants(match, ranks);

  for (const p of participants) {
    stmts.insertParticipant.run(p);
  }

  return { db, participants };
}

function baseOptions(db: Database.Database, client: RiotClient): EnrichmentOptions {
  return {
    db,
    client,
    platform: PLATFORM,
    minChampGames: 30,
    myRole: 'SUPPORT',
    seedPuuid: SEED_PUUID,
    seedRankScore: SEED_RANK_SCORE,
  };
}

describe('getChampionMastery HTTP error handling', () => {
  it('returns null on 404 (player never played the champion)', async () => {
    const mockFetch = vi.fn().mockResolvedValue(createMockResponse(404, 'Not found'));

    const client = new RiotClient({
      apiKey: DUMMY_API_KEY,
      fetchFn: mockFetch,
      sleepFn: async () => {},
    });

    const result = await client.getChampionMastery('euw1', 'test-puuid', 412);
    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 and honors Retry-After header', async () => {
    let fetchCalls = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      fetchCalls++;
      if (fetchCalls === 1) {
        return createMockResponse(429, 'Rate limited', {
          'Retry-After': '2',
          'X-Rate-Limit-Type': 'application',
        });
      }
      return createMockResponse(200, makeMastery(412, 50000));
    });

    const client = new RiotClient({
      apiKey: DUMMY_API_KEY,
      fetchFn: mockFetch,
      sleepFn: async () => {},
    });

    const result = await client.getChampionMastery('euw1', 'test-puuid', 412);
    expect(result).toMatchObject({ championId: 412, championPoints: 50000 });
    expect(fetchCalls).toBe(2);
  });

  it('retries 5xx with exponential backoff and throws when exhausted', async () => {
    const mockFetch = vi.fn().mockResolvedValue(createMockResponse(500, 'Server error'));

    const client = new RiotClient({
      apiKey: DUMMY_API_KEY,
      fetchFn: mockFetch,
      sleepFn: async () => {},
      max5xxRetries: 2,
      initialBackoffMs: 100,
    });

    await expect(client.getChampionMastery('euw1', 'test-puuid', 412)).rejects.toThrow(
      RiotApiError,
    );
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws RiotAuthError on 401 and does not retry', async () => {
    const mockFetch = vi.fn().mockResolvedValue(createMockResponse(401, 'Unauthorized'));

    const client = new RiotClient({
      apiKey: DUMMY_API_KEY,
      fetchFn: mockFetch,
      sleepFn: async () => {},
    });

    await expect(client.getChampionMastery('euw1', 'test-puuid', 412)).rejects.toThrow(
      RiotAuthError,
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('throws RiotRateLimitError when 429 retries are exhausted', async () => {
    const mockFetch = vi.fn().mockImplementation(async () => {
      return createMockResponse(429, 'Rate limited', { 'Retry-After': '1' });
    });

    const client = new RiotClient({
      apiKey: DUMMY_API_KEY,
      fetchFn: mockFetch,
      sleepFn: async () => {},
      max429Retries: 2,
    });

    await expect(client.getChampionMastery('euw1', 'test-puuid', 412)).rejects.toThrow(
      RiotRateLimitError,
    );
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('enforces rate limiting across multiple getChampionMastery calls', async () => {
    let currentTime = 1000;
    let sleptTotal = 0;

    const rateLimiter = new RiotRateLimiter({
      appLimits: [{ maxRequests: 2, windowSeconds: 1 }],
      now: () => currentTime,
      sleep: async (ms) => {
        sleptTotal += ms;
        currentTime += ms;
      },
    });

    const mockFetch = vi.fn().mockResolvedValue(createMockResponse(200, makeMastery(412, 50000)));

    const client = new RiotClient({
      apiKey: DUMMY_API_KEY,
      fetchFn: mockFetch,
      rateLimiter,
    });

    await client.getChampionMastery('euw1', 'p-uuid-1', 412);
    await client.getChampionMastery('euw1', 'p-uuid-2', 412);
    await client.getChampionMastery('euw1', 'p-uuid-3', 412);

    expect(sleptTotal).toBe(1000);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('builds the correct mastery-by-champion URL with platform routing', async () => {
    let requestedUrl = '';
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      requestedUrl = url;
      return createMockResponse(200, makeMastery(412, 50000));
    });

    const client = new RiotClient({
      apiKey: DUMMY_API_KEY,
      fetchFn: mockFetch,
      sleepFn: async () => {},
    });

    await client.getChampionMastery('euw1', 'test-puuid-123', 412);

    expect(requestedUrl).toBe(
      'https://euw1.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/test-puuid-123/by-champion/412',
    );
  });
});

describe('enrichParticipants — rank enrichment', () => {
  it('fetches ranks for non-cached bot-lane participants and caches them', async () => {
    const { db, participants } = setupDb('EUW1_RANKS');
    const client = createMockClient();

    client.getLeagueEntriesByPuuid.mockImplementation(async (_platform, puuid) => {
      const ranks: Record<string, Record<string, unknown>> = {
        'puuid-ally-adc': makeLeagueEntry('DIAMOND', 'III', 40),
        'puuid-enemy-adc': makeLeagueEntry('PLATINUM', 'I', 30),
        'puuid-enemy-support': makeLeagueEntry('GOLD', 'II', 60),
      };
      return [ranks[puuid]];
    });

    const summary = await enrichParticipants('EUW1_RANKS', participants, baseOptions(db, client));

    expect(summary.ranksFetched).toBe(3);
    expect(summary.ranksCached).toBe(1);
    expect(summary.ranksUnranked).toBe(0);

    const allyAdc = db
      .prepare('SELECT puuid, tier, division, rank_score FROM players WHERE puuid = ?')
      .get('puuid-ally-adc') as {
      puuid: string;
      tier: string;
      division: string;
      rank_score: number | null;
    };

    expect(allyAdc).toMatchObject({
      tier: 'DIAMOND',
      division: 'III',
      rank_score: playerRankScore('DIAMOND', 'III'),
    });

    const enemyAdc = db
      .prepare('SELECT puuid, tier, division, rank_score FROM players WHERE puuid = ?')
      .get('puuid-enemy-adc') as {
      puuid: string;
      tier: string;
      division: string;
      rank_score: number | null;
    };

    expect(enemyAdc).toMatchObject({
      tier: 'PLATINUM',
      division: 'I',
      rank_score: playerRankScore('PLATINUM', 'I'),
    });

    db.close();
  });

  it('skips the seed player (rank already known)', async () => {
    const { db, participants } = setupDb('EUW1_SEED');
    const client = createMockClient();

    client.getLeagueEntriesByPuuid.mockResolvedValue([makeLeagueEntry('DIAMOND', 'II', 50)]);

    await enrichParticipants('EUW1_SEED', participants, baseOptions(db, client));

    const calledPuuuids = client.getLeagueEntriesByPuuid.mock.calls.map(
      (call) => call[1] as string,
    );
    expect(calledPuuuids).not.toContain(SEED_PUUID);
  });

  it('skips players already cached in the players table', async () => {
    const { db, participants } = setupDb('EUW1_CACHED');
    const client = createMockClient();

    db.prepare(
      `INSERT INTO players (puuid, platform, tier, division, lp, rank_score, updated_at)
       VALUES (?, 'euw1', 'DIAMOND', 'I', 80, ?, 0)`,
    ).run('puuid-ally-adc', playerRankScore('DIAMOND', 'I'));

    client.getLeagueEntriesByPuuid.mockResolvedValue([makeLeagueEntry('DIAMOND', 'II', 50)]);

    await enrichParticipants('EUW1_CACHED', participants, baseOptions(db, client));

    const calledPuuuids = client.getLeagueEntriesByPuuid.mock.calls.map(
      (call) => call[1] as string,
    );
    expect(calledPuuuids).not.toContain('puuid-ally-adc');
  });

  it('caches unranked players with NULL rank_score so they are never re-fetched', async () => {
    const { db, participants } = setupDb('EUW1_UNRANKED');
    const client = createMockClient();

    client.getLeagueEntriesByPuuid.mockImplementation(async (_platform, puuid) => {
      if (puuid === 'puuid-ally-adc') return [makeLeagueEntry('DIAMOND', 'II', 50)];
      return []; // unranked for enemy-adc and enemy-support
    });

    const summary = await enrichParticipants(
      'EUW1_UNRANKED',
      participants,
      baseOptions(db, client),
    );

    expect(summary.ranksFetched).toBe(3);
    expect(summary.ranksUnranked).toBe(2);

    const unrankedAdc = db
      .prepare('SELECT puuid, rank_score FROM players WHERE puuid = ?')
      .get('puuid-enemy-adc') as { puuid: string; rank_score: number | null };

    expect(unrankedAdc).toBeDefined();
    expect(unrankedAdc.rank_score).toBeNull();

    const unrankedSupport = db
      .prepare('SELECT puuid, rank_score FROM players WHERE puuid = ?')
      .get('puuid-enemy-support') as { puuid: string; rank_score: number | null };

    expect(unrankedSupport).toBeDefined();
    expect(unrankedSupport.rank_score).toBeNull();

    db.close();
  });

  it('does not re-fetch cached PUUIDs on re-run (idempotence)', async () => {
    const { db, participants } = setupDb('EUW1_IDEM_RANK');
    const client = createMockClient();

    client.getLeagueEntriesByPuuid.mockResolvedValue([makeLeagueEntry('DIAMOND', 'II', 50)]);

    await enrichParticipants('EUW1_IDEM_RANK', participants, baseOptions(db, client));
    const callsAfterFirst = client.getLeagueEntriesByPuuid.mock.calls.length;

    await enrichParticipants('EUW1_IDEM_RANK', participants, baseOptions(db, client));

    expect(client.getLeagueEntriesByPuuid.mock.calls.length).toBe(callsAfterFirst);

    db.close();
  });
});

describe('enrichParticipants — champion games and mastery', () => {
  it('computes champion_games for all 10 participants from existing rows', async () => {
    const { db, participants } = setupDb('EUW1_GAMES');
    const client = createMockClient();

    client.getLeagueEntriesByPuuid.mockResolvedValue([makeLeagueEntry('DIAMOND', 'II', 50)]);
    client.getChampionMastery.mockResolvedValue(makeMastery(412, 50000));

    await enrichParticipants('EUW1_GAMES', participants, baseOptions(db, client));

    const rows = db
      .prepare(
        'SELECT puuid, champion_id, champion_games FROM participants WHERE match_id = ? ORDER BY puuid',
      )
      .all('EUW1_GAMES') as { puuid: string; champion_id: number; champion_games: number }[];

    expect(rows).toHaveLength(10);
    expect(rows.every((r) => r.champion_games === 1)).toBe(true);

    db.close();
  });

  it('counts games across multiple matches for the same (puuid, champion) pair', async () => {
    const { db, participants } = setupDb('EUW1_GAMES_1');
    const client = createMockClient();

    client.getLeagueEntriesByPuuid.mockResolvedValue([makeLeagueEntry('DIAMOND', 'II', 50)]);
    client.getChampionMastery.mockResolvedValue(makeMastery(412, 50000));

    await enrichParticipants('EUW1_GAMES_1', participants, baseOptions(db, client));

    const stmts = prepareMatchPersist(db);
    const match2 = makeMatch('EUW1_GAMES_2');
    const ranks2 = new Map([[SEED_PUUID, SEED_RANK_SCORE]]);
    const participants2 = extractParticipants(match2, ranks2);

    const matchRow2 = {
      match_id: 'EUW1_GAMES_2',
      platform: PLATFORM,
      patch: '16.21',
      queue_id: 420,
      duration: 1800,
      created_at: 1_760_000_000_000,
      avg_rank_score: SEED_RANK_SCORE,
      rank_known_count: 1,
    };
    stmts.insertMatch.run(matchRow2);
    for (const p of participants2) {
      stmts.insertParticipant.run(p);
    }

    const client2 = createMockClient();
    client2.getLeagueEntriesByPuuid.mockResolvedValue([makeLeagueEntry('DIAMOND', 'II', 50)]);

    await enrichParticipants('EUW1_GAMES_2', participants2, baseOptions(db, client2));

    const gameCount = db
      .prepare('SELECT champion_games FROM participants WHERE match_id = ? AND puuid = ?')
      .get('EUW1_GAMES_2', SEED_PUUID) as { champion_games: number };
    expect(gameCount.champion_games).toBe(2);

    db.close();
  });

  it('fetches mastery for myRole participants with fewer than minChampGames', async () => {
    const { db, participants } = setupDb('EUW1_MASTERY');
    const client = createMockClient();

    client.getLeagueEntriesByPuuid.mockResolvedValue([makeLeagueEntry('DIAMOND', 'II', 50)]);
    client.getChampionMastery.mockResolvedValue(makeMastery(412, 50000));

    await enrichParticipants('EUW1_MASTERY', participants, baseOptions(db, client));

    const masteryCalls = client.getChampionMastery.mock.calls as unknown as [
      Platform,
      string,
      number,
    ][];
    const calledPairs = masteryCalls.map(([, puuid, championId]) => `${puuid}:${championId}`);
    expect(calledPairs).toContain('puuid-ally-support:412');
    expect(calledPairs).toContain('puuid-enemy-support:89');
    expect(calledPairs).not.toContain('puuid-ally-adc:51');
    expect(calledPairs).not.toContain('puuid-ally-top:266');

    const allySupport = db
      .prepare('SELECT mastery_points FROM participants WHERE match_id = ? AND puuid = ?')
      .get('EUW1_MASTERY', 'puuid-ally-support') as { mastery_points: number | null };
    expect(allySupport.mastery_points).toBe(50000);

    db.close();
  });

  it('does not fetch mastery when champion_games >= minChampGames', async () => {
    const { db, participants } = setupDb('EUW1_NO_MASTERY');
    const client = createMockClient();

    client.getLeagueEntriesByPuuid.mockResolvedValue([makeLeagueEntry('DIAMOND', 'II', 50)]);

    await enrichParticipants('EUW1_NO_MASTERY', participants, {
      ...baseOptions(db, client),
      minChampGames: 1,
    });

    expect(client.getChampionMastery).not.toHaveBeenCalled();

    db.close();
  });

  it('stores 0 for null mastery (never played) and does not re-fetch on re-run', async () => {
    const { db, participants } = setupDb('EUW1_404');
    const client = createMockClient();

    client.getLeagueEntriesByPuuid.mockResolvedValue([makeLeagueEntry('DIAMOND', 'II', 50)]);
    client.getChampionMastery.mockResolvedValue(null);

    await enrichParticipants('EUW1_404', participants, baseOptions(db, client));

    const allySupport = db
      .prepare('SELECT mastery_points FROM participants WHERE match_id = ? AND puuid = ?')
      .get('EUW1_404', 'puuid-ally-support') as { mastery_points: number | null };
    expect(allySupport.mastery_points).toBe(0);

    await enrichParticipants('EUW1_404', participants, baseOptions(db, client));

    const callsAfterFirst = client.getChampionMastery.mock.calls.length;
    await enrichParticipants('EUW1_404', participants, baseOptions(db, client));
    expect(client.getChampionMastery.mock.calls.length).toBe(callsAfterFirst);

    db.close();
  });

  it('reuses existing mastery from other match rows without an API call', async () => {
    const { db, participants } = setupDb('EUW1_REUSE_1');
    const client = createMockClient();

    client.getLeagueEntriesByPuuid.mockResolvedValue([makeLeagueEntry('DIAMOND', 'II', 50)]);
    client.getChampionMastery.mockResolvedValue(makeMastery(412, 50000));

    await enrichParticipants('EUW1_REUSE_1', participants, baseOptions(db, client));

    expect(client.getChampionMastery).toHaveBeenCalledTimes(2);

    const stmts = prepareMatchPersist(db);
    const match2 = makeMatch('EUW1_REUSE_2');
    const ranks2 = new Map([[SEED_PUUID, SEED_RANK_SCORE]]);
    const participants2 = extractParticipants(match2, ranks2);

    const matchRow2 = {
      match_id: 'EUW1_REUSE_2',
      platform: PLATFORM,
      patch: '16.21',
      queue_id: 420,
      duration: 1800,
      created_at: 1_760_000_000_000,
      avg_rank_score: SEED_RANK_SCORE,
      rank_known_count: 1,
    };
    stmts.insertMatch.run(matchRow2);
    for (const p of participants2) {
      stmts.insertParticipant.run(p);
    }

    const client2 = createMockClient();
    client2.getLeagueEntriesByPuuid.mockResolvedValue([makeLeagueEntry('DIAMOND', 'II', 50)]);

    await enrichParticipants('EUW1_REUSE_2', participants2, baseOptions(db, client2));

    expect(client2.getChampionMastery).not.toHaveBeenCalled();

    const mastery = db
      .prepare('SELECT mastery_points FROM participants WHERE match_id = ? AND puuid = ?')
      .get('EUW1_REUSE_2', 'puuid-ally-support') as { mastery_points: number | null };
    expect(mastery.mastery_points).toBe(50000);

    db.close();
  });

  it('re-runs with zero HTTP calls (idempotence)', async () => {
    const { db, participants } = setupDb('EUW1_IDEM_ALL');
    const client = createMockClient();

    client.getLeagueEntriesByPuuid.mockResolvedValue([makeLeagueEntry('DIAMOND', 'II', 50)]);
    client.getChampionMastery.mockResolvedValue(makeMastery(412, 50000));

    await enrichParticipants('EUW1_IDEM_ALL', participants, baseOptions(db, client));

    const rankCalls = client.getLeagueEntriesByPuuid.mock.calls.length;
    const masteryCalls = client.getChampionMastery.mock.calls.length;

    await enrichParticipants('EUW1_IDEM_ALL', participants, baseOptions(db, client));

    expect(client.getLeagueEntriesByPuuid.mock.calls.length).toBe(rankCalls);
    expect(client.getChampionMastery.mock.calls.length).toBe(masteryCalls);

    db.close();
  });
});

describe('enrichParticipants — match rank stats', () => {
  it('recomputes avg_rank_score and rank_known_count including seed exactly once', async () => {
    const { db, participants } = setupDb('EUW1_RANK_STATS');
    const client = createMockClient();

    client.getLeagueEntriesByPuuid.mockImplementation(async (_platform, puuid) => {
      const ranks: Record<string, Record<string, unknown>> = {
        'puuid-ally-adc': makeLeagueEntry('DIAMOND', 'III', 40),
        'puuid-enemy-adc': makeLeagueEntry('DIAMOND', 'IV', 20),
      };
      return ranks[puuid] ? [ranks[puuid]] : [];
    });
    client.getChampionMastery.mockResolvedValue(makeMastery(412, 50000));

    await enrichParticipants('EUW1_RANK_STATS', participants, baseOptions(db, client));

    const row = db
      .prepare('SELECT avg_rank_score, rank_known_count FROM matches WHERE match_id = ?')
      .get('EUW1_RANK_STATS') as { avg_rank_score: number; rank_known_count: number };

    const expectedAvg =
      (6.75 + playerRankScore('DIAMOND', 'III') + playerRankScore('DIAMOND', 'IV')) / 3;
    expect(row.avg_rank_score).toBeCloseTo(expectedAvg, 5);
    expect(row.rank_known_count).toBe(3);

    db.close();
  });
});

describe('enrichParticipants — failure isolation', () => {
  it('catches rank fetch failures and continues enriching other participants', async () => {
    const { db, participants } = setupDb('EUW1_FAIL_RANK');
    const client = createMockClient();

    client.getLeagueEntriesByPuuid.mockImplementation(async (_platform, puuid) => {
      if (puuid === 'puuid-ally-adc') {
        throw new RiotApiError('Network error', 0, 'url');
      }
      return [makeLeagueEntry('DIAMOND', 'II', 50)];
    });
    client.getChampionMastery.mockResolvedValue(makeMastery(412, 50000));

    const summary = await enrichParticipants(
      'EUW1_FAIL_RANK',
      participants,
      baseOptions(db, client),
    );

    expect(summary.failures).toBeGreaterThanOrEqual(1);
    expect(summary.ranksFetched).toBe(2);

    db.close();
  });

  it('catches mastery fetch failures and continues enriching other participants', async () => {
    const { db, participants } = setupDb('EUW1_FAIL_MASTER');
    const client = createMockClient();

    client.getLeagueEntriesByPuuid.mockResolvedValue([makeLeagueEntry('DIAMOND', 'II', 50)]);
    client.getChampionMastery.mockImplementation(async (_platform, puuid) => {
      if (puuid === 'puuid-ally-support') {
        throw new RiotApiError('Key expired', 401, 'url');
      }
      return makeMastery(89, 30000);
    });

    const summary = await enrichParticipants(
      'EUW1_FAIL_MASTER',
      participants,
      baseOptions(db, client),
    );

    expect(summary.failures).toBeGreaterThanOrEqual(1);
    expect(summary.masteryFetched).toBe(1);

    const allySupport = db
      .prepare('SELECT mastery_points FROM participants WHERE match_id = ? AND puuid = ?')
      .get('EUW1_FAIL_MASTER', 'puuid-ally-support') as { mastery_points: number | null };
    expect(allySupport.mastery_points).toBeNull();

    const championGames = db
      .prepare('SELECT champion_games FROM participants WHERE match_id = ? AND puuid = ?')
      .get('EUW1_FAIL_MASTER', 'puuid-ally-support') as { champion_games: number };
    expect(championGames.champion_games).toBe(1);

    db.close();
  });
});
