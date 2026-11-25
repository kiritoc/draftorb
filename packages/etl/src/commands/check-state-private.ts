import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

import { CliError, UsageError } from '../cli-args';
import { fetchRepoVisibility, ghReady, parseOriginOwner, resolveStateRepo } from '../state-release';
import { log, type Command } from './shared';

const USAGE = 'check-state-private [--repo=owner/name]';

export interface CheckStatePrivateOptions {
  repo?: string;
}

export function parseCheckStatePrivateArgs(args: string[]): CheckStatePrivateOptions {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: { repo: { type: 'string' } },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(`${message}\nUsage: etl ${USAGE}`);
  }
  const { values } = parsed;
  return { repo: typeof values.repo === 'string' ? values.repo : undefined };
}

/** Fails unless `visibility` is `PRIVATE` (BL-007, D-078, D-122). */
export function assertPrivate(repo: string, visibility: string): void {
  if (visibility !== 'PRIVATE') {
    throw new CliError(
      `State repo check FAILED: ${repo} visibility is "${visibility}", expected "PRIVATE". ` +
        'Player data must never reach a public repository (D-078, D-122).',
    );
  }
}

/** Owner of the `origin` remote, when the checkout has a GitHub remote. */
function originOwner(): string | undefined {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return parseOriginOwner(url);
  } catch {
    return undefined;
  }
}

async function runCheckStatePrivate(args: string[]): Promise<void> {
  const options = parseCheckStatePrivateArgs(args);
  const ready = ghReady();
  if (!ready.ok) {
    throw new CliError(ready.problem ?? 'gh CLI is not ready.');
  }
  const repo = resolveStateRepo(options.repo, process.env, originOwner());
  assertPrivate(repo, fetchRepoVisibility(repo));
  log.info(`State repo check passed: ${repo} is PRIVATE.`);
}

export const checkStatePrivateCommand: Command = {
  name: 'check-state-private',
  usage: USAGE,
  description:
    'Fail unless the state repo (default <origin-owner>/draftorb-state, or --repo / ' +
    'DRAFTORB_STATE_REPO) reports PRIVATE via the gh CLI (BL-007, D-122).',
  run: runCheckStatePrivate,
};
