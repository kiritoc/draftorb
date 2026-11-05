import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { dbPathFromEnv } from '../config/paths';
import { exportJson } from '../export';
import { PATCH_PATTERN } from '../aggregate';
import { UsageError } from '../cli-args';
import { log, type Command } from './shared';

const USAGE = 'export [patch] [--region=<platform>]';

async function runExport(args: string[]): Promise<void> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        region: { type: 'string' },
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(`${message}\nUsage: ${USAGE}`);
  }
  const { values, positionals } = parsed;
  if (positionals.length > 1) {
    throw new UsageError(
      `Too many arguments (expected at most 1, got ${positionals.length}).\nUsage: ${USAGE}`,
    );
  }
  const patch = positionals[0];
  if (patch !== undefined) {
    // PATCH_PATTERN is validated inside exportJson; keep a fast usage check here too.
    if (!PATCH_PATTERN.test(patch)) {
      throw new UsageError(`Invalid patch "${patch}". Expected a format like "16.21".`);
    }
  }
  const dbPath = dbPathFromEnv();

  if (!existsSync(dbPath)) {
    log.info(`no database at ${dbPath}`);
    return;
  }
  const db: Database.Database = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    // UsageError is for CLI argument problems; exportJson keeps its own plain
    // Error for programmatic misuse.
    const result = exportJson(db, {
      patch,
      region: typeof values.region === 'string' ? values.region : undefined,
    });
    const { manifest, files, warnings, latestPath } = result;
    log.info(
      `Exported patch ${manifest.patch} (schema v${manifest.schemaVersion}, roles: ${manifest.roles.join(', ')}) to ${result.files.length} file(s):`,
    );
    for (const file of files) {
      log.detail(`${file.relativePath} (${file.bytes} bytes)`);
    }
    if (latestPath !== null) {
      log.detail(`Wrote latest patch pointer: ${latestPath}`);
    }
    for (const warning of warnings) {
      log.info(warning);
    }
  } finally {
    db.close();
  }
}

export const exportCommand: Command = {
  name: 'export',
  usage: USAGE,
  description: 'Write versioned JSON and manifest for the latest (or given) patch',
  run: runExport,
};
