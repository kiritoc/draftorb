import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openDb, migrate } from '../db';
import { exportCommand } from './export';

describe('exportCommand', () => {
  let directory: string;
  let dbPath: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'draftorb-export-cmd-'));
    process.env.DRAFTORB_DB_PATH = dbPath = join(directory, 'test.sqlite');
    process.env.DRAFTORB_PUBLIC_DIR = join(directory, 'public');
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    if (process.env.DRAFTORB_DB_PATH === dbPath) delete process.env.DRAFTORB_DB_PATH;
    if (process.env.DRAFTORB_PUBLIC_DIR) delete process.env.DRAFTORB_PUBLIC_DIR;
    rmSync(directory, { recursive: true, force: true });
  });

  const output = (): string => logSpy.mock.calls.map((call) => String(call[0])).join('\n');

  it('prints a message and returns when the database is missing', async () => {
    process.env.DRAFTORB_DB_PATH = join(directory, 'missing.sqlite');
    await expect(exportCommand.run([])).resolves.toBeUndefined();
    expect(output()).toMatch(/no database at/);
  });

  it('rejects a malformed patch with a usage error', async () => {
    process.env.DRAFTORB_DB_PATH = join(directory, 'missing.sqlite');
    await expect(exportCommand.run(['16'])).rejects.toThrow(/Invalid patch/);
  });

  it('rejects too many arguments with a usage error', async () => {
    process.env.DRAFTORB_DB_PATH = join(directory, 'missing.sqlite');
    await expect(exportCommand.run(['16.21', 'extra'])).rejects.toThrow(/Too many arguments/);
  });

  it('writes the manifest and role-keyed JSON for a seeded database', async () => {
    const db = openDb(dbPath);
    migrate(db);
    db.prepare(
      `INSERT INTO matches (match_id, platform, patch, queue_id, duration, created_at, avg_rank_score, rank_known_count)
       VALUES ('m1', 'euw1', '16.21', 420, 1800, 1, 6.5, 2)`,
    ).run();
    db.prepare(
      `INSERT INTO role_prob (champion_id, role, games, games_w, games_w2, prob)
       VALUES (412, 'SUPPORT', 1, 10, 10, 1)`,
    ).run();
    db.prepare(
      `INSERT INTO baseline (champion_id, my_role, rank_bucket, wins_w, games_w, games_w2, games)
       VALUES (412, 'SUPPORT', 'IRON', 6, 10, 10, 3)`,
    ).run();
    db.close();

    await exportCommand.run([]);
    expect(output()).toMatch(/schema v2/);
    expect(output()).toMatch(/roles: SUPPORT/);

    const manifest = JSON.parse(
      readFileSync(
        join(process.env.DRAFTORB_PUBLIC_DIR as string, '16.21', 'manifest.json'),
        'utf8',
      ),
    );
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.patch).toBe('16.21');
    expect(manifest.roles).toEqual(['SUPPORT']);
    expect(manifest.rankBuckets).toEqual([
      'IRON',
      'BRONZE',
      'SILVER',
      'GOLD',
      'PLATINUM',
      'EMERALD',
      'DIAMOND',
      'MASTER_PLUS',
    ]);
    expect(manifest.files.some((f: { path: string }) => f.path === 'role-prob.json')).toBe(true);
    expect(
      manifest.files.some((f: { path: string }) => f.path === 'roles/SUPPORT/baseline.json'),
    ).toBe(true);
  });
});
