import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { resolveDbPath } from './config/paths';
import { openDb, migrate } from './db';
import { ingestMatches } from './matches';
import { discoverPlayersByTier } from './players';
import type { RiotClient } from './riot';

async function withTemporaryDbPath(run: () => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'draftorb-db-ownership-'));
  const originalDbPath = process.env.DRAFTORB_DB_PATH;
  process.env.DRAFTORB_DB_PATH = join(directory, 'draftorb.sqlite');
  try {
    await run();
  } finally {
    if (originalDbPath === undefined) {
      delete process.env.DRAFTORB_DB_PATH;
    } else {
      process.env.DRAFTORB_DB_PATH = originalDbPath;
    }
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('internally owned SQLite connections', () => {
  it('closes the player discovery connection when discovery fails', async () => {
    await withTemporaryDbPath(async () => {
      const close = vi.spyOn(Database.prototype, 'close');
      const client = {
        getLeagueEntries: vi.fn(async () => {
          throw new Error('network unavailable');
        }),
      } as unknown as RiotClient;

      try {
        await expect(
          discoverPlayersByTier({
            tiers: ['EMERALD'],
            quotas: { EMERALD: 1 },
            client,
          }),
        ).rejects.toThrow('network unavailable');
        expect(close).toHaveBeenCalledTimes(1);
        await discoverPlayersByTier({
          tiers: ['EMERALD'],
          quotas: { EMERALD: 0 },
          client,
        });
        expect(close).toHaveBeenCalledTimes(2);
      } finally {
        close.mockRestore();
      }
    });
  });

  it('closes the match ingestion connection when listing match IDs fails', async () => {
    await withTemporaryDbPath(async () => {
      const setupDb = openDb(resolveDbPath());
      migrate(setupDb);
      setupDb
        .prepare(
          `INSERT INTO players (puuid, platform, tier, division, lp, rank_score, updated_at)
           VALUES ('player-1', 'euw1', 'DIAMOND', 'I', 0, 6.75, 0)`,
        )
        .run();
      setupDb.close();

      const close = vi.spyOn(Database.prototype, 'close');
      const client = {
        getMatchIdsByPuuid: vi.fn(async () => {
          throw new Error('listing failed');
        }),
        getMatch: vi.fn(),
      } as unknown as RiotClient;

      try {
        await expect(ingestMatches({ client })).rejects.toThrow('listing failed');
        expect(close).toHaveBeenCalledTimes(1);
        await ingestMatches({
          client: {
            getMatchIdsByPuuid: vi.fn(async () => []),
            getMatch: vi.fn(),
          } as unknown as RiotClient,
        });
        expect(close).toHaveBeenCalledTimes(2);
      } finally {
        close.mockRestore();
      }
    });
  });
});
