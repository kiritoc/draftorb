#!/usr/bin/env node
/**
 * CLI entrypoint for DraftOrb ETL operations.
 *
 * Run `pnpm etl help` for the list of commands (generated from the command table
 * assembled below from ./commands/*).
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
import { RiotAuthError } from './riot';
import { CliError, EXIT, UsageError } from './cli-args';
import { staticCommand } from './commands/static';
import { validateTagsCommand } from './commands/validate-tags';
import { checkKeyCommand } from './commands/check-key';
import { playersCommand } from './commands/players';
import { matchesCommand } from './commands/matches';
import { migrateCommand } from './commands/migrate';
import { aggregateCommand } from './commands/aggregate';
import { statusCommand } from './commands/status';
import { log, type Command, findCommand, formatHelp, isHelpFlag } from './commands/shared';

const COMMANDS: readonly Command[] = [
  staticCommand,
  validateTagsCommand,
  checkKeyCommand,
  playersCommand,
  matchesCommand,
  migrateCommand,
  aggregateCommand,
  statusCommand,
];

async function main(argv: string[]): Promise<void> {
  const [commandName, ...rest] = argv;

  if (!commandName || isHelpFlag(commandName)) {
    console.log(formatHelp(COMMANDS));
    return;
  }

  const command = findCommand(COMMANDS, commandName);
  if (!command) {
    throw new UsageError(`Unknown command: "${commandName}"\n\n${formatHelp(COMMANDS)}`);
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
