import { describe, expect, it, vi } from 'vitest';

import { openDb, migrate } from './db';
import { resolveRepoRoot, resolveDbPath } from './config/paths';
import { discoverPlayersByTier, playerRankScore } from './players';
import type { RiotClient } from './riot';

describe('player discovery', () => {
  it('calculates rank score from tier and division, independently of LP', () => {
    expect(playerRankScore('EMERALD', 'I')).toBeGreaterThan(playerRankScore('EMERALD', 'IV'));
    expect(playerRankScore('DIAMOND', 'IV')).toBeGreaterThan(playerRankScore('EMERALD', 'I'));
    expect(playerRankScore('MASTER', 'I')).toBeLessThan(playerRankScore('GRANDMASTER', 'I'));
    expect(playerRankScore('GRANDMASTER', 'I')).toBeLessThan(playerRankScore('CHALLENGER', 'I'));
    expect(playerRankScore('MASTER', 'I')).toBe(playerRankScore('MASTER', 'IV'));
    expect(playerRankScore('DIAMOND', 'I')).toBe(6.75);
  });

  it('truncates to quota, ignores entries without puuid, skips completed tiers on resume', async () => {
    const db = openDb(':memory:');
    migrate(db);
    const mk = (n: number, rank: string) =>
      Array.from({ length: n }, (_, i) => ({
        puuid: `e-${rank}-${i}`,
        tier: 'EMERALD',
        rank,
        leaguePoints: i,
      }));
    const getLeagueEntries = vi.fn(async (_p, _q, _t, division: string, page: number) =>
      page > 1 ? [] : [...mk(10, division), { tier: 'EMERALD', rank: division, leaguePoints: 1 }],
    );
    const client = { getLeagueEntries } as unknown as RiotClient;
    const opts = {
      platform: 'euw1' as const,
      db,
      client,
      tiers: ['EMERALD'],
      quotas: { EMERALD: 8 },
    };

    const r1 = await discoverPlayersByTier(opts);
    expect(r1.totalStored).toBe(8);
    const divisions = db.prepare('SELECT DISTINCT division FROM players').all();
    expect(divisions).toHaveLength(4);

    const calls = getLeagueEntries.mock.calls.length;
    const r2 = await discoverPlayersByTier(opts);
    expect(r2.tierResults[0]?.status).toBe('skipped');
    expect(getLeagueEntries.mock.calls.length).toBe(calls);
    db.close();
  });

  it('stores discovered players, respects tier quotas, and writes resume state', async () => {
    const db = openDb(':memory:');
    migrate(db);

    const mockClient = {
      getLeagueEntries: vi.fn(async (_platform, _queue, tier, division, _page) => {
        if (tier === 'EMERALD') {
          return division === 'I'
            ? [{ puuid: 'emerald-1', tier: 'EMERALD', rank: 'I', leaguePoints: 42 }]
            : division === 'II'
              ? [{ puuid: 'emerald-2', tier: 'EMERALD', rank: 'II', leaguePoints: 38 }]
              : [];
        }

        if (tier === 'DIAMOND') {
          return division === 'I'
            ? [{ puuid: 'diamond-1', tier: 'DIAMOND', rank: 'I', leaguePoints: 55 }]
            : [];
        }

        return [];
      }),
      getMasterLeague: vi.fn(async () => ({
        entries: [{ puuid: 'master-1', tier: 'MASTER', rank: 'I', leaguePoints: 70 }],
      })),
      getGrandmasterLeague: vi.fn(async () => ({ entries: [] })),
      getChallengerLeague: vi.fn(async () => ({ entries: [] })),
    } as unknown as RiotClient;

    const result = await discoverPlayersByTier({
      platform: 'euw1',
      db,
      client: mockClient,
      tiers: ['EMERALD', 'DIAMOND', 'MASTER'],
      quotas: { EMERALD: 2, DIAMOND: 1, MASTER: 1 },
      reset: true,
    });

    expect(result.totalStored).toBe(4);
    expect(result.tierResults.map((tier) => tier.tier)).toEqual(['EMERALD', 'DIAMOND', 'MASTER']);
    expect(result.tierResults[0]?.stored).toBe(2);
    expect(result.tierResults[1]?.stored).toBe(1);
    expect(result.tierResults[2]?.stored).toBe(1);

    const progress = db
      .prepare('SELECT value FROM ingest_state WHERE key = ?')
      .get('player-discovery:euw1:EMERALD') as { value: string } | undefined;
    expect(progress).toBeDefined();
    if (typeof progress?.value !== 'string') throw new Error('No progress value');
    expect(JSON.parse(progress.value)).toMatchObject({
      completed: true,
      status: 'complete',
      stored: 2,
    });

    db.close();
  });

  it('re-runs a completed tier after its max-age window expires and reports real page counts', async () => {
    const db = openDb(':memory:');
    migrate(db);
    const getLeagueEntries = vi.fn(async (_platform, _queue, tier, division, page) => {
      if (page > 1) return [];
      return [{ puuid: `p-${tier}-${division}-${page}`, tier, rank: division, leaguePoints: 10 }];
    });
    const client = { getLeagueEntries } as unknown as RiotClient;

    const first = await discoverPlayersByTier({
      platform: 'euw1',
      db,
      client,
      tiers: ['DIAMOND'],
      quotas: { DIAMOND: 1 },
      reset: true,
    });
    expect(first.tierResults[0]?.pageCount).toBeGreaterThan(0);
    expect(first.tierResults[0]?.status).toBe('complete');

    const progress = db
      .prepare('SELECT value FROM ingest_state WHERE key = ?')
      .get('player-discovery:euw1:DIAMOND') as { value: string };
    const parsed = JSON.parse(progress.value);
    parsed.updatedAt = Date.now() - 10 * 24 * 60 * 60 * 1000;
    db.prepare('UPDATE ingest_state SET value = ? WHERE key = ?').run(
      JSON.stringify(parsed),
      'player-discovery:euw1:DIAMOND',
    );

    const second = await discoverPlayersByTier({
      platform: 'euw1',
      db,
      client,
      tiers: ['DIAMOND'],
      quotas: { DIAMOND: 1 },
      maxAgeDays: 7,
    });
    expect(second.tierResults[0]?.status).toBe('complete');
    expect(getLeagueEntries).toHaveBeenCalledTimes(4 * 2);
    db.close();
  });

  it('resolves the same SQLite path from the repo root and from packages/etl', () => {
    const original = process.cwd();
    const root = resolveRepoRoot();
    const fromRoot = resolveDbPath();

    process.chdir(root + '/packages/etl');
    try {
      const fromEtl = resolveDbPath();
      expect(fromEtl).toBe(fromRoot);
    } finally {
      process.chdir(original);
    }
  });
});
