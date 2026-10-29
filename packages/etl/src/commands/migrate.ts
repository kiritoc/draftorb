import { resolveDbPath } from '../config/paths';
import { openDb, migrate, getMigrationStatus } from '../db';
import { log, parsePositionals, type Command, DB_ENV_VAR, DEFAULT_DB_FILENAME } from './shared';

async function runMigrate(args: string[]): Promise<void> {
  const [dbPathArg] = parsePositionals(args, 1, 'migrate [db-path]');
  const dbPath = resolveDbPath(dbPathArg);

  log.info(`Running database migrations on "${dbPath}"...`);

  const db = openDb(dbPath);
  try {
    const statusBefore = getMigrationStatus(db);
    log.info(`Before: ${statusBefore.applied} applied, ${statusBefore.pending} pending`);

    const applied = migrate(db);
    const statusAfter = getMigrationStatus(db);

    if (applied.length === 0) {
      log.info('No new migrations to apply.');
    } else {
      log.info(`Applied ${applied.length} migration(s): ${applied.join(', ')}`);
    }

    log.info(`After: ${statusAfter.applied} applied, ${statusAfter.pending} pending`);
  } finally {
    db.close();
  }
  log.info('Migration complete.');
}

export const migrateCommand: Command = {
  name: 'migrate',
  usage: 'migrate [db-path]',
  description: `Create or upgrade SQLite database (default: <repo root>/data/${DEFAULT_DB_FILENAME}, or $${DB_ENV_VAR})`,
  run: runMigrate,
};
