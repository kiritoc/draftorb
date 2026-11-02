import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Database from 'better-sqlite3';

import { openDb, migrate } from '../db';
import { exportCommand } from './export';

describe('exportCommand', () => {
  let directory: string;
  let dbPath: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  const originalDbPath = process.env.DRAFTORB_DB_PATH;
  const originalPublicDir = process.env.DRAFTORB_PUBLIC_DIR;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'draftorb-export-cmd-'));
    dbPath = join(directory, 'test.sqlite');
    process.env.DRAFTORB_DB_PATH = dbPath;
    process.env.DRAFTORB_PUBLIC_DIR = join(directory, 'public');
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    // Restore env exactly (reassign when previously defined, delete otherwise).
    if (originalDbPath === undefined) {
      delete process.env.DRAFTORB_DB_PATH;
    } else {
      process.env.DRAFTORB_DB_PATH = originalDbPath;
    }
    if (originalPublicDir === undefined) {
      delete process.env.DRAFTORB_PUBLIC_DIR;
    } else {
      process.env.DRAFTORB_PUBLIC_DIR = originalPublicDir;
    }
    rmSync(directory, { recursive: true, force: true });
  });

  const output = (): string => logSpy.mock.calls.map((call) => String(call[0])).join('\n');

  it('prints a message and returns when the database is missing', async () => {
    process.env.DRAFTORB_DB_PATH = join(directory, 'missing.sqlite');
    await expect(exportCommand.run([])).resolves.toBeUndefined();
    expect(output()).toMatch(/no database at/);
  });

  it('surfaces database open errors instead of reporting a missing database', async () => {
    const invalidDbPath = join(directory, 'not-a-database');
    mkdirSync(invalidDbPath);
    process.env.DRAFTORB_DB_PATH = invalidDbPath;

    await expect(exportCommand.run([])).rejects.toThrow();
    expect(output()).not.toMatch(/no database at/);
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

  it('does not modify the SQLite database (read-only export)', async () => {
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
    db.close();

    const before = statSync(dbPath);
    const { size: beforeSize, mtimeMs: beforeMtime } = before;

    await exportCommand.run([]);

    const after = statSync(dbPath);
    expect(after.size).toBe(beforeSize);
    expect(after.mtimeMs).toBe(beforeMtime);

    // Opening read-only and attempting a write must fail.
    const readOnly = new Database(dbPath, { readonly: true, fileMustExist: true });
    expect(() => readOnly.prepare(`UPDATE matches SET patch = '16.22'`).run()).toThrow();
    readOnly.close();
  });

  it('uses the single platform without a multi-platform warning', async () => {
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
    db.close();

    await exportCommand.run([]);
    const manifest = JSON.parse(
      readFileSync(
        join(process.env.DRAFTORB_PUBLIC_DIR as string, '16.21', 'manifest.json'),
        'utf8',
      ),
    );
    expect(manifest.region).toBe('euw1');
    expect(output()).not.toMatch(/database contains .* platforms/);
  });

  it('prints a warning and picks the first platform when multiple platforms are present', async () => {
    const db = openDb(dbPath);
    migrate(db);
    db.prepare(
      `INSERT INTO matches (match_id, platform, patch, queue_id, duration, created_at, avg_rank_score, rank_known_count)
       VALUES ('m1', 'euw1', '16.21', 420, 1800, 1, 6.5, 2),
              ('m2', 'na1', '16.21', 420, 1800, 2, 6.5, 2)`,
    ).run();
    db.close();

    await exportCommand.run([]);

    expect(output()).toContain(
      'database contains 2 platforms (euw1, na1); using alphabetically first euw1',
    );
    const manifest = JSON.parse(
      readFileSync(
        join(process.env.DRAFTORB_PUBLIC_DIR as string, '16.21', 'manifest.json'),
        'utf8',
      ),
    );
    expect(manifest.region).toBe('euw1');
  });

  it('supports the --region flag', async () => {
    const db = openDb(dbPath);
    migrate(db);
    db.prepare(
      `INSERT INTO matches (match_id, platform, patch, queue_id, duration, created_at, avg_rank_score, rank_known_count)
       VALUES ('m1', 'euw1', '16.21', 420, 1800, 1, 6.5, 2)`,
    ).run();
    db.close();

    await exportCommand.run(['--region=kr']);
    const manifest = JSON.parse(
      readFileSync(
        join(process.env.DRAFTORB_PUBLIC_DIR as string, '16.21', 'manifest.json'),
        'utf8',
      ),
    );
    expect(manifest.region).toBe('kr');
  });

  it('prints the skipped rune page summary exactly once (C2)', async () => {
    const db = openDb(dbPath);
    migrate(db);
    db.prepare(
      `INSERT INTO matches (match_id, platform, patch, queue_id, duration, created_at, avg_rank_score, rank_known_count)
       VALUES ('m1', 'euw1', '16.21', 420, 1800, 1, 6.5, 2)`,
    ).run();
    db.prepare(
      `INSERT INTO rune_ctx (
         champion_id, my_role, rank_bucket, context_key, context_level, perks_hash,
         perks_json, wins_w, games_w, games_w2, players
       ) VALUES (412, 'SUPPORT', 'IRON', 'global', 5, 'bad', 'not json', 1, 10, 10, 1)`,
    ).run();
    db.close();

    await exportCommand.run([]);

    const summary = 'skipped 1 rune page(s) with unparseable or invalid perks_json';
    expect(output().split(summary)).toHaveLength(2);
  });
});
