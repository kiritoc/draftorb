import { describe, expect, it, vi } from 'vitest';
import { z } from '@draftorb/shared';
import { RiotClient } from './riot/client';
import { RiotApiError, RiotAuthError, RiotRateLimitError, RiotSchemaError } from './riot/types';

function createMockResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const responseHeaders = new Headers({
    'Content-Type': 'application/json',
    ...headers,
  });
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: responseHeaders,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  } as unknown as Response;
}

describe('RiotClient', () => {
  const dummyApiKey = 'RGAPI-test-api-key-12345';

  it('uses AbortSignal.timeout and retries network timeouts like 5xx errors', async () => {
    const mockFetch = vi.fn().mockImplementation(async (_url, options) => {
      expect(options.signal).toBeTruthy();
      if (mockFetch.mock.calls.length === 1) {
        throw new Error('timeout');
      }
      return createMockResponse(200, { success: true });
    });

    const client = new RiotClient({
      apiKey: dummyApiKey,
      fetchFn: mockFetch as typeof fetch,
      timeoutMs: 250,
      initialBackoffMs: 10,
      sleepFn: async () => {},
    });

    await expect(client.request('https://euw1.api.riotgames.com/test')).resolves.toEqual({ success: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws RiotSchemaError with a truncated summary when schema validation fails', async () => {
    const mockFetch = vi.fn().mockResolvedValue(createMockResponse(200, { id: 412 }));
    const client = new RiotClient({ apiKey: dummyApiKey, fetchFn: mockFetch as typeof fetch });
    const schema = z.object({ id: z.number(), name: z.string() });

    await expect(client.request('https://euw1.api.riotgames.com/test', schema)).rejects.toThrow(
      RiotSchemaError,
    );
    await expect(client.request('https://euw1.api.riotgames.com/test', schema)).rejects.toThrow(
      /name/,
    );
  });

  it('retries invalid JSON responses like 5xx then throws RiotApiError', async () => {
    const mockFetch = vi.fn().mockResolvedValue(createMockResponse(200, 'not-json'));
    const client = new RiotClient({
      apiKey: dummyApiKey,
      fetchFn: mockFetch as typeof fetch,
      max5xxRetries: 2,
      initialBackoffMs: 1,
      sleepFn: async () => {},
    });

    await expect(client.request('https://euw1.api.riotgames.com/test')).rejects.toThrow(RiotApiError);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('redacts puuids in URLs and messages', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      createMockResponse(404, 'not found', { 'X-Riot-Token': dummyApiKey }),
    );
    const client = new RiotClient({ apiKey: dummyApiKey, fetchFn: mockFetch as typeof fetch });

    await expect(
      client.request(
        'https://euw1.api.riotgames.com/lol/match/v5/matches/by-puuid/0123456789abcdef0123456789abcdef?queue=420',
      ),
    ).rejects.toThrow(/01234567/);
    await expect(
      client.request(
        'https://euw1.api.riotgames.com/lol/match/v5/matches/by-puuid/0123456789abcdef0123456789abcdef?queue=420',
      ),
    ).rejects.toThrow(/01234567…/);
  });
});
