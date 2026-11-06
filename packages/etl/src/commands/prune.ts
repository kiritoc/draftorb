import { parseArgs } from 'node:util';

import { resolveDbPath } from '../config/paths';
import { openDb, migrate } from '../db';
import { UsageError, parseStrictPositiveInt } from '../cli-args';
import { ETL_CONFIG } from '../config/etl-config';
import { pruneMatches } from '../prune';
import { log, type Command } from './shared';

async function runPrune(args: string[]): Promise<void> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        'keep-patches': { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(`${message}\nUsage: etl prune [--keep-patches=N] [--dry-run]`);
  }
  if (parsed.positionals.length > 0) {
    throw new UsageError(
      'Too many positional arguments.\nUsage: etl prune [--keep-patches=N] [--dry-run]',
    );
  }

  const keepPatches = parseStrictPositiveInt(
    typeof parsed.values['keep-patches'] === 'string' ? parsed.values['keep-patches'] : undefined,
    '--keep-patches',
  );
  const dryRun = parsed.values['dry-run'] === true;

  const dbPath = resolveDbPath();
  const db = openDb(dbPath);
  try {
    migrate(db);
    const result = pruneMatches(db, { keepPatches, dryRun });

    if (result.latestPatchIndex === null) {
      log.info('No patches in the patches table; nothing to prune.');
      return;
    }
    if (dryRun) {
      log.info(
        `Dry run: would prune ${result.candidates} match(es) ` +
          `(patch_index <= ${result.cutoffPatchIndex}; keeping ${result.keepPatches} of ` +
          `${result.latestPatchIndex} patches).`,
      );
    } else {
      log.info(
        `Pruned ${result.matchesPruned} match(es) and wrote ${result.tombstonesWritten} ` +
          `tombstone(s) (patch_index <= ${result.cutoffPatchIndex}; keeping ` +
          `${result.keepPatches} of ${result.latestPatchIndex} patches).`,
      );
    }
    if (result.skippedUnknownPatch > 0) {
      log.info(
        `${result.skippedUnknownPatch} match(es) skipped: patch label missing from the patches table.`,
      );
    }
  } finally {
    db.close();
  }
}

export const pruneCommand: Command = {
  name: 'prune',
  usage: `prune [--keep-patches=N] [--dry-run] (default keep: ${ETL_CONFIG.retentionPatches} patches)`,
  description:
    'Delete matches older than the retention window and tombstone them as pruned (D-044)',
  run: runPrune,
};
