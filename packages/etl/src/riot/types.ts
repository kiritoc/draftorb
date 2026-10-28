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

function shortenPuuids(value: string): string {
  // Riot PUUIDs are 78-character base64url strings
  return value.replace(
    /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{78}(?![A-Za-z0-9_-])/g,
    (match) => `${match.slice(0, 8)}…`,
  );
}

function redactSensitiveText(value: string): string {
  // Redact API keys first, then shorten PUUIDs
  return shortenPuuids(value.replace(/RGAPI-[A-Za-z0-9_-]+/g, '[REDACTED]'));
}

function redactSensitiveValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactSensitiveText(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactSensitiveValue);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        redactSensitiveText(key),
        redactSensitiveValue(entry),
      ]),
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
    super(redactSensitiveText(message));
    this.name = 'RiotApiError';
    this.status = status;
    this.url = redactSensitiveText(url);
    this.responseBody = redactSensitiveValue(responseBody);
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
