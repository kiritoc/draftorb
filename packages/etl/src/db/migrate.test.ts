import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { unlinkSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { migrate, getMigrationStatus, openDb } from './migrate';

const TEST_DB_PATH = 'test-migration.db';
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '../../../../');

function collectProcessOutput(
  child: ReturnType<typeof spawn>,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

describe('migration runner', () => {
  beforeEach(() => {
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
  });

  afterEach(() => {
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
  });

  it('should create database with WAL mode', () => {
    const db = openDb(TEST_DB_PATH);
    const journalMode = db.pragma('journal_mode', { simple: true });
    expect(journalMode).toBe('wal');
    db.close();
  });

  it('should apply initial migration', () => {
    const db = openDb(TEST_DB_PATH);
    const applied = migrate(db);

    expect(applied).toHaveLength(1);
    expect(applied[0]).toBe('001_initial');

    const status = getMigrationStatus(db);
    expect(status.applied).toBe(1);
    expect(status.pending).toBe(0);
    expect(status.versions).toEqual(['001_initial']);

    db.close();
  });

  it('should be idempotent (running twice does not error)', () => {
    const db = openDb(TEST_DB_PATH);

    const applied1 = migrate(db);
    expect(applied1).toHaveLength(1);

    const applied2 = migrate(db);
    expect(applied2).toHaveLength(0);

    const status = getMigrationStatus(db);
    expect(status.applied).toBe(1);
    expect(status.pending).toBe(0);

    db.close();
  });

  it('should create all core tables', () => {
    const db = openDb(TEST_DB_PATH);
    migrate(db);

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_migrations' ORDER BY name"
      )
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('players');
    expect(tableNames).toContain('matches');
    expect(tableNames).toContain('participants');
    expect(tableNames).toContain('item_events');
    expect(tableNames).toContain('ingest_state');
    expect(tableNames).toContain('role_prob');
    expect(tableNames).toContain('baseline');
    expect(tableNames).toContain('pair_ally');
    expect(tableNames).toContain('pair_enemy');
    expect(tableNames).toContain('rune_ctx');
    expect(tableNames).toContain('item_build');

    db.close();
  });

  it('should create all indexes', () => {
    const db = openDb(TEST_DB_PATH);
    migrate(db);

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")
      .all() as { name: string }[];

    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain('idx_part_champ_role');
    expect(indexNames).toContain('idx_part_match_id');
    expect(indexNames).toContain('idx_part_puuid');
    expect(indexNames).toContain('idx_matches_platform_patch');
    expect(indexNames).toContain('idx_players_platform_tier');
    expect(indexNames).toContain('idx_players_rank_score');
    expect(indexNames).toContain('idx_role_prob_champion');
    expect(indexNames).toContain('idx_baseline_champion_role');
    expect(indexNames).toContain('idx_pair_ally_support');
    expect(indexNames).toContain('idx_pair_enemy_support');
    expect(indexNames).toContain('idx_rune_ctx_champion');
    expect(indexNames).toContain('idx_item_build_champion');

    db.close();
  });

  it('should create _migrations table', () => {
    const db = openDb(TEST_DB_PATH);
    migrate(db);

    const migrations = db
      .prepare('SELECT * FROM _migrations')
      .all() as { version: string; applied_at: number }[];

    expect(migrations).toHaveLength(1);
    expect(migrations[0]?.version).toBe('001_initial');
    expect(migrations[0]?.applied_at).toBeGreaterThan(0);

    db.close();
  });

  it('should support inserting into core tables', () => {
    const db = openDb(TEST_DB_PATH);
    migrate(db);

    const insert = db.prepare(`
      INSERT INTO players (puuid, platform, tier, division, lp, rank_score, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run('test-puuid', 'euw1', 'DIAMOND', 'I', 75, 6.0, Date.now());

    const player = db
      .prepare('SELECT * FROM players WHERE puuid = ?')
      .get('test-puuid') as
      | {
          puuid: string;
          platform: string;
          tier: string;
        }
      | undefined;

    expect(player).toBeDefined();
    expect(player?.puuid).toBe('test-puuid');
    expect(player?.platform).toBe('euw1');
    expect(player?.tier).toBe('DIAMOND');

    db.close();
  });

  it('should allow item events with different types at the same timestamp and item', () => {
    const db = openDb(TEST_DB_PATH);
    migrate(db);

    const insert = db.prepare(`
      INSERT INTO item_events (match_id, puuid, ts, item_id, type, team_gold_diff, kills_diff)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run('test-match', 'test-puuid', 60000, 1001, 'ITEM_PURCHASED', 500, 1);
    insert.run('test-match', 'test-puuid', 60000, 1001, 'ITEM_UNDO', 500, 1);

    const events = db
      .prepare('SELECT type FROM item_events WHERE match_id = ? ORDER BY type')
      .all('test-match') as { type: string }[];

    expect(events).toEqual([{ type: 'ITEM_PURCHASED' }, { type: 'ITEM_UNDO' }]);
    db.close();
  });

  it('should get migration status correctly', () => {
    const db = openDb(TEST_DB_PATH);

    const statusBefore = getMigrationStatus(db);
    expect(statusBefore.applied).toBe(0);
    expect(statusBefore.pending).toBeGreaterThan(0);
    expect(statusBefore.versions).toEqual([]);

    migrate(db);

    const statusAfter = getMigrationStatus(db);
    expect(statusAfter.applied).toBe(1);
    expect(statusAfter.pending).toBe(0);
    expect(statusAfter.versions).toEqual(['001_initial']);

    db.close();
  });

  it('should report pending based on disk files and missing applied versions', () => {
    const db = openDb(TEST_DB_PATH);
    db.prepare(
      'CREATE TABLE IF NOT EXISTS _migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)'
    ).run();
    db.prepare('INSERT INTO _migrations (version, applied_at) VALUES (?, ?)').run(
      '001_initial',
      Date.now(),
    );
    db.prepare('INSERT INTO _migrations (version, applied_at) VALUES (?, ?)').run(
      '999_missing',
      Date.now(),
    );

    const status = getMigrationStatus(db);

    expect(status.applied).toBe(2);
    expect(status.pending).toBe(0);
    expect(status.versions).toEqual(['001_initial', '999_missing']);
    expect(status.missingVersions).toEqual(['999_missing']);

    db.close();
  });

  it('should avoid double-applying the same migration when two processes run concurrently', async () => {
    const dbPath = join(PROJECT_ROOT, 'tmp-concurrent-migration.db');
    if (existsSync(dbPath)) {
      unlinkSync(dbPath);
    }

    const migrateModuleUrl = pathToFileURL(join(PROJECT_ROOT, 'packages/etl/src/db/migrate.ts')).href;
    const script = `
      import { openDb, migrate } from ${JSON.stringify(migrateModuleUrl)};
      const db = openDb(${JSON.stringify(dbPath)});
      try {
        const applied = migrate(db);
        console.log(JSON.stringify(applied));
      } finally {
        db.close();
      }
    `;

    const first = spawn(process.execPath, ['--import', 'tsx', '--eval', script], {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const second = spawn(process.execPath, ['--import', 'tsx', '--eval', script], {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const [firstResult, secondResult] = await Promise.all([
      collectProcessOutput(first),
      collectProcessOutput(second),
    ]);

    expect(firstResult.code).toBe(0);
    expect(secondResult.code).toBe(0);
    expect(firstResult.stderr).toBe('');
    expect(secondResult.stderr).toBe('');

    const db = openDb(dbPath);
    const status = getMigrationStatus(db);
    expect(status.applied).toBe(1);
    expect(status.pending).toBe(0);
    expect(status.versions).toEqual(['001_initial']);
    db.close();

    if (existsSync(dbPath)) {
      unlinkSync(dbPath);
    }
  });

  it('should enable foreign keys by default', () => {
    const db = openDb(TEST_DB_PATH);
    const foreignKeys = db.pragma('foreign_keys', { simple: true });
    expect(foreignKeys).toBe(1);
    db.close();
  });

  it('should keep WAL and foreign_keys config on the opened database', () => {
    const db = openDb(TEST_DB_PATH);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    db.close();
  });
});
