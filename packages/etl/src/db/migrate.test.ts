import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, unlinkSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { migrate, getMigrationStatus, openDb } from './migrate';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '../../../../');
const MIGRATIONS_DIR = join(__dirname, '../../migrations');
const TEMP_DIR = mkdtempSync(join(tmpdir(), 'draftorb-migrate-'));
const TEST_DB_PATH = join(TEMP_DIR, 'test-migration.db');

/** Migration versions on disk, in application order. */
function expectedVersions(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => f.replace('.sql', ''));
}

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

  afterAll(() => {
    if (existsSync(TEMP_DIR)) {
      rmSync(TEMP_DIR, { recursive: true, force: true });
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
    const versions = expectedVersions();

    expect(applied).toEqual(versions);
    expect(applied[0]).toBe('001_initial');

    const status = getMigrationStatus(db);
    expect(status.applied).toBe(versions.length);
    expect(status.pending).toBe(0);
    expect(status.versions).toEqual(versions);

    db.close();
  });

  it('should be idempotent (running twice does not error)', () => {
    const db = openDb(TEST_DB_PATH);

    const applied1 = migrate(db);
    expect(applied1).toHaveLength(expectedVersions().length);

    const applied2 = migrate(db);
    expect(applied2).toHaveLength(0);

    const status = getMigrationStatus(db);
    expect(status.applied).toBe(expectedVersions().length);
    expect(status.pending).toBe(0);

    db.close();
  });

  it('should create all core tables', () => {
    const db = openDb(TEST_DB_PATH);
    migrate(db);

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_migrations' ORDER BY name",
      )
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('players');
    expect(tableNames).toContain('matches');
    expect(tableNames).toContain('participants');
    expect(tableNames).toContain('item_events');
    expect(tableNames).toContain('ingest_state');
    expect(tableNames).toContain('match_rejects');
    expect(tableNames).toContain('role_prob');
    expect(tableNames).toContain('baseline');
    expect(tableNames).toContain('pair_ally');
    expect(tableNames).toContain('pair_enemy');
    expect(tableNames).toContain('rune_ctx');
    expect(tableNames).toContain('item_build');
    expect(tableNames).toContain('lane_vs');
    expect(tableNames).toContain('lane_full');
    expect(tableNames).toContain('patches');

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
    expect(indexNames).toContain('idx_pair_ally_role');
    expect(indexNames).toContain('idx_pair_enemy_role');
    expect(indexNames).toContain('idx_lane_vs_role');
    expect(indexNames).toContain('idx_lane_full_role');
    expect(indexNames).toContain('idx_lane_vs_unique');
    expect(indexNames).toContain('idx_lane_full_unique');
    expect(indexNames).toContain('idx_rune_ctx_champion');
    expect(indexNames).toContain('idx_item_build_champion');

    db.close();
  });

  it('should create _migrations table', () => {
    const db = openDb(TEST_DB_PATH);
    migrate(db);

    const migrations = db.prepare('SELECT * FROM _migrations').all() as {
      version: string;
      applied_at: number;
      checksum: string;
    }[];

    expect(migrations).toHaveLength(expectedVersions().length);
    expect(migrations[0]?.version).toBe('001_initial');
    expect(migrations[0]?.applied_at).toBeGreaterThan(0);
    expect(migrations[0]?.checksum).toMatch(/^[a-f0-9]{64}$/);

    db.close();
  });

  it('should apply the rank-known migration once and default its count to zero', () => {
    const db = openDb(':memory:');

    expect(migrate(db)).toEqual(expectedVersions());
    expect(migrate(db)).toEqual([]);

    const columns = db.prepare('PRAGMA table_info(matches)').all() as {
      name: string;
      notnull: number;
      dflt_value: string | null;
    }[];
    const rankKnownColumns = columns.filter((column) => column.name === 'rank_known_count');
    expect(rankKnownColumns).toHaveLength(1);
    expect(rankKnownColumns[0]?.notnull).toBe(1);
    expect(rankKnownColumns[0]?.dflt_value).toBe('0');

    db.prepare(
      `INSERT INTO matches
       (match_id, platform, patch, queue_id, duration, created_at, avg_rank_score)
       VALUES ('test-match', 'euw1', '16.21', 420, 1800, 1, 6.5)`,
    ).run();
    const row = db
      .prepare('SELECT rank_known_count FROM matches WHERE match_id = ?')
      .get('test-match') as { rank_known_count: number } | undefined;
    expect(row?.rank_known_count).toBe(0);

    db.close();
  });

  it('upgrades a seeded 001-003 database without losing matches or participants', () => {
    const db = openDb(':memory:');
    db.exec(`
      CREATE TABLE _migrations (
        version TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      )
    `);

    for (const version of ['001_initial', '002_match_rejects', '003_matches_rank_known']) {
      db.exec(readFileSync(join(MIGRATIONS_DIR, `${version}.sql`), 'utf8'));
      db.prepare('INSERT INTO _migrations (version, applied_at) VALUES (?, ?)').run(version, 1);
    }

    db.prepare(
      `INSERT INTO matches (
        match_id, platform, patch, queue_id, duration, created_at, avg_rank_score, rank_known_count
      ) VALUES ('legacy-match', 'euw1', '16.21', 420, 1800, 1, 6.5, 1)`,
    ).run();
    db.prepare(
      `INSERT INTO participants (
        match_id, puuid, team_id, champion_id, role, win, rank_score, champion_games,
        keystone, primary_style, sub_style, perks_json, items_json, kills, deaths, assists
      ) VALUES (
        'legacy-match', 'legacy-player', 100, 412, 'SUPPORT', 1, 6.5, 0,
        8439, 8400, 8300, '{}', '[]', 2, 3, 18
      )`,
    ).run();
    db.prepare(
      `INSERT INTO item_events (
        match_id, puuid, ts, item_id, type, team_gold_diff, kills_diff
      ) VALUES ('legacy-match', 'legacy-player', 1000, 3109, 'ITEM_PURCHASED', 0, 0)`,
    ).run();

    expect(migrate(db)).toEqual([
      '004_role_generic_aggregates',
      '005_lane_null_unique',
      '006_nullable_rank_score',
      '007_matches_enriched',
      '008_baseline_raw_games',
      '009_role_prob_decay_weights',
      '010_rune_ctx_context_level',
      '011_rune_ctx_rank_bucket',
      '012_patches',
    ]);
    expect(migrate(db)).toEqual([]);

    const match = db
      .prepare('SELECT match_id FROM matches WHERE match_id = ?')
      .get('legacy-match') as { match_id: string } | undefined;
    const participant = db
      .prepare(
        `SELECT match_id, puuid, rank_score, mastery_points, is_expert
         FROM participants WHERE match_id = ?`,
      )
      .get('legacy-match') as
      | {
          match_id: string;
          puuid: string;
          rank_score: number;
          mastery_points: number | null;
          is_expert: number | null;
        }
      | undefined;
    const event = db
      .prepare('SELECT item_slot FROM item_events WHERE match_id = ?')
      .get('legacy-match') as { item_slot: number | null } | undefined;

    expect(match?.match_id).toBe('legacy-match');
    expect(participant).toEqual({
      match_id: 'legacy-match',
      puuid: 'legacy-player',
      rank_score: 6.5,
      mastery_points: null,
      is_expert: null,
    });
    expect(event?.item_slot).toBeNull();
    db.prepare(
      `INSERT INTO lane_vs (
        my_champion_id, my_role, opp1_id, opp2_id, rank_bucket, wins_w, games_w, games_w2
      ) VALUES (1, 'TOP', 10, NULL, 'DIAMOND', 1, 1, 1)`,
    ).run();
    expect(() =>
      db
        .prepare(
          `INSERT INTO lane_vs (
            my_champion_id, my_role, opp1_id, opp2_id, rank_bucket, wins_w, games_w, games_w2
          ) VALUES (1, 'TOP', 10, NULL, 'DIAMOND', 2, 2, 2)`,
        )
        .run(),
    ).toThrow(/UNIQUE/);
    db.prepare(
      `INSERT INTO lane_full (
        my_champion_id, my_role, partner_id, opp1_id, opp2_id, rank_bucket, wins_w, games_w, games_w2
      ) VALUES (1, 'TOP', NULL, 10, NULL, 'DIAMOND', 1, 1, 1)`,
    ).run();
    expect(() =>
      db
        .prepare(
          `INSERT INTO lane_full (
            my_champion_id, my_role, partner_id, opp1_id, opp2_id, rank_bucket, wins_w, games_w, games_w2
          ) VALUES (1, 'TOP', NULL, 10, NULL, 'DIAMOND', 2, 2, 2)`,
        )
        .run(),
    ).toThrow(/UNIQUE/);
    db.prepare(
      `INSERT INTO lane_full (
        my_champion_id, my_role, partner_id, opp1_id, opp2_id, rank_bucket, wins_w, games_w, games_w2
      ) VALUES (1, 'TOP', NULL, 10, 5, 'DIAMOND', 1, 1, 1)`,
    ).run();
    expect(db.prepare('SELECT COUNT(*) AS count FROM _migrations').get()).toMatchObject({
      count: 12,
    });
    db.close();
  });

  it('migration 010 backfills context_level from context_key', () => {
    const db = openDb(':memory:');
    db.exec(`
      CREATE TABLE _migrations (
        version TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      )
    `);
    const priorVersions = expectedVersions().filter((v) => v < '010_rune_ctx_context_level');
    for (const version of priorVersions) {
      db.exec(readFileSync(join(MIGRATIONS_DIR, `${version}.sql`), 'utf8'));
      db.prepare('INSERT INTO _migrations (version, applied_at) VALUES (?, ?)').run(version, 1);
    }
    const insert = db.prepare(
      `INSERT INTO rune_ctx (
        champion_id, my_role, context_key, perks_hash, perks_json, wins_w, games_w, games_w2, players
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run(412, 'SUPPORT', 'lane:a.ADC:21,e.ADC:22,e.SUPPORT:266', 'hash1', '{}', 1, 1, 1, 1);
    insert.run(412, 'SUPPORT', 'lane:e.ADC:22,e.SUPPORT:266', 'hash2', '{}', 1, 1, 1, 1);
    insert.run(412, 'SUPPORT', 'lane:e.SUPPORT:266', 'hash3', '{}', 1, 1, 1, 1);
    insert.run(412, 'SUPPORT', 'damagemix:mixed', 'hash4', '{}', 1, 1, 1, 1);
    insert.run(412, 'SUPPORT', 'global', 'hash5', '{}', 1, 1, 1, 1);

    db.exec(readFileSync(join(MIGRATIONS_DIR, '010_rune_ctx_context_level.sql'), 'utf8'));
    db.prepare('INSERT INTO _migrations (version, applied_at) VALUES (?, ?)').run(
      '010_rune_ctx_context_level',
      1,
    );

    const rows = db
      .prepare('SELECT context_key, context_level FROM rune_ctx ORDER BY context_key')
      .all() as Array<{ context_key: string; context_level: number }>;
    expect(
      rows.find((r) => r.context_key === 'lane:a.ADC:21,e.ADC:22,e.SUPPORT:266')?.context_level,
    ).toBe(1);
    expect(rows.find((r) => r.context_key === 'lane:e.ADC:22,e.SUPPORT:266')?.context_level).toBe(
      2,
    );
    expect(rows.find((r) => r.context_key === 'lane:e.SUPPORT:266')?.context_level).toBe(3);
    expect(rows.find((r) => r.context_key === 'damagemix:mixed')?.context_level).toBe(4);
    expect(rows.find((r) => r.context_key === 'global')?.context_level).toBe(5);
    db.close();
  });

  it('upgrades a 001-007 database with migration 008 and defaults baseline.games to 0', () => {
    const db = openDb(':memory:');
    db.exec(`
      CREATE TABLE _migrations (
        version TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      )
    `);
    const priorVersions = expectedVersions().filter((v) => v < '008_baseline_raw_games');
    for (const version of priorVersions) {
      db.exec(readFileSync(join(MIGRATIONS_DIR, `${version}.sql`), 'utf8'));
      db.prepare('INSERT INTO _migrations (version, applied_at) VALUES (?, ?)').run(version, 1);
    }
    db.prepare(
      `INSERT INTO baseline (
        champion_id, my_role, rank_bucket, wins_w, games_w, games_w2
      ) VALUES (1, 'SUPPORT', 'DIAMOND', 3, 5, 5)`,
    ).run();

    expect(migrate(db)).toEqual([
      '008_baseline_raw_games',
      '009_role_prob_decay_weights',
      '010_rune_ctx_context_level',
      '011_rune_ctx_rank_bucket',
      '012_patches',
    ]);
    expect(migrate(db)).toEqual([]);

    const columns = db.prepare('PRAGMA table_info(baseline)').all() as {
      name: string;
      notnull: number;
      dflt_value: string | null;
    }[];
    const games = columns.filter((c) => c.name === 'games');
    expect(games).toHaveLength(1);
    expect(games[0]?.notnull).toBe(1);
    expect(games[0]?.dflt_value).toBe('0');

    const row = db.prepare('SELECT games FROM baseline WHERE champion_id = 1').get() as
      { games: number } | undefined;
    expect(row?.games).toBe(0);
    db.close();
  });

  it('backfills NULL checksums and rejects an applied migration with a changed checksum', () => {
    const db = openDb(':memory:');
    migrate(db);
    db.prepare('UPDATE _migrations SET checksum = NULL WHERE version = ?').run('002_match_rejects');

    expect(migrate(db)).toEqual([]);
    const backfilled = db
      .prepare('SELECT checksum FROM _migrations WHERE version = ?')
      .get('002_match_rejects') as { checksum: string | null };
    expect(backfilled.checksum).toMatch(/^[a-f0-9]{64}$/);

    db.prepare('UPDATE _migrations SET checksum = ? WHERE version = ?').run(
      'changed',
      '001_initial',
    );
    expect(() => migrate(db)).toThrow(/Migration 001_initial checksum mismatch/);
    db.close();
  });

  it('cascades match deletes to participants and item events', () => {
    const db = openDb(':memory:');
    migrate(db);
    db.prepare(
      `INSERT INTO matches (
        match_id, platform, patch, queue_id, duration, created_at, avg_rank_score
      ) VALUES ('cascade-match', 'euw1', '16.21', 420, 1800, 1, 6.5)`,
    ).run();
    db.prepare(
      `INSERT INTO participants (
        match_id, puuid, team_id, champion_id, role, win, rank_score, champion_games,
        keystone, primary_style, sub_style, perks_json, items_json, kills, deaths, assists
      ) VALUES (
        'cascade-match', 'cascade-player', 100, 412, 'SUPPORT', 1, 6.5, 0,
        8439, 8400, 8300, '{}', '[]', 2, 3, 18
      )`,
    ).run();
    db.prepare(
      `INSERT INTO item_events (
        match_id, puuid, ts, item_id, type, team_gold_diff, kills_diff, item_slot
      ) VALUES ('cascade-match', 'cascade-player', 1000, 3109, 'ITEM_PURCHASED', 0, 0, 1)`,
    ).run();

    db.prepare('DELETE FROM matches WHERE match_id = ?').run('cascade-match');

    expect(db.prepare('SELECT COUNT(*) AS count FROM participants').get()).toMatchObject({
      count: 0,
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM item_events').get()).toMatchObject({
      count: 0,
    });
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

    const player = db.prepare('SELECT * FROM players WHERE puuid = ?').get('test-puuid') as
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
    db.prepare(
      `INSERT INTO matches (
        match_id, platform, patch, queue_id, duration, created_at, avg_rank_score
      ) VALUES ('test-match', 'euw1', '16.21', 420, 1800, 1, 6.5)`,
    ).run();

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
    expect(statusAfter.applied).toBe(expectedVersions().length);
    expect(statusAfter.pending).toBe(0);
    expect(statusAfter.versions).toEqual(expectedVersions());

    db.close();
  });

  it('should report pending based on disk files and missing applied versions', () => {
    const db = openDb(TEST_DB_PATH);
    db.prepare(
      'CREATE TABLE IF NOT EXISTS _migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
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
    expect(status.pending).toBe(expectedVersions().length - 1);
    expect(status.versions).toEqual(['001_initial', '999_missing']);
    expect(status.missingVersions).toEqual(['999_missing']);

    db.close();
  });

  it('should avoid double-applying the same migration when two processes run concurrently', async () => {
    const dbPath = join(TEMP_DIR, 'tmp-concurrent-migration.db');
    if (existsSync(dbPath)) {
      unlinkSync(dbPath);
    }
    openDb(dbPath).close();

    const migrateModuleUrl = pathToFileURL(
      join(PROJECT_ROOT, 'packages/etl/src/db/migrate.ts'),
    ).href;
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

    expect(firstResult.code, firstResult.stderr).toBe(0);
    expect(secondResult.code, secondResult.stderr).toBe(0);
    expect(firstResult.stderr).toBe('');
    expect(secondResult.stderr).toBe('');

    const db = openDb(dbPath);
    const status = getMigrationStatus(db);
    expect(status.applied).toBe(expectedVersions().length);
    expect(status.pending).toBe(0);
    expect(status.versions).toEqual(expectedVersions());
    db.close();
  }, 10_000);

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
