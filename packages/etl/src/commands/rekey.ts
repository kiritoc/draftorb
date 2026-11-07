import { parseArgs } from 'node:util';

import { resolveDbPath } from '../config/paths';
import { openDb, migrate } from '../db';
import { RiotClient } from '../riot';
import { UsageError, parseStrictPositiveInt } from '../cli-args';
import { rekeyPuuids } from '../rekey';
import { log, parsePlatform, type Command } from './shared';

async function runRekey(args: string[]): Promise<void> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        platform: { type: 'string', short: 'p' },
        'dry-run': { type: 'boolean', default: false },
        limit: { type: 'string' },
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(`${message}\nUsage: etl rekey [platform] [--dry-run] [--limit=N]`);
  }
  if (parsed.positionals.length > 1) {
    throw new UsageError('Too many positional arguments.\nUsage: etl rekey [platform]');
  }

  const platformArg = parsed.positionals[0];
  const platformOption =
    typeof parsed.values.platform === 'string' ? parsed.values.platform : undefined;
  const platform = parsePlatform(platformArg ?? platformOption);
  const platformFilter = platformArg !== undefined || platformOption !== undefined;
  const dryRun = parsed.values['dry-run'] === true;
  const limit = parseStrictPositiveInt(
    typeof parsed.values.limit === 'string' ? parsed.values.limit : undefined,
    '--limit',
  );

  const dbPath = resolveDbPath();
  const db = openDb(dbPath);
  try {
    migrate(db);
    const client = new RiotClient({ logWarnings: false });
    log.info(
      `Re-keying PUUIDs${platformFilter ? ` for platform "${platform}"` : ''}` +
        `${dryRun ? ' (dry run)' : ''}...`,
    );
    const stats = await rekeyPuuids(db, client, {
      platform: platformFilter ? platform : undefined,
      dryRun,
      limit,
      log: (message) => log.info(message),
    });
    if (stats.matchesFailed > 0) {
      log.info(
        `${stats.matchesFailed} match(es) could not be scanned; their participants keep ` +
          'the old puuids. Re-run `etl rekey` to retry them.',
      );
    }
    if (stats.staleParticipants > 0) {
      log.info(
        `${stats.staleParticipants} distinct participant puuid(s) remain stale ` +
          '(not referenced by any scanned match).',
      );
    }
  } finally {
    db.close();
  }
}

export const rekeyCommand: Command = {
  name: 'rekey',
  usage: 'rekey [platform] [--dry-run] [--limit=N]',
  description:
    'Rewrite stored PUUIDs to the current API key encryption by re-fetching matches (use after changing RIOT_API_KEY)',
  run: runRekey,
};
