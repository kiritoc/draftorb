import { parseArgs } from 'node:util';

import { ingestMatches } from '../matches';
import { resolveDbPath } from '../config/paths';
import { openDb } from '../db';
import { UsageError, parseStrictPositiveInt } from '../cli-args';
import { log, parsePlatform, type Command } from './shared';

async function runMatches(args: string[]): Promise<void> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        platform: { type: 'string', short: 'p' },
        'since-patch': { type: 'string' },
        'per-player': { type: 'string' },
        limit: { type: 'string' },
        queue: { type: 'string' },
        'min-duration': { type: 'string' },
        reset: { type: 'boolean', default: false },
        'reset-tombstones': { type: 'boolean', default: false },
        refresh: { type: 'boolean', default: false },
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(
      `${message}\nUsage: etl matches [platform] [--since-patch=16.19] [--per-player=20] [--limit=N] [--queue=420] [--min-duration=900] [--reset] [--reset-tombstones] [--refresh]`,
    );
  }
  const { values, positionals } = parsed;
  if (positionals.length > 1) {
    throw new UsageError('Too many positional arguments.\nUsage: etl matches [platform]');
  }

  const [platformArg] = positionals;
  const platform = parsePlatform(
    platformArg ?? (typeof values.platform === 'string' ? values.platform : undefined),
  );
  const sincePatch = typeof values['since-patch'] === 'string' ? values['since-patch'] : undefined;
  if (sincePatch !== undefined && !/^\d+\.\d+$/.test(sincePatch)) {
    throw new UsageError(
      `Invalid --since-patch value "${sincePatch}". Expected a format like "16.19".`,
    );
  }
  const matchesPerPlayer = parseStrictPositiveInt(
    typeof values['per-player'] === 'string' ? values['per-player'] : undefined,
    '--per-player',
  );
  const playerLimit = parseStrictPositiveInt(
    typeof values.limit === 'string' ? values.limit : undefined,
    '--limit',
  );
  const queueId = parseStrictPositiveInt(
    typeof values.queue === 'string' ? values.queue : undefined,
    '--queue',
  );
  const minDurationSeconds = parseStrictPositiveInt(
    typeof values['min-duration'] === 'string' ? values['min-duration'] : undefined,
    '--min-duration',
  );
  const resetValue = values.reset === true;
  const resetTombstonesValue = values['reset-tombstones'] === true;
  const refreshValue = values.refresh === true;
  if (refreshValue && resetValue) {
    throw new UsageError(
      '--refresh cannot be combined with --reset (reset clears the cursors --refresh selects on).\n' +
        'Usage: etl matches [platform] [--since-patch=16.19] [--per-player=20] [--limit=N] [--queue=420] [--min-duration=900] [--reset] [--reset-tombstones] [--refresh]',
    );
  }

  log.info(
    `Ingesting ranked matches for platform "${platform}"` +
      `${sincePatch ? ` (patches >= ${sincePatch})` : ''}...`,
  );
  const dbPath = resolveDbPath();
  const db = openDb(dbPath);
  try {
    const result = await ingestMatches({
      platform,
      sincePatch,
      matchesPerPlayer,
      playerLimit,
      queueId,
      minDurationSeconds,
      reset: resetValue,
      resetTombstones: resetTombstonesValue,
      refresh: refreshValue,
      db,
      onProgress: (message) => log.info(message),
    });

    log.info(
      `Done: ${result.playersProcessed} players processed (${result.playersSkipped} skipped), ` +
        `${result.stored} matches stored, ${result.duplicates} duplicates, ` +
        `${result.filtered} filtered, ${result.invalid} invalid.`,
    );
  } finally {
    db.close();
  }
}

export const matchesCommand: Command = {
  name: 'matches',
  usage:
    'matches [platform] [--since-patch=16.19] [--per-player=20] [--limit=N] [--queue=420] [--min-duration=900] [--reset] [--reset-tombstones] [--refresh]',
  description:
    'Ingest ranked solo matches for discovered players (resumable, Ctrl+C safe). ' +
    '--reset-tombstones clears pruned tombstones: pruned matches become fetchable again. ' +
    '--refresh only processes players that already have an ingest cursor',
  run: runMatches,
};
