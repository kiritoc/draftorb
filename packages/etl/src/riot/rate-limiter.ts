/**
 * Token-bucket / sliding-window rate limiter for the Riot Games API.
 *
 * Honors dual app-rate-limits (e.g. 20 req/1s and 100 req/120s) and method-rate-limits,
 * dynamically parses Riot rate-limit headers (X-App-Rate-Limit, X-Method-Rate-Limit),
 * and handles Retry-After backoffs.
 */

import { RateLimitHeaderInfo, RateLimitWindow } from './types';

export interface RateLimiterOptions {
  appLimits?: RateLimitWindow[];
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Default development limits: 20 req/1s and 100 req/120s */
export const DEFAULT_APP_LIMITS: RateLimitWindow[] = [
  { maxRequests: 20, windowSeconds: 1 },
  { maxRequests: 100, windowSeconds: 120 },
];

/**
 * Parses header values in the form "20:1,100:120" into RateLimitWindow arrays.
 */
export function parseRateLimitHeader(headerValue: string | null | undefined): RateLimitWindow[] {
  if (!headerValue || typeof headerValue !== 'string') {
    return [];
  }

  const windows: RateLimitWindow[] = [];
  const entries = headerValue.split(',');

  for (const entry of entries) {
    const parts = entry.trim().split(':');
    if (parts.length === 2) {
      const maxRequests = parseInt(parts[0] ?? '', 10);
      const windowSeconds = parseInt(parts[1] ?? '', 10);

      if (!isNaN(maxRequests) && !isNaN(windowSeconds) && maxRequests > 0 && windowSeconds > 0) {
        windows.push({ maxRequests, windowSeconds });
      }
    }
  }

  return windows;
}

export class RiotRateLimiter {
  private appLimits: RateLimitWindow[];
  private readonly methodLimits: Map<string, RateLimitWindow[]> = new Map();
  private appTimestamps: number[] = [];
  private readonly methodTimestamps: Map<string, number[]> = new Map();
  private blockedUntil = 0;
  private acquireQueue: Promise<void> = Promise.resolve();

  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;

  constructor(options: RateLimiterOptions = {}) {
    this.appLimits = options.appLimits ? [...options.appLimits] : [...DEFAULT_APP_LIMITS];
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * Returns current active app limit windows.
   */
  getAppLimits(): ReadonlyArray<RateLimitWindow> {
    return this.appLimits;
  }

  /** Returns the number of timestamps currently tracked for application limits. */
  getTrackedCount(): number {
    return this.appTimestamps.length;
  }

  /**
   * Returns active method limit windows for a given method key.
   */
  getMethodLimits(methodKey: string): ReadonlyArray<RateLimitWindow> {
    return this.methodLimits.get(methodKey) ?? [];
  }

  /**
   * Acquire a rate limit slot for execution.
   * If limits would be exceeded, pauses execution until a slot opens.
   */
  async acquire(methodKey?: string): Promise<void> {
    // Chain onto acquireQueue to ensure sequential reservation and no race conditions
    let releaseLock: (() => void) | undefined;
    const previousTurn = this.acquireQueue;
    this.acquireQueue = new Promise((resolve) => {
      releaseLock = resolve;
    });

    await previousTurn;
    try {
      await this.waitForSlot(methodKey);
    } finally {
      releaseLock?.();
    }
  }

  /**
   * Executes a task wrapped in rate-limiter acquire slot.
   */
  async execute<T>(fn: () => Promise<T>, methodKey?: string): Promise<T> {
    await this.acquire(methodKey);
    return await fn();
  }

  /**
   * Blocks all requests until the given timestamp (e.g. from 429 Retry-After).
   */
  blockUntil(timestampMs: number): void {
    if (timestampMs > this.blockedUntil) {
      this.blockedUntil = timestampMs;
    }
  }

  /**
   * Reads rate limit headers from a Riot response and updates limiter settings.
   */
  updateFromHeaders(
    headers: { get(name: string): string | null } | Record<string, string | undefined>,
    methodKey?: string,
  ): RateLimitHeaderInfo {
    const getHeader = (name: string): string | null | undefined => {
      if ('get' in headers && typeof headers.get === 'function') {
        return headers.get(name) ?? headers.get(name.toLowerCase());
      }
      const record = headers as Record<string, string | undefined>;
      return record[name] ?? record[name.toLowerCase()];
    };

    const appLimitStr = getHeader('X-App-Rate-Limit');
    const appCountStr = getHeader('X-App-Rate-Limit-Count');
    const methodLimitStr = getHeader('X-Method-Rate-Limit');
    const methodCountStr = getHeader('X-Method-Rate-Limit-Count');
    const retryAfterStr = getHeader('Retry-After');

    const appLimits = parseRateLimitHeader(appLimitStr);
    const appCounts = parseRateLimitHeader(appCountStr);
    const methodLimits = parseRateLimitHeader(methodLimitStr);
    const methodCounts = parseRateLimitHeader(methodCountStr);

    if (appLimits.length > 0) {
      this.appLimits = appLimits;
    }

    if (methodKey && methodLimits.length > 0) {
      this.methodLimits.set(methodKey, methodLimits);
    }

    let retryAfterSeconds: number | undefined;
    if (retryAfterStr) {
      const parsedSeconds = parseInt(retryAfterStr, 10);
      if (!isNaN(parsedSeconds) && parsedSeconds > 0) {
        retryAfterSeconds = parsedSeconds;
        this.blockUntil(this.now() + retryAfterSeconds * 1000);
      }
    }

    return {
      appLimits,
      appCounts,
      methodLimits,
      methodCounts,
      retryAfterSeconds,
    };
  }

  private async waitForSlot(methodKey?: string): Promise<void> {
    while (true) {
      const currentTime = this.now();
      let waitMs = 0;

      // 1. Check if blocked (e.g. Retry-After)
      if (currentTime < this.blockedUntil) {
        waitMs = Math.max(waitMs, this.blockedUntil - currentTime);
      }

      // 2. Check app limits
      waitMs = Math.max(waitMs, this.calculateWaitMs(this.appTimestamps, this.appLimits, currentTime));

      // 3. Check method limits
      if (methodKey) {
        const methodHistory = this.methodTimestamps.get(methodKey) ?? [];
        const limits = this.methodLimits.get(methodKey) ?? [];
        waitMs = Math.max(waitMs, this.calculateWaitMs(methodHistory, limits, currentTime));
      }

      if (waitMs <= 0) {
        // Slot is open: prune expired timestamps (bounded memory), then record
        const finalTime = this.now();
        const maxWindowMs = Math.max(0, ...this.appLimits.map((w) => w.windowSeconds * 1000));
        this.pruneBefore(this.appTimestamps, finalTime - maxWindowMs);
        this.appTimestamps.push(finalTime);
        if (methodKey) {
          let list = this.methodTimestamps.get(methodKey);
          if (!list) {
            list = [];
            this.methodTimestamps.set(methodKey, list);
          }
          const ml = this.methodLimits.get(methodKey) ?? [];
          this.pruneBefore(list, finalTime - Math.max(0, ...ml.map((w) => w.windowSeconds * 1000)));
          list.push(finalTime);
        }
        return;
      }

      // Must wait for slot to free up
      await this.sleep(waitMs);
    }
  }

  private pruneBefore(list: number[], cutoff: number): void {
    let i = 0;
    while (i < list.length && (list[i] as number) <= cutoff) i++;
    if (i > 0) list.splice(0, i);
  }

  private calculateWaitMs(timestamps: number[], windows: RateLimitWindow[], currentTime: number): number {
    let maxWait = 0;

    for (const win of windows) {
      const windowMs = win.windowSeconds * 1000;
      const cutoff = currentTime - windowMs;

      // Filter timestamps in this window
      let count = 0;
      let oldestInWindow: number | undefined;

      for (let i = timestamps.length - 1; i >= 0; i--) {
        const ts = timestamps[i];
        if (ts !== undefined && ts > cutoff) {
          count++;
          oldestInWindow = ts;
          if (count >= win.maxRequests) {
            // Need to wait until oldestInWindow expires
            const waitTime = oldestInWindow + windowMs - currentTime;
            if (waitTime > maxWait) {
              maxWait = waitTime;
            }
            break;
          }
        } else {
          break; // Timestamps are sorted chronologically
        }
      }
    }

    return maxWait;
  }
}
