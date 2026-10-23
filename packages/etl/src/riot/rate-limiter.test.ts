import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APP_LIMITS,
  RiotRateLimiter,
  parseRateLimitHeader,
} from './rate-limiter';

describe('RiotRateLimiter', () => {
  describe('parseRateLimitHeader', () => {
    it('parses valid dual-rate limit header', () => {
      const parsed = parseRateLimitHeader('20:1,100:120');
      expect(parsed).toEqual([
        { maxRequests: 20, windowSeconds: 1 },
        { maxRequests: 100, windowSeconds: 120 },
      ]);
    });

    it('handles empty or malformed input gracefully', () => {
      expect(parseRateLimitHeader('')).toEqual([]);
      expect(parseRateLimitHeader(undefined)).toEqual([]);
      expect(parseRateLimitHeader('invalid')).toEqual([]);
      expect(parseRateLimitHeader('foo:bar,-1:0')).toEqual([]);
    });

    it('parses single method rate limit', () => {
      const parsed = parseRateLimitHeader('500:10');
      expect(parsed).toEqual([{ maxRequests: 500, windowSeconds: 10 }]);
    });
  });

  describe('rate limiting mechanics', () => {
    it('initializes with default app limits', () => {
      const limiter = new RiotRateLimiter();
      expect(limiter.getAppLimits()).toEqual(DEFAULT_APP_LIMITS);
    });

    it('prunes expired app timestamps over many acquisitions', async () => {
      let currentTime = 0;
      const limiter = new RiotRateLimiter({ now: () => currentTime });
      const maxAppLimit = Math.max(...DEFAULT_APP_LIMITS.map((limit) => limit.maxRequests));
      let maxTrackedCount = 0;

      for (let i = 0; i < 1000; i++) {
        await limiter.acquire();
        maxTrackedCount = Math.max(maxTrackedCount, limiter.getTrackedCount());
        currentTime += 120_001;
      }

      expect(maxTrackedCount).toBeLessThanOrEqual(maxAppLimit);
      expect(limiter.getTrackedCount()).toBeLessThanOrEqual(maxAppLimit);
    });

    it('allows requests within limit without waiting', async () => {
      let currentTime = 1000;
      let sleptMs = 0;

      const limiter = new RiotRateLimiter({
        appLimits: [{ maxRequests: 2, windowSeconds: 1 }],
        now: () => currentTime,
        sleep: async (ms) => {
          sleptMs += ms;
          currentTime += ms;
        },
      });

      await limiter.acquire();
      await limiter.acquire();

      expect(sleptMs).toBe(0);
    });

    it('waits when app limit window is full', async () => {
      let currentTime = 1000;
      let sleptMs = 0;

      const limiter = new RiotRateLimiter({
        appLimits: [{ maxRequests: 2, windowSeconds: 1 }], // 2 req per 1000ms
        now: () => currentTime,
        sleep: async (ms) => {
          sleptMs += ms;
          currentTime += ms;
        },
      });

      await limiter.acquire(); // at 1000
      currentTime = 1200;
      await limiter.acquire(); // at 1200

      // 3rd request at 1300: 2 requests already in [1000, 1300], window expires at 1000 + 1000 = 2000
      currentTime = 1300;
      await limiter.acquire();

      // Wait duration should be 2000 - 1300 = 700ms
      expect(sleptMs).toBe(700);
      expect(currentTime).toBe(2000);
    });

    it('updates limits dynamically from headers', () => {
      const limiter = new RiotRateLimiter();

      const headers = {
        'X-App-Rate-Limit': '50:1,500:120',
        'X-Method-Rate-Limit': '250:10',
        'Retry-After': '3',
      };

      const info = limiter.updateFromHeaders(headers, 'test-method');

      expect(limiter.getAppLimits()).toEqual([
        { maxRequests: 50, windowSeconds: 1 },
        { maxRequests: 500, windowSeconds: 120 },
      ]);
      expect(limiter.getMethodLimits('test-method')).toEqual([
        { maxRequests: 250, windowSeconds: 10 },
      ]);
      expect(info.retryAfterSeconds).toBe(3);
    });

    it('blocks execution when Retry-After is received', async () => {
      let currentTime = 1000;
      let sleptMs = 0;

      const limiter = new RiotRateLimiter({
        appLimits: [{ maxRequests: 10, windowSeconds: 1 }],
        now: () => currentTime,
        sleep: async (ms) => {
          sleptMs += ms;
          currentTime += ms;
        },
      });

      limiter.updateFromHeaders({
        'Retry-After': '5',
      });

      await limiter.acquire();

      // 5 seconds = 5000ms wait
      expect(sleptMs).toBe(5000);
      expect(currentTime).toBe(6000);
    });

    it('serializes concurrent acquisitions', async () => {
      let currentTime = 1000;
      const sleepCalls: number[] = [];

      const limiter = new RiotRateLimiter({
        appLimits: [{ maxRequests: 1, windowSeconds: 1 }], // 1 req per 1000ms
        now: () => currentTime,
        sleep: async (ms) => {
          sleepCalls.push(ms);
          currentTime += ms;
        },
      });

      // Fire 3 simultaneous acquisitions
      await Promise.all([limiter.acquire(), limiter.acquire(), limiter.acquire()]);

      // 1st request at 1000: no wait
      // 2nd request: waits 1000ms until 2000
      // 3rd request: waits 1000ms until 3000
      expect(sleepCalls).toEqual([1000, 1000]);
      expect(currentTime).toBe(3000);
    });
  });
});
