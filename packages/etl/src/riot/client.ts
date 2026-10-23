/**
 * Riot Games API HTTP Client.
 *
 * Implements rate limiting, 429 retry-after waiting, 5xx exponential backoff,
 * immediate abort on 401/403 with "key expired?", and resilient Zod validation.
 */

import { z } from '@draftorb/shared';
import { loadEnv } from './env';
import { RiotRateLimiter } from './rate-limiter';
import {
  RiotLeagueEntries,
  RiotLeagueList,
  RiotMatchDto,
  riotLeagueEntriesSchema,
  riotLeagueListSchema,
  riotMatchDtoSchema,
  riotMatchIdsSchema,
} from './schemas';
import {
  Platform,
  RegionalRouting,
  RiotApiError,
  RiotAuthError,
  RiotRateLimitError,
  platformToRegion,
} from './types';

export interface MatchIdsOptions {
  startTime?: number;
  endTime?: number;
  queue?: number;
  type?: string;
  start?: number;
  count?: number;
}

export interface RiotClientOptions {
  apiKey?: string;
  autoLoadEnv?: boolean;
  rateLimiter?: RiotRateLimiter;
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
  nowFn?: () => number;
  max5xxRetries?: number;
  initialBackoffMs?: number;
  max429Retries?: number;
  logWarnings?: boolean;
}

export class RiotClient {
  private readonly apiKey: string;
  private readonly rateLimiter: RiotRateLimiter;
  private readonly fetchFn: typeof fetch;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly max5xxRetries: number;
  private readonly initialBackoffMs: number;
  private readonly max429Retries: number;
  private readonly logWarnings: boolean;

  constructor(options: RiotClientOptions = {}) {
    if (options.autoLoadEnv !== false && !process.env.RIOT_API_KEY && !options.apiKey) {
      loadEnv();
    }

    const key = options.apiKey ?? process.env.RIOT_API_KEY;
    if (!key) {
      throw new Error(
        'Riot API key is missing. Set RIOT_API_KEY in .env or pass apiKey to RiotClient options.',
      );
    }

    this.apiKey = key;
    this.sleepFn =
      options.sleepFn ?? options.rateLimiter?.sleep ?? ((ms) => new Promise((res) => setTimeout(res, ms)));
    this.rateLimiter =
      options.rateLimiter ??
      new RiotRateLimiter({
        sleep: this.sleepFn,
        now: options.nowFn,
      });
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.max5xxRetries = options.max5xxRetries ?? 5;
    this.initialBackoffMs = options.initialBackoffMs ?? 500;
    this.max429Retries = options.max429Retries ?? 5;
    this.logWarnings = options.logWarnings ?? true;
  }

  getRateLimiter(): RiotRateLimiter {
    return this.rateLimiter;
  }

  /**
   * Executes an HTTP request against the Riot API with rate limiting, retries, and schema validation.
   */
  async request<T>(
    url: string,
    schema?: z.ZodType<T>,
    methodKey?: string,
  ): Promise<T> {
    let retries5xx = 0;
    let retries429 = 0;

    while (true) {
      let response: Response;
      try {
        response = await this.rateLimiter.execute(
          () =>
            this.fetchFn(url, {
              headers: { 'X-Riot-Token': this.apiKey, Accept: 'application/json' },
            }),
          methodKey,
        );
      } catch (error) {
        // Network failure (ECONNRESET, DNS, timeout): same backoff policy as 5xx
        retries5xx++;
        if (retries5xx >= this.max5xxRetries) {
          throw new RiotApiError(`Network error at ${url}: ${(error as Error).message}`, 0, url);
        }
        await this.sleepFn(this.initialBackoffMs * Math.pow(2, retries5xx - 1));
        continue;
      }

      // Update rate limiter limits from response headers
      const headerInfo = this.rateLimiter.updateFromHeaders(response.headers, methodKey);

      // 1. Success (200-299)
      if (response.ok) {
        const rawJson: unknown = await response.json();
        if (!schema) {
          return rawJson as T;
        }

        const parsed = schema.safeParse(rawJson);
        if (!parsed.success) {
          if (this.logWarnings) {
            console.warn(
              `[RiotClient] Response shape at ${url} did not match schema: ${parsed.error.message}`,
            );
          }
          // Log unknown shape instead of crashing, return raw payload
          return rawJson as T;
        }

        return parsed.data;
      }

      // 2. Authentication failure (401 or 403): stop immediately with explicit message
      if (response.status === 401 || response.status === 403) {
        const bodyText = await response.text().catch(() => '');
        throw new RiotAuthError(
          `Riot API authentication failed (${response.status}): key expired? Check RIOT_API_KEY in .env`,
          response.status,
          url,
          bodyText,
        );
      }

      // 3. Rate limited (429)
      if (response.status === 429) {
        retries429++;
        if (retries429 > this.max429Retries) {
          throw new RiotRateLimitError(
            `Riot API rate limit exceeded (429) at ${url}. Maximum retries (${this.max429Retries}) exceeded.`,
            response.status,
            url,
            headerInfo.retryAfterSeconds,
          );
        }

        const waitSeconds = headerInfo.retryAfterSeconds ?? 1;
        const waitMs = Math.max(waitSeconds * 1000, 500) * (headerInfo.retryAfterSeconds ? 1 : retries429); // no Retry-After: linear backoff
        await this.sleepFn(waitMs);
        continue;
      }

      // 4. Server errors (5xx): exponential backoff (max 5 tries)
      if (response.status >= 500 && response.status < 600) {
        retries5xx++;
        if (retries5xx >= this.max5xxRetries) {
          const bodyText = await response.text().catch(() => '');
          throw new RiotApiError(
            `Riot API server error (${response.status}) at ${url}. Max retries (${this.max5xxRetries}) exhausted.`,
            response.status,
            url,
            bodyText,
          );
        }

        const backoffMs = this.initialBackoffMs * Math.pow(2, retries5xx - 1);
        await this.sleepFn(backoffMs);
        continue;
      }

      // 5. Client errors (400, 404, etc.): do not retry
      const errorBody = await response.text().catch(() => '');
      throw new RiotApiError(
        `Riot API request failed with status ${response.status} at ${url}: ${errorBody}`,
        response.status,
        url,
        errorBody,
      );
    }
  }

  // --- League-v4 Endpoints ---

  async getLeagueEntries(
    platform: Platform,
    queue: string,
    tier: string,
    division: string,
    page = 1,
  ): Promise<RiotLeagueEntries> {
    const url = `https://${platform}.api.riotgames.com/lol/league/v4/entries/${queue}/${tier}/${division}?page=${page}`;
    return this.request(url, riotLeagueEntriesSchema, 'league-v4.entries');
  }

  async getChallengerLeague(
    platform: Platform,
    queue = 'RANKED_SOLO_5x5',
  ): Promise<RiotLeagueList> {
    const url = `https://${platform}.api.riotgames.com/lol/league/v4/challengerleagues/by-queue/${queue}`;
    return this.request(url, riotLeagueListSchema, 'league-v4.challenger');
  }

  async getGrandmasterLeague(
    platform: Platform,
    queue = 'RANKED_SOLO_5x5',
  ): Promise<RiotLeagueList> {
    const url = `https://${platform}.api.riotgames.com/lol/league/v4/grandmasterleagues/by-queue/${queue}`;
    return this.request(url, riotLeagueListSchema, 'league-v4.grandmaster');
  }

  async getMasterLeague(
    platform: Platform,
    queue = 'RANKED_SOLO_5x5',
  ): Promise<RiotLeagueList> {
    const url = `https://${platform}.api.riotgames.com/lol/league/v4/masterleagues/by-queue/${queue}`;
    return this.request(url, riotLeagueListSchema, 'league-v4.master');
  }

  // --- Match-v5 Endpoints ---

  async getMatchIdsByPuuid(
    regionOrPlatform: RegionalRouting | Platform,
    puuid: string,
    options: MatchIdsOptions = {},
  ): Promise<string[]> {
    const region = this.resolveRegion(regionOrPlatform);
    const query = new URLSearchParams();

    if (options.startTime !== undefined) query.set('startTime', String(options.startTime));
    if (options.endTime !== undefined) query.set('endTime', String(options.endTime));
    if (options.queue !== undefined) query.set('queue', String(options.queue));
    if (options.type !== undefined) query.set('type', options.type);
    if (options.start !== undefined) query.set('start', String(options.start));
    if (options.count !== undefined) query.set('count', String(options.count));

    const qs = query.toString();
    const url = `https://${region}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids${qs ? `?${qs}` : ''}`;
    return this.request(url, riotMatchIdsSchema, 'match-v5.matchIds');
  }

  async getMatch(
    regionOrPlatform: RegionalRouting | Platform,
    matchId: string,
  ): Promise<RiotMatchDto> {
    const region = this.resolveRegion(regionOrPlatform);
    const url = `https://${region}.api.riotgames.com/lol/match/v5/matches/${matchId}`;
    return this.request(url, riotMatchDtoSchema, 'match-v5.match');
  }

  async getMatchTimeline(
    regionOrPlatform: RegionalRouting | Platform,
    matchId: string,
  ): Promise<unknown> {
    const region = this.resolveRegion(regionOrPlatform);
    const url = `https://${region}.api.riotgames.com/lol/match/v5/matches/${matchId}/timeline`;
    return this.request(url, undefined, 'match-v5.timeline');
  }

  private resolveRegion(regionOrPlatform: RegionalRouting | Platform): RegionalRouting {
    const regionalList: readonly string[] = ['europe', 'americas', 'asia', 'sea'];
    if (regionalList.includes(regionOrPlatform)) {
      return regionOrPlatform as RegionalRouting;
    }
    return platformToRegion(regionOrPlatform as Platform);
  }
}
