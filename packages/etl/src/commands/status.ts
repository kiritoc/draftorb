import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { resolveRepoRoot } from '../config/paths';
import { formatEtlStatus, getEtlStatus } from '../status';
import { parsePlatform, parsePositionals, type Command } from './shared';

function resolveDbPathReadOnly(): string {
  const chosen = process.env.DRAFTORB_DB_PATH ?? join(resolveRepoRoot(), 'data', 'DraftOrb.sqlite');
  return resolve(chosen);
}

async function runStatus(args: string[]): Promise<void> {
  const [platformArg] = parsePositionals(args, 1, 'status [platform]');
  const platform = platformArg !== undefined ? parsePlatform(platformArg) : undefined;
  const dbPath = resolveDbPathReadOnly();

  if (!existsSync(dbPath)) {
    console.log(`no database at ${dbPath}`);
    return;
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const status = getEtlStatus(db, platform);
    console.log(formatEtlStatus(status));
  } finally {
    db.close();
  }
}

export const statusCommand: Command = {
  name: 'status',
  usage: 'status [platform]',
  description: 'Show migration, player, match, cursor, and reject counts',
  run: runStatus,
};
