import { parseArgs } from 'node:util';

import { runProfileStartersBackfill } from '../profile-starters-backfill';
import { CliError, UsageError, parseStrictPositiveInt } from '../cli-args';
import { log, type Command } from './shared';

const USAGE = 'backfill-profile-starters [profileId] [--limit=N] [--call-budget=N]';

async function runBackfillProfileStarters(args: string[]): Promise<void> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        limit: { type: 'string' },
        'call-budget': { type: 'string' },
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

  const limit = parseStrictPositiveInt(
    typeof values.limit === 'string' ? values.limit : undefined,
    '--limit',
  );
  const callBudget = parseStrictPositiveInt(
    typeof values['call-budget'] === 'string' ? values['call-budget'] : undefined,
    '--call-budget',
  );

  log.info('Backfilling profile starter bundles for stored profile_games...');
  const result = await runProfileStartersBackfill({
    profileId: positionals[0],
    limit,
    callBudget,
    onProgress: (message) => log.info(message),
  });

  log.info(
    `Done: ${result.candidates} candidate game(s), ${result.processed} backfilled, ` +
      `${result.skipped} skipped, ${result.failed} failed` +
      `${result.budgetExhausted ? ', call budget reached' : ''}.`,
  );
  if (result.stoppedEarly) {
    throw new CliError(
      `Backfill stopped early after 3 consecutive transient failures ` +
        `(${result.failed} failed). Rerun the command to resume.`,
    );
  }
}

export const backfillProfileStartersCommand: Command = {
  name: 'backfill-profile-starters',
  usage: USAGE,
  description:
    'Resumable backfill of profile_games.starter_bundle_json (BL-060) from match-v5 ' +
    'detail + timeline for rows left NULL by pre-migration-023 syncs',
  run: runBackfillProfileStarters,
};
