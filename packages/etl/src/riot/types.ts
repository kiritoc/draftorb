/**
 * Types and error classes for the Riot Games API client and rate limiter.
 */

export const PLATFORMS = [
  'euw1',
  'eun1',
  'na1',
  'la1',
  'la2',
  'kr',
  'jp1',
  'br1',
  'oc1',
  'ru',
  'tr1',
  'ph2',
  'sg2',
  'th2',
  'tw2',
  'vn2',
] as const;
export type Platform = (typeof PLATFORMS)[number];

export const REGIONAL_ROUTINGS = ['europe', 'americas', 'asia', 'sea'] as const;
export type RegionalRouting = (typeof REGIONAL_ROUTINGS)[number];

/**
 * Maps a platform routing value (e.g. 'euw1') to its corresponding regional routing ('europe').
 */
export function platformToRegion(platform: Platform): RegionalRouting {
  switch (platform) {
    case 'euw1':
    case 'eun1':
    case 'tr1':
    case 'ru':
      return 'europe';

    case 'na1':
    case 'br1':
    case 'la1':
    case 'la2':
      return 'americas';

    case 'kr':
    case 'jp1':
      return 'asia';

    case 'oc1':
    case 'ph2':
    case 'sg2':
    case 'th2':
    case 'tw2':
    case 'vn2':
      return 'sea';
  }
}

/**
 * Rate limit window specification.
 */
export interface RateLimitWindow {
  maxRequests: number;
  windowSeconds: number;
}

/**
 * Parsed rate limit state from Riot response headers.
 */
export interface RateLimitHeaderInfo {
  appLimits: RateLimitWindow[];
  appCounts: RateLimitWindow[];
  methodLimits?: RateLimitWindow[];
  methodCounts?: RateLimitWindow[];
  retryAfterSeconds?: number;
}

/**
 * Base class for all Riot API errors.
 */
export class RiotApiError extends Error {
  readonly status: number;
  readonly url: string;
  readonly responseBody?: unknown;

  constructor(message: string, status: number, url: string, responseBody?: unknown) {
    super(message);
    this.name = 'RiotApiError';
    this.status = status;
    this.url = url;
    this.responseBody = responseBody;
  }
}

/**
 * Thrown when Riot API authentication fails (HTTP 401 or 403).
 * Represents an invalid, missing, or expired API key.
 */
export class RiotAuthError extends RiotApiError {
  constructor(message: string, status: number, url: string, responseBody?: unknown) {
    super(message, status, url, responseBody);
    this.name = 'RiotAuthError';
  }
}

/**
 * Thrown when rate limits are exhausted and maximum retries exceeded.
 */
export class RiotRateLimitError extends RiotApiError {
  readonly retryAfterSeconds?: number;

  constructor(
    message: string,
    status: number,
    url: string,
    retryAfterSeconds?: number,
    responseBody?: unknown,
  ) {
    super(message, status, url, responseBody);
    this.name = 'RiotRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
