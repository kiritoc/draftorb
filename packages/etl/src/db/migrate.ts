import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../../migrations');

/**
 * Migration interface
 */
interface Migration {
  version: string;
  sql: string;
  checksum: string;
}

function hasChecksumColumn(db: Database.Database): boolean {
  const columns = db.pragma('table_info(_migrations)') as { name: string }[];
  return columns.some((column) => column.name === 'checksum');
}

function ensureMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL,
      checksum TEXT
    )
  `);

  if (!hasChecksumColumn(db)) {
    const addChecksumColumn = db.transaction(() => {
      if (!hasChecksumColumn(db)) {
        db.exec('ALTER TABLE _migrations ADD COLUMN checksum TEXT');
      }
    });
    addChecksumColumn.immediate();
  }
}

/**
 * Get all migration files sorted by version
 */
function getMigrations(): Migration[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const migrations: Migration[] = [];

  for (const file of files) {
    if (!/^\d{3,}_.+\.sql$/.test(file)) {
      throw new Error(`Invalid migration filename: ${file} (expected e.g. 001_init.sql)`);
    }

    const version = file.replace('.sql', '');
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    migrations.push({ version, sql, checksum });
  }

  return migrations;
}

/**
 * SQLite foreign keys are off by default. Open the connection with them enabled,
 * and if a future migration ever needs to disable them temporarily, do it before
 * `BEGIN IMMEDIATE` because the pragma has no effect inside a transaction.
 */
export function openDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('busy_timeout = 30000');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

/**
 * Run pending migrations (idempotent)
 * @param db - Database instance
 * @returns Array of applied migration versions
 */
export function migrate(db: Database.Database): string[] {
  ensureMigrationsTable(db);
  const migrations = getMigrations();
  const appliedRows = db
    .prepare('SELECT version, checksum FROM _migrations')
    .all() as { version: string; checksum: string | null }[];
  const appliedByVersion = new Map(appliedRows.map((row) => [row.version, row]));
  const backfillChecksum = db.prepare(
    'UPDATE _migrations SET checksum = ? WHERE version = ? AND checksum IS NULL',
  );

  for (const migration of migrations) {
    const applied = appliedByVersion.get(migration.version);
    if (!applied) {
      continue;
    }
    if (applied.checksum === null) {
      backfillChecksum.run(migration.checksum, migration.version);
    } else if (applied.checksum !== migration.checksum) {
      throw new Error(
        `Migration ${migration.version} checksum mismatch: the applied migration file has changed.`,
      );
    }
  }

  const applyMigration = db.transaction((migration: Migration): boolean => {
    const already = db
      .prepare('SELECT 1 FROM _migrations WHERE version = ?')
      .get(migration.version) as { 1: number } | undefined;

    if (already) {
      return false;
    }

    db.exec(migration.sql);
    db.prepare(
      'INSERT INTO _migrations (version, applied_at, checksum) VALUES (?, ?, ?)',
    ).run(
      migration.version,
      Date.now(),
      migration.checksum,
    );
    return true;
  });

  const appliedVersions = new Set(
    (db.prepare('SELECT version FROM _migrations').all() as { version: string }[]).map(
      (row) => row.version,
    ),
  );

  const appliedNow: string[] = [];

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }

    try {
      if (applyMigration.immediate(migration)) {
        appliedNow.push(migration.version);
      }
    } catch (error) {
      throw new Error(`Migration ${migration.version} failed: ${(error as Error).message}`, {
        cause: error,
      });
    }
  }

  return appliedNow;
}

/**
 * Get current migration status
 * @param db - Database instance
 * @returns Object with applied and pending migration counts
 */
export function getMigrationStatus(db: Database.Database): {
  applied: number;
  pending: number;
  versions: string[];
  missingVersions: string[];
} {
  ensureMigrationsTable(db);

  const migrations = getMigrations();
  const applied = db.prepare('SELECT version FROM _migrations ORDER BY version').all() as {
    version: string;
  }[];

  const appliedSet = new Set(applied.map((m) => m.version));
  const pendingVersions = migrations
    .filter((m) => !appliedSet.has(m.version))
    .map((m) => m.version);
  const migrationSet = new Set(migrations.map((m) => m.version));
  const missingVersions = applied
    .filter(({ version }) => !migrationSet.has(version))
    .map(({ version }) => version);

  return {
    applied: applied.length,
    pending: pendingVersions.length,
    versions: applied.map((m) => m.version),
    missingVersions,
  };
}
