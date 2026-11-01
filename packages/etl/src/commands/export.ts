import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { resolveRepoRoot } from '../config/paths';
import { exportJson } from '../export';
import { UsageError } from '../cli-args';
import { log, parsePositionals, type Command } from './shared';

function resolveDbPath(): string {
  const chosen = process.env.DRAFTORB_DB_PATH ?? join(resolveRepoRoot(), 'data', 'DraftOrb.sqlite');
  return resolve(chosen);
}

async function runExport(args: string[]): Promise<void> {
  const [patch] = parsePositionals(args, 1, 'export [patch]');
  if (patch !== undefined) {
    // PATCH_PATTERN is validated inside exportJson; keep a fast usage check here too.
    const PATCH_PATTERN = /^\d+\.\d+$/;
    if (!PATCH_PATTERN.test(patch)) {
      throw new UsageError(`Invalid patch "${patch}". Expected a format like "16.21".`);
    }
  }
  const dbPath = resolveDbPath();

  if (!existsSync(dbPath)) {
    log.info(`no database at ${dbPath}`);
    return;
  }

  const db = new Database(dbPath);
  try {
    const result = exportJson(db, { patch });
    const { manifest, files } = result;
    log.info(
      `Exported patch ${manifest.patch} (schema v${manifest.schemaVersion}, roles: ${manifest.roles.join(', ')}) to ${result.files.length} file(s):`,
    );
    for (const file of files) {
      log.detail(`${file.relativePath} (${file.bytes} bytes)`);
    }
  } finally {
    db.close();
  }
}

export const exportCommand: Command = {
  name: 'export',
  usage: 'export [patch]',
  description: 'Write versioned JSON and manifest for the latest (or given) patch',
  run: runExport,
};
