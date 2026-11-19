#!/usr/bin/env node
/**
 * State-repo privacy check (BL-007, D-122): the no-leak guarantee for player
 * data rests on the state repository staying private, so its visibility is
 * verified explicitly instead of assumed.
 *
 * Resolves the repo like the ETL does: `--repo owner/name`, then
 * `DRAFTORB_STATE_REPO`, then `draftorb-state` under the `origin` owner.
 * Passes only when `gh repo view` reports `visibility: "PRIVATE"`.
 *
 * Usage: node scripts/check-state-repo-private.mjs [--repo owner/name]
 * Exit codes: 0 private, 1 not private or missing, 2 usage/tooling error.
 */

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_STATE_REPO_NAME = 'draftorb-state';
const STATE_REPO_ENV = 'DRAFTORB_STATE_REPO';

/** @param {string} remoteUrl */
export function parseOriginOwner(remoteUrl) {
  const match = /[:/]([^/\s:]+)\/[^/\s:]+(?:\.git)?\/?$/.exec(remoteUrl.trim());
  return match?.[1];
}

/** @param {string[]} argv */
export function parseArgs(argv) {
  /** @type {{ repo: string | null }} */
  const options = { repo: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--repo' && argv[i + 1] !== undefined) options.repo = argv[++i];
    else throw new Error(`Unknown or incomplete argument: ${argv[i]}`);
  }
  return options;
}

/**
 * @param {{ repo: string | null }} options
 * @param {NodeJS.ProcessEnv} env
 * @param {string | undefined} originOwner
 */
export function resolveStateRepo(options, env = process.env, originOwner) {
  const candidate = options.repo ?? env[STATE_REPO_ENV] ?? DEFAULT_STATE_REPO_NAME;
  if (candidate.includes('/')) return candidate;
  if (!/^[A-Za-z0-9_.-]+$/.test(candidate)) {
    throw new Error(`Invalid state repo name "${candidate}".`);
  }
  if (originOwner === undefined || originOwner === '') {
    throw new Error(
      `Cannot determine the repository owner for state repo "${candidate}". ` +
        'Pass --repo=owner/name or set DRAFTORB_STATE_REPO.',
    );
  }
  return `${originOwner}/${candidate}`;
}

/** @param {string} repoRootDir */
function originOwner(repoRootDir) {
  try {
    const url = execFileSync('git', ['-C', repoRootDir, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return parseOriginOwner(url);
  } catch {
    return undefined;
  }
}

/**
 * @param {string} repo `owner/name`
 * @returns {string} the `visibility` field reported by gh
 */
export function fetchVisibility(repo) {
  const out = execFileSync('gh', ['repo', 'view', repo, '--json', 'visibility'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const parsed = JSON.parse(out);
  if (typeof parsed.visibility !== 'string') {
    throw new Error(`gh repo view ${repo} returned no visibility field.`);
  }
  return parsed.visibility;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const repo = resolveStateRepo(options, process.env, originOwner(repoRoot));
    const visibility = fetchVisibility(repo);
    if (visibility !== 'PRIVATE') {
      console.error(
        `State repo check FAILED: ${repo} visibility is "${visibility}", expected "PRIVATE". ` +
          'Player data must never reach a public repository (D-078, D-122).',
      );
      process.exit(1);
    }
    console.log(`State repo check passed: ${repo} is PRIVATE.`);
  } catch (error) {
    console.error(`State repo check error: ${error instanceof Error ? error.message : error}`);
    process.exit(2);
  }
}
