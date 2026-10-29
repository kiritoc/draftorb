import { parseArgs } from 'node:util';

import { PLATFORMS, type Platform } from '../riot';
import { EXIT, UsageError } from '../cli-args';

export const DEFAULT_PLATFORM: Platform = 'euw1';
export const DB_ENV_VAR = 'DRAFTORB_DB_PATH';
// Kept as-is to avoid orphaning existing databases; centralised so renaming is a one-line change.
export const DEFAULT_DB_FILENAME = 'DraftOrb.sqlite';

/** Data Dragon versions look like "14.5.1" (or "14.5"). */
const VERSION_PATTERN = /^\d+\.\d+(\.\d+)?$/;

export const log = {
  info: (message: string): void => console.log(`[ETL] ${message}`),
  error: (message: string): void => console.error(`[ETL] ${message}`),
  /** Indented / unprefixed detail line. */
  detail: (message: string, ...rest: unknown[]): void => console.log(`  - ${message}`, ...rest),
};

export interface Command {
  name: string;
  aliases?: string[];
  usage: string;
  description: string;
  run: (args: string[]) => Promise<void>;
}

/**
 * Parses positional arguments with `util.parseArgs` (strict: unknown flags are rejected).
 * Extend `options` here when a command needs flags such as `--limit` or `--dry-run`.
 */
export function parsePositionals(args: string[], max: number, usage: string): string[] {
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

/**
 * Resolves a Riot platform from a CLI argument, falling back to the default.
 * Throws a `UsageError` for an unknown platform.
 */
export function parsePlatform(value: string | undefined): Platform {
  if (value === undefined) {
    return DEFAULT_PLATFORM;
  }
  const platform = PLATFORMS.find((candidate) => candidate === value);
  if (!platform) {
    throw new UsageError(`Unknown platform "${value}". Expected one of: ${PLATFORMS.join(', ')}`);
  }
  return platform;
}

/**
 * Validates a Data Dragon version string (e.g. "14.5.1" or "14.5"); returns
 * `undefined` when no version is supplied. Throws a `UsageError` on a bad format.
 */
export function parseVersion(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!VERSION_PATTERN.test(value)) {
    throw new UsageError(`Invalid version "${value}". Expected a format like "14.5.1".`);
  }
  return value;
}

export const PLANNED_COMMANDS = [
  { name: 'aggregate', description: 'Compute aggregated tables' },
  { name: 'export', description: 'Write versioned JSON and manifest' },
  { name: 'status', description: 'Show counts and progress' },
] as const;

export function findCommand(commands: readonly Command[], name: string): Command | undefined {
  return commands.find((c) => c.name === name || c.aliases?.includes(name));
}

/**
 * Formats the CLI help text for the given command table.
 */
export function formatHelp(commands: readonly Command[]): string {
  const labelOf = (c: Command): string =>
    c.aliases?.length ? `${c.usage} (alias: ${c.aliases.join(', ')})` : c.usage;

  const labels = [...commands.map(labelOf), 'help'];
  const width = Math.max(
    ...labels.map((l) => l.length),
    ...PLANNED_COMMANDS.map((c) => c.name.length),
  );

  const lines = [
    'DraftOrb ETL CLI',
    '',
    'Commands:',
    ...commands.map((c) => `  ${labelOf(c).padEnd(width)}  ${c.description}`),
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

export const isHelpFlag = (arg: string | undefined): boolean =>
  arg === 'help' || arg === '--help' || arg === '-h';
