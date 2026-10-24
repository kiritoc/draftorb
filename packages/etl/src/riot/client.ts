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

export function redactPuuid(value: string): string {
  return value.replace(/([0-9a-fA-F]{8,})(?=[^0-9a-fA-F]|$)/g, (match) => `${match.slice(0, 8)}…`);
}

function redactNestedStrings(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactPuuid(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactNestedStrings(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, redactNestedStrings(item)]),
    );
  }
  return value;
}

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

export interface RateLimitWindow {
  maxRequests: number;
  windowSeconds: number;
}

export interface RateLimitHeaderInfo {
  appLimits: RateLimitWindow[];
  appCounts: RateLimitWindow[];
  methodLimits?: RateLimitWindow[];
  methodCounts?: RateLimitWindow[];
  retryAfterSeconds?: number;
}

export class RiotApiError extends Error {
  readonly status: number;
  readonly url: string;
  readonly responseBody?: unknown;

  constructor(message: string, status: number, url: string, responseBody?: unknown) {
    super(redactPuuid(message));
    this.name = 'RiotApiError';
    this.status = status;
    this.url = redactPuuid(url);
    this.responseBody = redactNestedStrings(responseBody);
  }
}

export class RiotSchemaError extends RiotApiError {
  readonly issues: string;

  constructor(url: string, issues: string) {
    const summary = issues.length > 500 ? `${issues.slice(0, 500)}…` : issues;
    super(`Riot API schema validation failed at ${url}: ${summary}`, 200, url, summary);
    this.name = 'RiotSchemaError';
    this.issues = summary;
  }
}

export class RiotAuthError extends RiotApiError {
  constructor(message: string, status: number, url: string, responseBody?: unknown) {
    super(message, status, url, responseBody);
    this.name = 'RiotAuthError';
  }
}

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
