import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { migrate, openDb } from '../db';
import { matchesCommand } from './matches';
import { PLATFORM, seedParticipant, seedPlayer } from '../matches.test-helpers';

async function withDryRunEnv(poolFile: string | null, run: () => Promise<void>): Promise<string[]> {
  const dir = mkdtempSync(join(tmpdir(), 'draftorb-matches-cmd-'));
  const dbPath = join(dir, 'test.sqlite');
  const originalDbPath = process.env.DRAFTORB_DB_PATH;
  const originalPoolPath = process.env.DRAFTORB_POOL_CONFIG_PATH;
  process.env.DRAFTORB_DB_PATH = dbPath;
  // Always point at a temp path: the real repo file may exist once the owner
  // commits data/pool.config.json (D-114), which must not leak into tests.
  process.env.DRAFTORB_POOL_CONFIG_PATH = poolFile ?? join(dir, 'absent.pool.json');

  const db = openDb(dbPath);
  migrate(db);
  seedPlayer(db, 'p-high', 9);
  seedPlayer(db, 'p-low', 5);
  seedParticipant(db, {
    matchId: `EUW1_${PLATFORM}_seed`,
    puuid: 'p-low',
    championId: 267,
    role: 'SUPPORT',
  });
  db.close();

  const lines: string[] = [];
  const consoleLog = vi.spyOn(console, 'log').mockImplementation((msg?: unknown) => {
    lines.push(String(msg));
  });
  try {
    await run();
  } finally {
    consoleLog.mockRestore();
    if (originalDbPath === undefined) delete process.env.DRAFTORB_DB_PATH;
    else process.env.DRAFTORB_DB_PATH = originalDbPath;
    if (originalPoolPath === undefined) delete process.env.DRAFTORB_POOL_CONFIG_PATH;
    else process.env.DRAFTORB_POOL_CONFIG_PATH = originalPoolPath;
    rmSync(dir, { recursive: true, force: true });
  }
  return lines;
}

describe('matchesCommand --dry-run', () => {
  it('prints the priority reason for every selected player, pool matches first', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'draftorb-pool-file-'));
    const poolFile = join(dir, 'pool.config.json');
    writeFileSync(
      poolFile,
      JSON.stringify({
        schemaVersion: 1,
        pools: { SUPPORT: [{ championId: 267 }] },
      }),
    );
    try {
      const lines = await withDryRunEnv(poolFile, () => matchesCommand.run(['--dry-run']));
      const output = lines.join('\n');
      const poolLine = lines.find((l) => l.includes('[pool]'));
      expect(poolLine).toContain('p-low');
      expect(output).toContain('p-high');
      expect(output.indexOf('[pool]')).toBeLessThan(output.indexOf('[rank]'));
      expect(output).toContain('pool.config.json');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never migrates or writes: refuses a database with pending migrations', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'draftorb-dry-run-ro-'));
    const dbPath = join(dir, 'legacy.sqlite');
    const db = openDb(dbPath);
    migrate(db);
    // Simulate a database awaiting the latest migration (e.g. 017).
    const latest = db
      .prepare('SELECT version FROM _migrations ORDER BY version DESC LIMIT 1')
      .get() as { version: string };
    db.prepare('DELETE FROM _migrations WHERE version = ?').run(latest.version);
    const before = (db.prepare('SELECT COUNT(*) AS n FROM _migrations').get() as { n: number }).n;
    db.close();

    const originalDbPath = process.env.DRAFTORB_DB_PATH;
    process.env.DRAFTORB_DB_PATH = dbPath;
    try {
      await expect(matchesCommand.run(['--dry-run'])).rejects.toThrow(/pending migrations/);
      const check = openDb(dbPath);
      const after = (check.prepare('SELECT COUNT(*) AS n FROM _migrations').get() as { n: number })
        .n;
      check.close();
      expect(after).toBe(before);
    } finally {
      if (originalDbPath === undefined) delete process.env.DRAFTORB_DB_PATH;
      else process.env.DRAFTORB_DB_PATH = originalDbPath;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('marks every player as rank-ordered when no pool file exists', async () => {
    const lines = await withDryRunEnv(null, () =>
      matchesCommand.run(['euw1', '--dry-run', '--limit=1']),
    );
    const output = lines.join('\n');
    expect(output).toContain('p-high');
    expect(output).not.toContain('p-low');
    expect(output).toContain('[rank]');
    expect(output).not.toContain('[pool]');
  });
});
