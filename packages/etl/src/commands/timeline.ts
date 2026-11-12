import { parseArgs } from 'node:util';

import { runTimelinePipeline } from '../timeline';
import { resolveDbPath } from '../config/paths';
import { openDb } from '../db';
import { CliError, UsageError, parseStrictPositiveInt } from '../cli-args';
import { log, parsePlatform, type Command } from './shared';

async function runTimeline(args: string[]): Promise<void> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        platform: { type: 'string', short: 'p' },
        limit: { type: 'string' },
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(`${message}\nUsage: etl timeline [platform] [--limit=N]`);
  }
  const { values, positionals } = parsed;
  if (positionals.length > 1) {
    throw new UsageError('Too many positional arguments.\nUsage: etl timeline [platform]');
  }

  const [platformArg] = positionals;
  const platform = parsePlatform(
    platformArg ?? (typeof values.platform === 'string' ? values.platform : undefined),
  );
  const limit = parseStrictPositiveInt(
    typeof values.limit === 'string' ? values.limit : undefined,
    '--limit',
  );

  log.info(`Fetching match timelines for platform "${platform}"...`);
  const db = openDb(resolveDbPath());
  try {
    const result = await runTimelinePipeline({
      platform,
      limit,
      db,
      onProgress: (message) => log.info(message),
    });

    log.info(
      `Done: ${result.fetched} timelines fetched (${result.events} raw events, ` +
        `${result.extractorsDone} extractor runs), ${result.skipped} skipped, ` +
        `${result.failed} failed.`,
    );
    if (result.stoppedEarly) {
      // Non-zero exit so scheduled runs do not publish a partial refresh;
      // extractor_runs is only set on success so reruns resume.
      throw new CliError(
        `Timeline ingestion stopped early after 3 consecutive transient failures ` +
          `(${result.failed} failed). Rerun the command to resume.`,
      );
    }
  } finally {
    db.close();
  }
}

export const timelineCommand: Command = {
  name: 'timeline',
  usage: 'timeline [platform] [--limit=N]',
  description:
    'Fetch match timelines for stored matches and run raw timeline extractors (resumable, Ctrl+C safe)',
  run: runTimeline,
};
