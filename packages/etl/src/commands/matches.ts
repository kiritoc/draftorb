import { parseArgs } from 'node:util';

import type { PoolConfig } from '@draftorb/shared';

import { ingestMatches } from '../matches';
import { poolChampionRolePairs, selectPlayers } from '../matches-select';
import { loadPoolConfig } from '../pool-config';
import { resolveDbPath } from '../config/paths';
import { openDb, migrate } from '../db';
import { CliError, UsageError, parseStrictPositiveInt } from '../cli-args';
import { log, parsePlatform, type Command } from './shared';

const USAGE =
  'matches [platform] [--since-patch=16.19] [--per-player=20] [--limit=N] [--queue=420] [--min-duration=900] [--reset] [--reset-tombstones] [--refresh] [--call-budget=N] [--time-budget=MIN] [--dry-run]';

/** Load the pool file for pool-driven prioritization; warn and continue without it. */
function loadPoolConfigOrWarn(): PoolConfig | null {
  try {
    return loadPoolConfig();
  } catch (error) {
    log.info(
      `Warning: pool config ignored (${error instanceof Error ? error.message : String(error)}); ` +
        'selection falls back to rank order.',
    );
    return null;
  }
}

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
        'call-budget': { type: 'string' },
        'time-budget': { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
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
  const callBudget = parseStrictPositiveInt(
    typeof values['call-budget'] === 'string' ? values['call-budget'] : undefined,
    '--call-budget',
  );
  const timeBudgetMinutes = parseStrictPositiveInt(
    typeof values['time-budget'] === 'string' ? values['time-budget'] : undefined,
    '--time-budget',
  );
  const resetValue = values.reset === true;
  const resetTombstonesValue = values['reset-tombstones'] === true;
  const refreshValue = values.refresh === true;
  const dryRun = values['dry-run'] === true;
  if (refreshValue && resetValue) {
    throw new UsageError(
      '--refresh cannot be combined with --reset (reset clears the cursors --refresh selects on).\n' +
        `Usage: etl ${USAGE}`,
    );
  }

  const dbPath = resolveDbPath();
  const db = openDb(dbPath);
  try {
    const poolConfig = loadPoolConfigOrWarn();

    if (dryRun) {
      // Selection preview only: no Riot calls, no patch resolution. The patch
      // window never affects player ordering, so the list is exact.
      migrate(db);
      const selected = selectPlayers(db, platform, {
        reset: resetValue,
        refresh: refreshValue,
        playerLimit,
        poolConfig,
      });
      const pairs = poolChampionRolePairs(poolConfig);
      log.info(
        `Dry run: ${selected.length} player(s) selected for platform "${platform}"` +
          (pairs.size > 0
            ? ` (${pairs.size} pool champion×role pairs from data/pool.config.json)`
            : ' (no pool config)') +
          '.',
      );
      for (const [index, player] of selected.entries()) {
        log.detail(
          `${index + 1}. [${player.poolMatch ? 'pool' : 'rank'}] ${player.puuid} ` +
            `rank_score=${player.rank_score} ${player.done ? 'done' : 'pending'}`,
        );
      }
      return;
    }

    log.info(
      `Ingesting ranked matches for platform "${platform}"` +
        `${sincePatch ? ` (patches >= ${sincePatch})` : ''}...`,
    );
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
      callBudget,
      timeBudgetMs: timeBudgetMinutes !== undefined ? timeBudgetMinutes * 60_000 : undefined,
      poolConfig,
      db,
      onProgress: (message) => log.info(message),
    });

    log.info(
      `Done: ${result.playersProcessed} players processed (${result.playersSkipped} skipped), ` +
        `${result.stored} matches stored, ${result.duplicates} duplicates, ` +
        `${result.filtered} filtered, ${result.invalid} invalid` +
        `${result.playersFailed > 0 ? `, ${result.playersFailed} failed` : ''}.`,
    );
    if (result.budgetExhausted) {
      log.info(
        'Ingestion stopped at the call/time budget; cursors are saved and the run is resumable.',
      );
    }
    if (result.stoppedEarly) {
      // Non-zero exit so scheduled runs (etl.yml) do not publish a partial
      // refresh; completed cursors are still saved by the caller's finally.
      throw new CliError(
        `Ingestion stopped early after 3 consecutive transient failures ` +
          `(${result.playersFailed} players failed). Completed cursors are saved; ` +
          'rerun the command to resume.',
      );
    }
  } finally {
    db.close();
  }
}

export const matchesCommand: Command = {
  name: 'matches',
  usage: USAGE,
  description:
    'Ingest ranked solo matches for discovered players (resumable, Ctrl+C safe). ' +
    '--reset-tombstones clears pruned tombstones: pruned matches become fetchable again. ' +
    '--refresh only processes players that already have an ingest cursor. ' +
    '--dry-run prints the selected players and their pool-priority reason without API calls.',
  run: runMatches,
};
