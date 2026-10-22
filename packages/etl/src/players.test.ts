import { describe, expect, it, vi } from 'vitest';

import { openDb, migrate } from './db';
import { discoverPlayersByTier, playerRankScore } from './players';
import type { RiotClient } from './riot';

describe('player discovery', () => {
  it('calculates rank score from tier, division, and LP', () => {
    expect(playerRankScore('EMERALD', 'IV', 0)).toBe(5.6);
    expect(playerRankScore('DIAMOND', 'I', 25)).toBe(6.4);
    expect(playerRankScore('CHALLENGER', 'I', 100)).toBe(8.15);
  });

  it('stores discovered players, respects tier quotas, and writes resume state', async () => {
    const db = openDb(':memory:');
    migrate(db);

    const mockClient = {
      getLeagueEntries: vi.fn(async (_platform, _queue, tier, division, _page) => {
        if (tier === 'EMERALD') {
          return division === 'I'
            ? [
                { puuid: 'emerald-1', tier: 'EMERALD', rank: 'III', leaguePoints: 42 },
                { puuid: 'emerald-2', tier: 'EMERALD', rank: 'III', leaguePoints: 38 },
              ]
            : [];
        }

        if (tier === 'DIAMOND') {
          return division === 'I'
            ? [{ puuid: 'diamond-1', tier: 'DIAMOND', rank: 'II', leaguePoints: 55 }]
            : [];
        }

        return [];
      }),
      getMasterLeague: vi.fn(async () => ({ entries: [{ puuid: 'master-1', tier: 'MASTER', rank: 'I', leaguePoints: 70 }] })),
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

    const playerCount = db.prepare('SELECT COUNT(*) AS count FROM players').get() as { count: number };
    expect(playerCount.count).toBe(4);

    const progress = db
      .prepare('SELECT value FROM ingest_state WHERE key = ?')
      .get('player-discovery:euw1:EMERALD') as { value: string } | undefined;
    expect(progress).toBeDefined();

    const progressValue = progress?.value;
    expect(progressValue).toBeTypeOf('string');
    if (typeof progressValue !== 'string') {
      throw new Error('Progress value was not a string');
    }

    expect(JSON.parse(progressValue)).toMatchObject({ completed: true, stored: 2 });

    db.close();
  });
});
