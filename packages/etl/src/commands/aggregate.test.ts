import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UsageError } from '../cli-args';
import { migrate, openDb } from '../db';
import { seedPatches } from '../patches.test-helpers';
import { aggregateCommand } from './aggregate';

describe('aggregateCommand', () => {
  let directory: string;
  let originalDbPath: string | undefined;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'draftorb-aggregate-cmd-'));
    originalDbPath = process.env.DRAFTORB_DB_PATH;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    if (originalDbPath === undefined) {
      delete process.env.DRAFTORB_DB_PATH;
    } else {
      process.env.DRAFTORB_DB_PATH = originalDbPath;
    }
    rmSync(directory, { recursive: true, force: true });
  });

  const output = (): string => logSpy.mock.calls.map((call) => String(call[0])).join('\n');

  it('prints a message and returns when the database is missing', async () => {
    process.env.DRAFTORB_DB_PATH = join(directory, 'missing.sqlite');
    await expect(aggregateCommand.run([])).resolves.toBeUndefined();
    expect(output()).toMatch(/no database at/);
  });

  it('rejects a malformed patch with a usage error', async () => {
    process.env.DRAFTORB_DB_PATH = join(directory, 'missing.sqlite');
    await expect(aggregateCommand.run(['16'])).rejects.toBeInstanceOf(UsageError);
  });

  it('rejects too many arguments with a usage error', async () => {
    process.env.DRAFTORB_DB_PATH = join(directory, 'missing.sqlite');
    await expect(aggregateCommand.run(['16.21', 'extra'])).rejects.toBeInstanceOf(UsageError);
  });

  it('aggregates the explicit patch and reports an empty patch', async () => {
    const dbPath = join(directory, 'test.sqlite');
    process.env.DRAFTORB_DB_PATH = dbPath;
    const db = openDb(dbPath);
    migrate(db);
    seedPatches(db, ['16.20', '16.21']);
    db.prepare(
      `INSERT INTO matches (
        match_id, platform, patch, queue_id, duration, created_at, avg_rank_score
      ) VALUES ('m1', 'euw1', '16.21', 420, 1800, 1, 6.5)`,
    ).run();
    db.prepare(
      `INSERT INTO participants (
        match_id, puuid, team_id, champion_id, role, win, rank_score,
        champion_games, mastery_points, is_expert, keystone, primary_style,
        sub_style, perks_json, items_json, kills, deaths, assists
      ) VALUES (
        'm1', 'p1', 100, 412, 'SUPPORT', 1, null, 0, NULL, NULL, 8439, 8400, 8300, '{}', '[]', 0, 0, 0
      )`,
    ).run();
    db.close();

    await aggregateCommand.run(['16.21']);
    expect(output()).toMatch(
      /Aggregated role probabilities: 1 row\(s\) for 1 champion\(s\) written to role_prob/,
    );

    logSpy.mockClear();
    await aggregateCommand.run(['16.20']);
    expect(output()).toMatch(/role_prob left unchanged/);
  });

  it('writes rune_ctx rows and reports them when an expert participant exists', async () => {
    const dbPath = join(directory, 'test.sqlite');
    process.env.DRAFTORB_DB_PATH = dbPath;
    const db = openDb(dbPath);
    migrate(db);
    seedPatches(db, ['16.21']);
    db.prepare(
      `INSERT INTO matches (
        match_id, platform, patch, queue_id, duration, created_at, avg_rank_score
      ) VALUES ('m1', 'euw1', '16.21', 420, 1800, 1, 6.5)`,
    ).run();
    db.prepare(
      `INSERT INTO participants (
        match_id, puuid, team_id, champion_id, role, win, rank_score,
        champion_games, mastery_points, is_expert, keystone, primary_style,
        sub_style, perks_json, items_json, kills, deaths, assists
      ) VALUES (
        'm1', 'p1', 100, 412, 'SUPPORT', 1, 6.5, 100, NULL, NULL, 8439, 8400, 8300, '{"keystone":8439}', '[]', 0, 0, 0
      )`,
    ).run();
    db.close();

    await aggregateCommand.run(['16.21']);
    expect(output()).toMatch(/Aggregated rune contexts:/);

    const db2 = openDb(dbPath);
    try {
      const count = db2.prepare('SELECT COUNT(*) AS count FROM rune_ctx').get() as {
        count: number;
      };
      expect(count.count).toBeGreaterThan(0);
    } finally {
      db2.close();
    }
  });

  it('writes baseline rows even when the target patch has no participants', async () => {
    const dbPath = join(directory, 'test.sqlite');
    process.env.DRAFTORB_DB_PATH = dbPath;
    const db = openDb(dbPath);
    migrate(db);
    seedPatches(db, ['16.20', '16.21']);
    db.prepare(
      `INSERT INTO matches (
        match_id, platform, patch, queue_id, duration, created_at, avg_rank_score, rank_known_count
      ) VALUES ('m1', 'euw1', '16.20', 420, 1800, 1, 6.5, 2)`,
    ).run();
    db.prepare(
      `INSERT INTO participants (
        match_id, puuid, team_id, champion_id, role, win, rank_score,
        champion_games, mastery_points, is_expert, keystone, primary_style,
        sub_style, perks_json, items_json, kills, deaths, assists
      ) VALUES (
        'm1', 'p1', 100, 412, 'SUPPORT', 1, 6.5, 0, NULL, NULL, 8439, 8400, 8300, '{}', '[]', 0, 0, 0
      )`,
    ).run();
    db.close();

    // Target patch 16.21 has no participants of its own, but 16.20 evidence is
    // <= snapshot and contributes with decay. role_prob is aggregated (not left
    // unchanged), and baseline aggregates the stored 16.20 games.
    await aggregateCommand.run(['16.21']);
    expect(output()).toMatch(
      /Aggregated role probabilities: 1 row\(s\) for 1 champion\(s\) written to role_prob/,
    );
    expect(output()).toMatch(/Aggregated baselines:/);

    const db2 = openDb(dbPath);
    try {
      const count = db2.prepare('SELECT COUNT(*) AS count FROM baseline').get() as {
        count: number;
      };
      expect(count.count).toBeGreaterThan(0);
      const row = db2.prepare('SELECT games FROM baseline LIMIT 1').get() as { games: number };
      expect(row.games).toBe(1);
    } finally {
      db2.close();
    }
  });

  it('refuses to run on a database with pending migrations (B-048)', async () => {
    const dbPath = join(directory, 'test.sqlite');
    process.env.DRAFTORB_DB_PATH = dbPath;
    const db = openDb(dbPath);
    migrate(db);
    db.prepare(
      'DELETE FROM _migrations WHERE version = (SELECT MAX(version) FROM _migrations)',
    ).run();
    db.close();

    await expect(aggregateCommand.run([])).rejects.toThrow(
      'Database schema is out of date (1 pending migration(s)); run `pnpm etl migrate` first.',
    );
  });
});
