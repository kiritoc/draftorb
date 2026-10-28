#!/usr/bin/env node
/**
 * CLI entrypoint for DraftOrb ETL operations.
 *
 * Run `pnpm etl help` for the list of commands (generated from the command table below).
 *
 * Exit codes:
 *   0  success
 *   1  runtime failure
 *   2  usage error (unknown command, bad argument, ...)
 *   3  Riot API authentication error
 *
 * Environment:
 *   DRAFTORB_DB_PATH  Overrides the default SQLite path (used by `migrate`, `players` and `matches`).
 */

import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';

import { importStaticData } from './ddragon';
import { resolveDbPath } from './config/paths';
import { openDb, migrate, getMigrationStatus } from './db';
import { ingestMatches } from './matches';
import { discoverPlayersByTier } from './players';
import { PLATFORMS, RiotClient, RiotAuthError, type Platform } from './riot';
import { formatCoverageReport, validateChampionTagsFile } from './tags';

// ---------------------------------------------------------------------------
// Constants & types
// ---------------------------------------------------------------------------

const EXIT = {
  OK: 0,
  FAILURE: 1,
  USAGE: 2,
  AUTH: 3,
} as const;

const DEFAULT_PLATFORM: Platform = 'euw1';

const DB_ENV_VAR = 'DRAFTORB_DB_PATH';
// Kept as-is to avoid orphaning existing databases; centralised so renaming is a one-line change.
const DEFAULT_DB_FILENAME = 'DraftOrb.sqlite';

/** Data Dragon versions look like "14.5.1" (or "14.5"). */
const VERSION_PATTERN = /^\d+\.\d+(\.\d+)?$/;

// ---------------------------------------------------------------------------
// Errors & logging
// ---------------------------------------------------------------------------

class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode: number = EXIT.FAILURE) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

class UsageError extends CliError {
  constructor(message: string) {
    super(message, EXIT.USAGE);
    this.name = 'UsageError';
  }
}

const log = {
  info: (message: string): void => console.log(`[ETL] ${message}`),
  error: (message: string): void => console.error(`[ETL] ${message}`),
  /** Indented / unprefixed detail line. */
  detail: (message: string, ...rest: unknown[]): void => console.log(`  - ${message}`, ...rest),
};

// ---------------------------------------------------------------------------
// Argument helpers
// ---------------------------------------------------------------------------

/**
 * Parses positional arguments with `util.parseArgs` (strict: unknown flags are rejected).
 * Extend `options` here when a command needs flags such as `--limit` or `--dry-run`.
 */
function parsePositionals(args: string[], max: number, usage: string): string[] {
  let positionals: string[];
  try {
    ({ positionals } = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {},
    }));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new UsageError(`${message}\nUsage: ${usage}`);
  }

  if (positionals.length > max) {
    throw new UsageError(
      `Too many arguments (expected at most ${max}, got ${positionals.length}).\nUsage: ${usage}`,
    );
  }
  return positionals;
}

function parsePlatform(value: string | undefined): Platform {
  if (value === undefined) {
    return DEFAULT_PLATFORM;
  }
  const platform = PLATFORMS.find((candidate) => candidate === value);
  if (!platform) {
    throw new UsageError(`Unknown platform "${value}". Expected one of: ${PLATFORMS.join(', ')}`);
  }
  return platform;
}

function parseVersion(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!VERSION_PATTERN.test(value)) {
    throw new UsageError(`Invalid version "${value}". Expected a format like "14.5.1".`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

interface Command {
  name: string;
  aliases?: string[];
  usage: string;
  description: string;
  run: (args: string[]) => Promise<void>;
}

async function runStatic(args: string[]): Promise<void> {
  const [versionArg] = parsePositionals(args, 1, 'static [version]');
  const version = parseVersion(versionArg);

  log.info(`Starting Data Dragon static import${version ? ` (version: ${version})` : ''}...`);
  const startTime = performance.now();
  const result = await importStaticData({ version });
  const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);

  log.info(
    `Imported patch ${result.patch} (Data Dragon version ${result.version}) in ${elapsed}s:`,
  );
  log.detail(`Champions: ${result.championsCount} validated -> ${result.outputPaths.champions}`);
  log.detail(`Items: ${result.itemsCount} validated -> ${result.outputPaths.items}`);
  log.detail(`Rune trees: ${result.runeTreesCount} validated -> ${result.outputPaths.runes}`);
  log.info('Static data import complete.');
}

async function runValidateTags(args: string[]): Promise<void> {
  const [tagsFilePath, championsFilePath] = parsePositionals(
    args,
    2,
    'validate-tags [tags] [champs]',
  );

  log.info('Validating manual champion tags and coverage...');
  const result = await validateChampionTagsFile({ tagsFilePath, championsFilePath });

  console.log(formatCoverageReport(result.coverage));

  if (!result.isValid) {
    const details = result.errors.map((error) => `  - ${error}`).join('\n');
    throw new CliError(`Validation FAILED with ${result.errors.length} error(s):\n${details}`);
  }

  log.info('Champion tags validation PASSED.');
}

async function runCheckKey(args: string[]): Promise<void> {
  const [platformArg] = parsePositionals(args, 1, 'check-key [platform]');
  const platform = parsePlatform(platformArg);

  log.info(`Checking Riot API key against platform "${platform}"...`);
  const client = new RiotClient();
  const challenger = await client.getChallengerLeague(platform);

  log.info(
    `Riot API key is valid! Successfully reached ${platform} Challenger league ("${challenger.name}").`,
  );
  log.detail(`Entries: ${challenger.entries.length} players found`);
  log.detail('Active App Limits:', client.getRateLimiter().getAppLimits());
}

async function runPlayers(args: string[]): Promise<void> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        platform: { type: 'string', short: 'p' },
        tiers: { type: 'string' },
        quota: { type: 'string' },
        reset: { type: 'boolean', default: false },
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(
      `${message}\nUsage: etl players [platform] [--tiers=EMERALD,DIAMOND,...] [--quota=EMERALD:250,...]`,
    );
  }
  const { values, positionals } = parsed;
  if (positionals.length > 1) {
    throw new UsageError('Too many positional arguments.\nUsage: etl players [platform]');
  }

  const [platformArg] = positionals;
  const platformValue = typeof values.platform === 'string' ? values.platform : undefined;
  const tiersValue = typeof values.tiers === 'string' ? values.tiers : undefined;
  const quotaValue = typeof values.quota === 'string' ? values.quota : undefined;
  const resetValue = values.reset === true;
  const platform = parsePlatform(platformArg ?? platformValue);
  const tiers = tiersValue
    ? tiersValue
        .split(',')
        .map((tier: string) => tier.trim())
        .filter((tier: string) => tier.length > 0)
    : undefined;
  const quotas =
    quotaValue === undefined
      ? undefined
      : Object.fromEntries(
          quotaValue
            .split(',')
            .map((rawPair) => rawPair.trim())
            .map((pair) => {
              const [tier, limit, extra] = pair.split(':');
              if (!tier || limit === undefined || extra !== undefined || !/^\d+$/.test(limit)) {
                throw new UsageError(
                  `Invalid quota entry "${pair}". Expected a nonnegative integer in a format like "EMERALD:200,DIAMOND:200".`,
                );
              }
              const quota = Number(limit);
              if (!Number.isSafeInteger(quota)) {
                throw new UsageError(
                  `Invalid quota entry "${pair}". Quotas must be safe nonnegative integers.`,
                );
              }
              return [tier.toUpperCase(), quota];
            }),
        );

  log.info(`Discovering players for platform "${platform}"...`);
  const dbPath = resolveDbPath();
  const db = openDb(dbPath);
  try {
    const result = await discoverPlayersByTier({
      platform,
      tiers,
      quotas,
      db,
      reset: resetValue,
    });

    log.info(`Discovered ${result.totalStored} players across ${result.tierResults.length} tiers.`);
    for (const tierResult of result.tierResults) {
      log.detail(
        `${tierResult.tier}: ${tierResult.stored} stored (${tierResult.fetched} fetched, status=${tierResult.status})`,
      );
    }
  } finally {
    db.close();
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
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(
      `${message}\nUsage: etl matches [platform] [--since-patch=16.19] [--per-player=20] [--limit=N] [--queue=420] [--min-duration=900] [--reset]`,
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
  const parsePositiveInt = (value: unknown, flag: string): number | undefined => {
    if (value === undefined) return undefined;
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new UsageError(`Invalid ${flag} "${String(value)}". Expected a positive integer.`);
    }
    return parsed;
  };
  const matchesPerPlayer = parsePositiveInt(values['per-player'], '--per-player');
  const playerLimit = parsePositiveInt(values.limit, '--limit');
  const queueId = parsePositiveInt(values.queue, '--queue');
  const minDurationSeconds = parsePositiveInt(values['min-duration'], '--min-duration');
  const resetValue = values.reset === true;

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

async function runMigrate(args: string[]): Promise<void> {
  const [dbPathArg] = parsePositionals(args, 1, 'migrate [db-path]');
  const dbPath = resolveDbPath(dbPathArg);

  log.info(`Running database migrations on "${dbPath}"...`);

  const db = openDb(dbPath);
  try {
    const statusBefore = getMigrationStatus(db);
    log.info(`Before: ${statusBefore.applied} applied, ${statusBefore.pending} pending`);

    const applied = migrate(db);
    const statusAfter = getMigrationStatus(db);

    if (applied.length === 0) {
      log.info('No new migrations to apply.');
    } else {
      log.info(`Applied ${applied.length} migration(s): ${applied.join(', ')}`);
    }

    log.info(`After: ${statusAfter.applied} applied, ${statusAfter.pending} pending`);
  } finally {
    db.close();
  }
  log.info('Migration complete.');
}

const COMMANDS: readonly Command[] = [
  {
    name: 'static',
    usage: 'static [version]',
    description: 'Download latest (or specified) champions, items, runes from Data Dragon',
    run: runStatic,
  },
  {
    name: 'validate-tags',
    aliases: ['tags:validate'],
    usage: 'validate-tags [tags] [champs]',
    description:
      'Validate manual champion tags and report coverage (both paths optional, module defaults apply)',
    run: runValidateTags,
  },
  {
    name: 'check-key',
    aliases: ['riot:check'],
    usage: 'check-key [platform]',
    description: `Test Riot API key connectivity (default platform: ${DEFAULT_PLATFORM})`,
    run: runCheckKey,
  },
  {
    name: 'players',
    usage: 'players [platform] [--tiers=EMERALD,DIAMOND,...] [--quota=EMERALD:250,...]',
    description: 'Discover players by tier and persist their rank data into SQLite',
    run: runPlayers,
  },
  {
    name: 'matches',
    usage:
      'matches [platform] [--since-patch=16.19] [--per-player=20] [--limit=N] [--queue=420] [--min-duration=900] [--reset]',
    description: 'Ingest ranked solo matches for discovered players (resumable, Ctrl+C safe)',
    run: runMatches,
  },
  {
    name: 'migrate',
    usage: 'migrate [db-path]',
    description: `Create or upgrade SQLite database (default: <repo root>/data/${DEFAULT_DB_FILENAME}, or $${DB_ENV_VAR})`,
    run: runMigrate,
  },
];

const PLANNED_COMMANDS: readonly { name: string; description: string }[] = [
  { name: 'aggregate', description: 'Compute aggregated tables' },
  { name: 'export', description: 'Write versioned JSON and manifest' },
  { name: 'status', description: 'Show counts and progress' },
];

function findCommand(name: string): Command | undefined {
  return COMMANDS.find((c) => c.name === name || c.aliases?.includes(name));
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function formatHelp(): string {
  const labelOf = (c: Command): string =>
    c.aliases?.length ? `${c.usage} (alias: ${c.aliases.join(', ')})` : c.usage;

  const labels = [...COMMANDS.map(labelOf), 'help'];
  const width = Math.max(
    ...labels.map((l) => l.length),
    ...PLANNED_COMMANDS.map((c) => c.name.length),
  );

  const lines = [
    'DraftOrb ETL CLI',
    '',
    'Commands:',
    ...COMMANDS.map((c) => `  ${labelOf(c).padEnd(width)}  ${c.description}`),
    `  ${'help'.padEnd(width)}  Show this help message`,
    '',
    'Target state commands (in development):',
    ...PLANNED_COMMANDS.map((c) => `  ${c.name.padEnd(width)}  ${c.description}`),
    '',
    'Run "<command> --help" for a command usage line.',
    `Exit codes: ${EXIT.OK} ok, ${EXIT.FAILURE} failure, ${EXIT.USAGE} usage error, ${EXIT.AUTH} Riot auth error.`,
  ];
  return lines.join('\n');
}

const isHelpFlag = (arg: string | undefined): boolean =>
  arg === 'help' || arg === '--help' || arg === '-h';

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

async function main(argv: string[]): Promise<void> {
  const [commandName, ...rest] = argv;

  if (!commandName || isHelpFlag(commandName)) {
    console.log(formatHelp());
    return;
  }

  const command = findCommand(commandName);
  if (!command) {
    throw new UsageError(`Unknown command: "${commandName}"\n\n${formatHelp()}`);
  }

  if (rest.some(isHelpFlag)) {
    console.log(`Usage: ${command.usage}\n${command.description}`);
    return;
  }

  await command.run(rest);
}

/** Single place where errors are turned into messages and exit codes (no process.exit elsewhere). */
function handleError(err: unknown): void {
  if (err instanceof RiotAuthError) {
    log.error(`Authentication error: ${err.message}`);
    process.exitCode = EXIT.AUTH;
  } else if (err instanceof CliError) {
    log.error(err.message);
    process.exitCode = err.exitCode;
  } else {
    log.error(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = EXIT.FAILURE;
  }
}

main(process.argv.slice(2)).catch(handleError);
