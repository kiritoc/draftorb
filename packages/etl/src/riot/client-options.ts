import type { RiotRateLimiter } from './rate-limiter';

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
  timeoutMs?: number;
  max5xxRetries?: number;
  initialBackoffMs?: number;
  max429Retries?: number;
  logWarnings?: boolean;
}
