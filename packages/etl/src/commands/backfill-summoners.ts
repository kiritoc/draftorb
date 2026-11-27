import { parseArgs } from 'node:util';

import { runSummonerBackfill } from '../summoners-backfill';
import { resolveDbPath } from '../config/paths';
import { openDb } from '../db';
import { CliError, UsageError, parseStrictPositiveInt } from '../cli-args';
import { log, parsePlatform, type Command } from './shared';

async function runBackfillSummoners(args: string[]): Promise<void> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        platform: { type: 'string', short: 'p' },
        limit: { type: 'string' },
        'call-budget': { type: 'string' },
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(
      `${message}\nUsage: etl backfill-summoners [platform] [--limit=N] [--call-budget=N]`,
    );
  }
  const { values, positionals } = parsed;
  if (positionals.length > 1) {
    throw new UsageError(
      'Too many positional arguments.\nUsage: etl backfill-summoners [platform]',
    );
  }

  const [platformArg] = positionals;
  const platform = parsePlatform(
    platformArg ?? (typeof values.platform === 'string' ? values.platform : undefined),
  );
  const limit = parseStrictPositiveInt(
    typeof values.limit === 'string' ? values.limit : undefined,
    '--limit',
  );
  const callBudget = parseStrictPositiveInt(
    typeof values['call-budget'] === 'string' ? values['call-budget'] : undefined,
    '--call-budget',
  );

  log.info(`Backfilling summoner spell ids for platform "${platform}"...`);
  const db = openDb(resolveDbPath());
  try {
    const result = await runSummonerBackfill({
      platform,
      limit,
      callBudget,
      db,
      onProgress: (message) => log.info(message),
    });

    log.info(
      `Done: ${result.fetched} matches backfilled, ${result.updated} participant row(s) ` +
        `updated, ${result.skipped} skipped, ${result.failed} failed` +
        `${result.budgetExhausted ? ', call budget reached' : ''}.`,
    );
    if (result.stoppedEarly) {
      throw new CliError(
        `Backfill stopped early after 3 consecutive transient failures ` +
          `(${result.failed} failed). Rerun the command to resume.`,
      );
    }
  } finally {
    db.close();
  }
}

export const backfillSummonersCommand: Command = {
  name: 'backfill-summoners',
  usage: 'backfill-summoners [platform] [--limit=N] [--call-budget=N]',
  description:
    'Resumable backfill of participants.summoner1_id/summoner2_id from match-v5 match details',
  run: runBackfillSummoners,
};
