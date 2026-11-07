import { parseArgs } from 'node:util';

import { syncProfiles } from '../profile-sync';
import { UsageError, parseStrictPositiveInt } from '../cli-args';
import { log, type Command } from './shared';

const USAGE = 'profile-sync [profileId] [--publish] [--limit=N] [--config=path]';

async function runProfileSync(args: string[]): Promise<void> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        publish: { type: 'boolean', default: false },
        limit: { type: 'string' },
        config: { type: 'string' },
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(`${message}\nUsage: etl ${USAGE}`);
  }
  const { values, positionals } = parsed;
  if (positionals.length > 1) {
    throw new UsageError(`Too many positional arguments.\nUsage: etl ${USAGE}`);
  }

  const maxGames = parseStrictPositiveInt(
    typeof values.limit === 'string' ? values.limit : undefined,
    '--limit',
  );
  const result = await syncProfiles({
    profileId: positionals[0],
    publish: values.publish === true,
    maxGames,
    configPath: typeof values.config === 'string' ? values.config : undefined,
    onProgress: (message) => log.info(message),
  });

  for (const profile of result.profiles) {
    log.detail(
      `${profile.id}: ${profile.status} — stored=${profile.stored} dup=${profile.duplicates} ` +
        `filtered=${profile.filtered} invalid=${profile.invalid} mastery=${profile.mastery}` +
        (profile.error ? ` error=${profile.error}` : ''),
    );
  }
  log.info(
    `Done: ${result.profiles.length} profile(s), ${result.written.length} file(s) written` +
      `${values.publish === true ? ' to data/public/profiles' : ' (local, gitignored — pass --publish for data/public/profiles)'}.`,
  );
}

export const profileSyncCommand: Command = {
  name: 'profile-sync',
  usage: USAGE,
  description:
    'Sync configured profiles (data/profiles.config.json) from Riot and export anonymized JSON ' +
    '(D-068/D-069). --publish writes data/public/profiles; without it the export stays local/gitignored.',
  run: runProfileSync,
};
