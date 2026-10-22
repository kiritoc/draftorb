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
 *   DRAFTORB_DB_PATH  Overrides the default SQLite path (used by `migrate`).
 */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';

import { importStaticData } from './ddragon';
import { RiotClient, RiotAuthError } from './riot';
import { formatCoverageReport, validateChampionTagsFile } from './tags';
import { openDb, migrate, getMigrationStatus } from './db';

// ---------------------------------------------------------------------------
// Constants & types
// ---------------------------------------------------------------------------

const EXIT = {
  OK: 0,
  FAILURE: 1,
  USAGE: 2,
  AUTH: 3,
} as const;

type Platform = Parameters<RiotClient['getChallengerLeague']>[0];

/**
 * Known Riot platforms. Typed against the client's own `Platform` type, so a typo here
 * is a compile error. Ideally this list is exported by `./riot` and imported here instead.
 */
const PLATFORMS: readonly Platform[] = [
  'br1',
  'eun1',
  'euw1',
  'jp1',
  'kr',
  'la1',
  'la2',
  'na1',
  'oc1',
  'tr1',
  'ru',
];
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
  if (!(PLATFORMS as readonly string[]).includes(value)) {
    throw new UsageError(`Unknown platform "${value}". Expected one of: ${PLATFORMS.join(', ')}`);
  }
  return value as Platform;
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
// Path helpers
// ---------------------------------------------------------------------------

/** Walks up from `start` to the nearest directory containing a package.json. */
function findPackageRoot(start: string = process.cwd()): string {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return start;
    }
    dir = parent;
  }
}

/** Priority: explicit argument > DRAFTORB_DB_PATH > <package root>/data/<default file>. */
function resolveDbPath(explicit?: string): string {
  const chosen =
    explicit ?? process.env[DB_ENV_VAR] ?? join(findPackageRoot(), 'data', DEFAULT_DB_FILENAME);
  const dbPath = resolve(chosen);
  mkdirSync(dirname(dbPath), { recursive: true });
  return dbPath;
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

  log.info(`Imported patch ${result.patch} (Data Dragon version ${result.version}) in ${elapsed}s:`);
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
    name: 'migrate',
    usage: 'migrate [db-path]',
    description: `Create or upgrade SQLite database (default: <package root>/data/${DEFAULT_DB_FILENAME}, or $${DB_ENV_VAR})`,
    run: runMigrate,
  },
];

const PLANNED_COMMANDS: readonly { name: string; description: string }[] = [
  { name: 'players', description: 'Discover players by tier' },
  { name: 'matches', description: 'Ingest matches' },
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
  const width = Math.max(...labels.map((l) => l.length), ...PLANNED_COMMANDS.map((c) => c.name.length));

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