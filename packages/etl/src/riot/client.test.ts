import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { z } from '@draftorb/shared';
import { RiotClient } from './client';
import { RiotRateLimiter } from './rate-limiter';
import { RiotApiError, RiotAuthError, RiotRateLimitError, RiotSchemaError } from './types';

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

describe('RiotClient', () => {
  const dummyApiKey = 'RGAPI-test-api-key-12345';

  it('throws an error if no API key is provided and none in environment', () => {
    const originalEnv = process.env.RIOT_API_KEY;
    delete process.env.RIOT_API_KEY;

    try {
      expect(() => new RiotClient({ autoLoadEnv: false })).toThrow(/Riot API key is missing/);
    } finally {
      if (originalEnv) {
        process.env.RIOT_API_KEY = originalEnv;
      }
    }
  });

  describe('HTTP error handling & acceptance criteria', () => {
    it('retries a rejected fetch with backoff and succeeds', async () => {
      const fetchCalls: number[] = [];
      const sleepDurations: number[] = [];
      const mockFetch = vi.fn().mockImplementation(async () => {
        fetchCalls.push(1);
        if (fetchCalls.length === 1) {
          throw new Error('Network unavailable');
        }
        return createMockResponse(200, { success: true });
      });

      const client = new RiotClient({
        apiKey: dummyApiKey,
        fetchFn: mockFetch,
        initialBackoffMs: 200,
        sleepFn: async (ms) => {
          sleepDurations.push(ms);
        },
      });

      await expect(client.request('https://euw1.api.riotgames.com/test')).resolves.toEqual({
        success: true,
      });
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(sleepDurations).toEqual([200]);
    });

    it('throws RiotApiError when rejected fetches exhaust the maximum tries', async () => {
      const sleepDurations: number[] = [];
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network unavailable'));
      const client = new RiotClient({
        apiKey: dummyApiKey,
        fetchFn: mockFetch,
        initialBackoffMs: 100,
        max5xxRetries: 3,
        sleepFn: async (ms) => {
          sleepDurations.push(ms);
        },
      });

      await expect(client.request('https://euw1.api.riotgames.com/test')).rejects.toThrow(
        RiotApiError,
      );
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(sleepDurations).toEqual([100, 200]);
    });

    it('stops immediately on 401 Unauthorized with "key expired?" and does not retry', async () => {
      let fetchCalls = 0;
      const mockFetch = vi.fn().mockImplementation(async () => {
        fetchCalls++;
        return createMockResponse(401, { status: { message: 'Unauthorized', status_code: 401 } });
      });

      const client = new RiotClient({
        apiKey: dummyApiKey,
        fetchFn: mockFetch,
      });

      await expect(client.request('https://euw1.api.riotgames.com/test')).rejects.toThrow(
        /key expired\?/,
      );
      await expect(client.request('https://euw1.api.riotgames.com/test')).rejects.toThrowError(
        RiotAuthError,
      );
      expect(fetchCalls).toBe(2); // 2 independent requests (no retries on 401)
    });

    it('stops immediately on 403 Forbidden with "key expired?" and does not retry', async () => {
      let fetchCalls = 0;
      const mockFetch = vi.fn().mockImplementation(async () => {
        fetchCalls++;
        return createMockResponse(403, `Forbidden: ${dummyApiKey}`);
      });

      const client = new RiotClient({
        apiKey: dummyApiKey,
        fetchFn: mockFetch,
      });

      const error = await client
        .request('https://euw1.api.riotgames.com/test')
        .catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(RiotAuthError);
      if (!(error instanceof RiotAuthError)) throw new Error('Expected RiotAuthError');
      expect(error.message).toMatch(/key expired\?/);
      expect(error.responseBody).not.toContain(dummyApiKey);
      expect(JSON.stringify(error)).not.toContain(dummyApiKey);
      expect(fetchCalls).toBe(1);
    });

    it('redacts Riot API keys echoed in other error bodies', async () => {
      const client = new RiotClient({
        apiKey: dummyApiKey,
        fetchFn: vi.fn(async () => createMockResponse(400, `Invalid request: ${dummyApiKey}`)),
      });

      const error = await client
        .request('https://euw1.api.riotgames.com/test')
        .catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(RiotApiError);
      if (!(error instanceof RiotApiError)) throw new Error('Expected RiotApiError');
      expect(error.message).not.toContain(dummyApiKey);
      expect(error.responseBody).not.toContain(dummyApiKey);
      expect(JSON.stringify(error)).not.toContain(dummyApiKey);
    });

    it('redacts UUID-shaped Riot API keys completely (B-010 regression)', async () => {
      const uuidKey = 'RGAPI-1a2b3c4d-1234-5678-9abc-def012345678';
      const client = new RiotClient({
        apiKey: uuidKey,
        fetchFn: vi.fn(async () => createMockResponse(400, `Invalid request: ${uuidKey}`)),
      });

      const error = await client
        .request('https://euw1.api.riotgames.com/test')
        .catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(RiotApiError);
      if (!(error instanceof RiotApiError)) throw new Error('Expected RiotApiError');
      expect(error.message).toContain('[REDACTED]');
      expect(error.responseBody).toContain('[REDACTED]');
      // No fragments of the key should leak
      expect(error.message).not.toContain('1a2b3c4d');
      expect(error.message).not.toContain('9abc');
      expect(error.message).not.toContain('def012345678');
      expect(error.responseBody).not.toContain('1a2b3c4d');
      expect(error.responseBody).not.toContain('9abc');
      expect(error.responseBody).not.toContain('def012345678');
      expect(error.url).not.toContain('1a2b3c4d');
      expect(JSON.stringify(error)).not.toContain('1a2b3c4d');
      expect(JSON.stringify(error)).not.toContain('9abc');
      expect(JSON.stringify(error)).not.toContain('def012345678');
    });

    it('redacts UUID-shaped keys in 403 auth errors (B-010 regression)', async () => {
      const uuidKey = 'RGAPI-1a2b3c4d-1234-5678-9abc-def012345678';
      const client = new RiotClient({
        apiKey: uuidKey,
        fetchFn: vi.fn(async () => createMockResponse(403, `Forbidden: ${uuidKey}`)),
      });

      const error = await client
        .request('https://euw1.api.riotgames.com/test')
        .catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(RiotAuthError);
      if (!(error instanceof RiotAuthError)) throw new Error('Expected RiotAuthError');
      expect(error.message).toContain('[REDACTED]');
      expect(error.responseBody).toContain('[REDACTED]');
      // No fragments of the key should leak
      expect(error.message).not.toContain('1a2b3c4d');
      expect(error.message).not.toContain('9abc');
      expect(error.message).not.toContain('def012345678');
      expect(error.responseBody).not.toContain('1a2b3c4d');
      expect(error.responseBody).not.toContain('9abc');
      expect(error.responseBody).not.toContain('def012345678');
      expect(JSON.stringify(error)).not.toContain('1a2b3c4d');
      expect(JSON.stringify(error)).not.toContain('9abc');
      expect(JSON.stringify(error)).not.toContain('def012345678');
    });

    it('redacts UUID-shaped keys in nested JSON error bodies (B-010 regression)', () => {
      const uuidKey = 'RGAPI-1a2b3c4d-1234-5678-9abc-def012345678';
      const error = new RiotApiError(
        `Riot API request failed with status 400 at https://euw1.api.riotgames.com/test: ${JSON.stringify(
          {
            message: uuidKey,
            nested: [uuidKey],
          },
        )}`,
        400,
        'https://euw1.api.riotgames.com/test',
        { message: uuidKey, nested: [uuidKey] },
      );
      expect(error).toBeInstanceOf(RiotApiError);
      expect(error.responseBody).not.toBeUndefined();
      expect(JSON.stringify(error.responseBody)).toContain('[REDACTED]');
      // No fragments of the key should leak in the redacted body
      const bodyStr = JSON.stringify(error.responseBody);
      expect(bodyStr).not.toContain('1a2b3c4d');
      expect(bodyStr).not.toContain('9abc');
      expect(bodyStr).not.toContain('def012345678');
    });

    it('shortens 78-character PUUIDs in error bodies (B-010 regression)', async () => {
      // Real Riot PUUIDs are 78-character base64url strings
      const realPuuid =
        'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-ABCD';
      const client = new RiotClient({
        apiKey: dummyApiKey,
        fetchFn: vi.fn(async () => createMockResponse(400, `Player not found: ${realPuuid}`)),
      });

      const error = await client
        .request('https://euw1.api.riotgames.com/test')
        .catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(RiotApiError);
      if (!(error instanceof RiotApiError)) throw new Error('Expected RiotApiError');
      // PUUID should be shortened to first 8 chars + ellipsis
      expect(error.message).toContain('AbCdEfGh…');
      expect(error.message).not.toContain(realPuuid.slice(8));
    });

    it('waits Retry-After and retries on 429 Rate Limit response', async () => {
      let fetchCalls = 0;
      let currentTime = 1000;
      const sleepDurations: number[] = [];

      const mockFetch = vi.fn().mockImplementation(async () => {
        fetchCalls++;
        if (fetchCalls === 1) {
          return createMockResponse(429, 'Rate limited', {
            'Retry-After': '2',
            'X-Rate-Limit-Type': 'application',
          });
        }
        return createMockResponse(200, { success: true });
      });

      const client = new RiotClient({
        apiKey: dummyApiKey,
        fetchFn: mockFetch,
        nowFn: () => currentTime,
        sleepFn: async (ms) => {
          sleepDurations.push(ms);
          currentTime += ms;
        },
      });

      const result = await client.request(
        'https://euw1.api.riotgames.com/test',
        z.object({ success: z.boolean() }),
      );

      expect(result).toEqual({ success: true });
      expect(fetchCalls).toBe(2);
      expect(sleepDurations).toEqual([2000]); // 2 seconds from Retry-After
    });

    it('throws RiotRateLimitError if 429 retries exceed maximum limit', async () => {
      let fetchCalls = 0;
      let currentTime = 1000;
      const mockFetch = vi.fn().mockImplementation(async () => {
        fetchCalls++;
        return createMockResponse(429, 'Rate limited', { 'Retry-After': '1' });
      });

      const client = new RiotClient({
        apiKey: dummyApiKey,
        fetchFn: mockFetch,
        max429Retries: 3,
        nowFn: () => currentTime,
        sleepFn: async (ms) => {
          currentTime += ms;
        },
      });

      await expect(client.request('https://euw1.api.riotgames.com/test')).rejects.toThrowError(
        RiotRateLimitError,
      );
      // 1 initial call + 3 retries = 4 attempts total
      expect(fetchCalls).toBe(4);
    });

    it('applies exponential backoff on 5xx server errors up to 5 tries', async () => {
      let fetchCalls = 0;
      const sleepDurations: number[] = [];

      const mockFetch = vi.fn().mockImplementation(async () => {
        fetchCalls++;
        if (fetchCalls < 3) {
          return createMockResponse(503, 'Service Unavailable');
        }
        return createMockResponse(200, { data: 'recovered' });
      });

      const client = new RiotClient({
        apiKey: dummyApiKey,
        fetchFn: mockFetch,
        initialBackoffMs: 200,
        sleepFn: async (ms) => {
          sleepDurations.push(ms);
        },
      });

      const result = await client.request(
        'https://euw1.api.riotgames.com/test',
        z.object({ data: z.string() }),
      );

      expect(result).toEqual({ data: 'recovered' });
      expect(fetchCalls).toBe(3);
      // 1st retry: 200 * 2^0 = 200ms
      // 2nd retry: 200 * 2^1 = 400ms
      expect(sleepDurations).toEqual([200, 400]);
    });

    it('throws error when 5xx retries are exhausted after 5 tries', async () => {
      let fetchCalls = 0;
      const sleepDurations: number[] = [];

      const mockFetch = vi.fn().mockImplementation(async () => {
        fetchCalls++;
        return createMockResponse(500, 'Internal Server Error');
      });

      const client = new RiotClient({
        apiKey: dummyApiKey,
        fetchFn: mockFetch,
        initialBackoffMs: 100,
        max5xxRetries: 5,
        sleepFn: async (ms) => {
          sleepDurations.push(ms);
        },
      });

      await expect(client.request('https://euw1.api.riotgames.com/test')).rejects.toThrow(
        /Max retries \(5\) exhausted/,
      );
      expect(fetchCalls).toBe(5);
      // Backoffs for 4 retries: 100ms, 200ms, 400ms, 800ms
      expect(sleepDurations).toEqual([100, 200, 400, 800]);
    });

    it('does not retry 404 client errors', async () => {
      let fetchCalls = 0;
      const mockFetch = vi.fn().mockImplementation(async () => {
        fetchCalls++;
        return createMockResponse(404, 'Data not found');
      });

      const client = new RiotClient({
        apiKey: dummyApiKey,
        fetchFn: mockFetch,
      });

      await expect(client.request('https://euw1.api.riotgames.com/test')).rejects.toThrow(
        /status 404/,
      );
      expect(fetchCalls).toBe(1);
    });

    it('retries a fetch that only settles when its AbortSignal fires, then throws RiotApiError with status 0', async () => {
      const sleepDurations: number[] = [];
      const mockFetch = vi.fn().mockImplementation((_url, options) => {
        // A fetch that never settles on its own: it only rejects once the
        // AbortSignal (created via AbortSignal.timeout in the client) fires.
        return new Promise<Response>((_, reject) => {
          const signal = options?.signal;
          if (!signal) {
            return;
          }
          if (signal.aborted) {
            reject(new Error('The operation was aborted'));
            return;
          }
          signal.addEventListener('abort', () => reject(new Error('The operation was aborted')), {
            once: true,
          });
        });
      });

      const client = new RiotClient({
        apiKey: dummyApiKey,
        fetchFn: mockFetch,
        timeoutMs: 1,
        max5xxRetries: 2,
        initialBackoffMs: 100,
        sleepFn: async (ms: number) => {
          sleepDurations.push(ms);
        },
      });

      const error = await client
        .request('https://euw1.api.riotgames.com/test')
        .catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(RiotApiError);
      if (!(error instanceof RiotApiError)) throw new Error('Expected RiotApiError');
      expect(error.status).toBe(0);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(sleepDurations).toEqual([100]);
    });

    it('retries a 200 response with a non-JSON body with backoff, then throws RiotApiError once retries are exhausted', async () => {
      const sleepDurations: number[] = [];
      const mockFetch = vi.fn().mockResolvedValue(createMockResponse(200, 'not json'));

      const client = new RiotClient({
        apiKey: dummyApiKey,
        fetchFn: mockFetch,
        max5xxRetries: 2,
        initialBackoffMs: 100,
        sleepFn: async (ms: number) => {
          sleepDurations.push(ms);
        },
      });

      const error = await client
        .request('https://euw1.api.riotgames.com/test')
        .catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(RiotApiError);
      if (!(error instanceof RiotApiError)) throw new Error('Expected RiotApiError');
      expect(error.status).toBe(200);
      expect(error.responseBody).toBe('not json');
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(sleepDurations).toEqual([100]);
    });

    it('resolves when a non-JSON 200 body is followed by a valid JSON body', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(createMockResponse(200, 'not json'))
        .mockResolvedValueOnce(createMockResponse(200, { success: true }));

      const client = new RiotClient({
        apiKey: dummyApiKey,
        fetchFn: mockFetch,
        max5xxRetries: 5,
        initialBackoffMs: 10,
        sleepFn: async () => {},
      });

      const result = await client.request('https://euw1.api.riotgames.com/test');

      expect(result).toEqual({ success: true });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('Zod validation and rate limiting integration', () => {
    it('validates response against schema successfully and sends X-Riot-Token header', async () => {
      const mockFetch = vi.fn().mockImplementation(async (_url, options) => {
        expect(options.headers['X-Riot-Token']).toBe(dummyApiKey);
        return createMockResponse(
          200,
          { id: 412, name: 'Thresh' },
          {
            'X-App-Rate-Limit': '20:1,100:120',
            'X-App-Rate-Limit-Count': '1:1,1:120',
          },
        );
      });

      const client = new RiotClient({
        apiKey: dummyApiKey,
        fetchFn: mockFetch,
      });

      const schema = z.object({ id: z.number(), name: z.string() });
      const data = await client.request('https://euw1.api.riotgames.com/champ', schema);

      expect(data).toEqual({ id: 412, name: 'Thresh' });
    });

    it('throws RiotSchemaError when schema validation fails', async () => {
      const mockFetch = vi.fn().mockImplementation(async () => {
        // Unexpected shape missing required 'name'
        return createMockResponse(200, { id: 412, unexpectedField: true });
      });

      const client = new RiotClient({
        apiKey: dummyApiKey,
        fetchFn: mockFetch,
        logWarnings: true,
      });

      const schema = z.object({ id: z.number(), name: z.string() });
      await expect(
        client.request('https://euw1.api.riotgames.com/champ', schema),
      ).rejects.toBeInstanceOf(RiotSchemaError);
    });

    it('passes methodKey and enforces rate limiting across multiple requests', async () => {
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

      const mockFetch = vi.fn().mockImplementation(async () => {
        return createMockResponse(200, { ok: true });
      });

      const client = new RiotClient({
        apiKey: dummyApiKey,
        fetchFn: mockFetch,
        rateLimiter,
      });

      await client.request('https://euw1.api.riotgames.com/1');
      await client.request('https://euw1.api.riotgames.com/2');
      await client.request('https://euw1.api.riotgames.com/3');

      expect(sleptTotal).toBe(1000);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('Typed endpoint methods and regional routing', () => {
    it('correctly maps platform euw1 to europe for match endpoints', async () => {
      let requestedUrl = '';
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        requestedUrl = url;
        return createMockResponse(200, ['EUW1_123']);
      });

      const client = new RiotClient({
        apiKey: dummyApiKey,
        fetchFn: mockFetch,
      });

      const ids = await client.getMatchIdsByPuuid('euw1', 'test-puuid', {
        queue: 420,
        count: 10,
      });

      expect(requestedUrl).toBe(
        'https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/test-puuid/ids?queue=420&count=10',
      );
      expect(ids).toEqual(['EUW1_123']);
    });

    it('fetches league entries and validates against real fixture', async () => {
      const fixturePath = resolve(__dirname, '../../test/fixtures/league-entries.json');
      const fixtureData = JSON.parse(readFileSync(fixturePath, 'utf-8'));

      const mockFetch = vi.fn().mockImplementation(async () => {
        return createMockResponse(200, fixtureData);
      });

      const client = new RiotClient({
        apiKey: dummyApiKey,
        fetchFn: mockFetch,
      });

      const entries = await client.getLeagueEntries('euw1', 'RANKED_SOLO_5x5', 'DIAMOND', 'I', 1);

      expect(entries).toHaveLength(2);
      expect(entries[0]?.tier).toBe('DIAMOND');
      expect(entries[0]?.rank).toBe('I');
      expect(entries[0]?.puuid).toBe('test-puuid-1');
    });

    it('fetches match detail and validates against real fixture', async () => {
      const fixturePath = resolve(__dirname, '../../test/fixtures/match.json');
      const fixtureData = JSON.parse(readFileSync(fixturePath, 'utf-8'));

      const mockFetch = vi.fn().mockImplementation(async () => {
        return createMockResponse(200, fixtureData);
      });

      const client = new RiotClient({
        apiKey: dummyApiKey,
        fetchFn: mockFetch,
      });

      const match = await client.getMatch('europe', 'EUW1_7100000001');

      expect(match.metadata.matchId).toBe('EUW1_7100000001');
      expect(match.info.queueId).toBe(420);
      expect(match.info.participants[0]?.championName).toBe('Thresh');
      expect(match.info.participants[0]?.teamPosition).toBe('UTILITY');
    });

    it('fetches challenger league and validates against real fixture', async () => {
      const fixturePath = resolve(__dirname, '../../test/fixtures/league-challenger.json');
      const fixtureData = JSON.parse(readFileSync(fixturePath, 'utf-8'));

      const mockFetch = vi.fn().mockImplementation(async () => {
        return createMockResponse(200, fixtureData);
      });

      const client = new RiotClient({
        apiKey: dummyApiKey,
        fetchFn: mockFetch,
      });

      const challenger = await client.getChallengerLeague('euw1');

      expect(challenger.tier).toBe('CHALLENGER');
      expect(challenger.name).toBe("Braum's Vanguard");
      expect(challenger.entries).toHaveLength(1);
      expect(challenger.entries[0]?.puuid).toBe('challenger-puuid-1');
    });

    it('fetches match IDs and validates against real fixture', async () => {
      const fixturePath = resolve(__dirname, '../../test/fixtures/match-ids.json');
      const fixtureData = JSON.parse(readFileSync(fixturePath, 'utf-8'));

      const mockFetch = vi.fn().mockImplementation(async () => {
        return createMockResponse(200, fixtureData);
      });

      const client = new RiotClient({
        apiKey: dummyApiKey,
        fetchFn: mockFetch,
      });

      const matchIds = await client.getMatchIdsByPuuid('euw1', 'test-puuid');

      expect(matchIds).toHaveLength(3);
      expect(matchIds[0]).toBe('EUW1_7100000001');
      expect(matchIds[1]).toBe('EUW1_7100000002');
      expect(matchIds[2]).toBe('EUW1_7100000003');
    });
  });
});
