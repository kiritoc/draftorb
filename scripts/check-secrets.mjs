#!/usr/bin/env node
/**
 * Secret-leak check (T-092, TESTING.md).
 *
 * Fails when a Riot API key shows up in files that can reach the repository
 * or the deployed site:
 *   - `RGAPI-` followed by 16+ consecutive alphanumerics (real keys are long
 *     unbroken tokens; the repo's placeholders and test fixtures use short
 *     runs or dashes, e.g. `RGAPI-xxxx-...`, `RGAPI-test-api-key-12345`),
 *   - the literal value of $RIOT_API_KEY when the variable is set.
 *
 * Scans `git ls-files` (committed files; falls back to a recursive walk when
 * the root is not a git checkout, e.g. tests), `data/public` when it exists
 * (gitignored generated exports, T-110/D-079 — packed into the state release)
 * and `apps/web/dist` when it exists. Matches are reported as
 * `path: <needle name>` — the secret value itself is never printed.
 *
 * Usage: node scripts/check-secrets.mjs [--root DIR] [--dist DIR|off]
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RIOT_KEY_PATTERN = /RGAPI-[A-Za-z0-9]{16,}/;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.turbo', 'coverage']);

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string[]} argv @param {string} root */
export function parseArgs(argv, root = repoRoot) {
  /** @type {{ root: string, dist: string | null }} */
  const options = { root, dist: null };
  let distOverride;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root') options.root = resolve(argv[++i]);
    else if (argv[i] === '--dist') distOverride = argv[++i];
    else {
      throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  options.dist =
    distOverride === undefined
      ? join(options.root, 'apps', 'web', 'dist')
      : distOverride === 'off'
        ? null
        : resolve(distOverride);
  return options;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ name: string, test: (text: string) => boolean }[]}
 */
export function secretNeedles(env = process.env) {
  /** @type {{ name: string, test: (text: string) => boolean }[]} */
  const needles = [{ name: 'RGAPI- key pattern', test: (text) => RIOT_KEY_PATTERN.test(text) }];
  const key = env.RIOT_API_KEY;
  if (typeof key === 'string' && key.length >= 8) {
    needles.push({ name: 'RIOT_API_KEY value', test: (text) => text.includes(key) });
  }
  return needles;
}

/** @param {string} root */
function gitTrackedFiles(root) {
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files', '-z'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\0').filter((p) => p.length > 0);
  } catch {
    return null;
  }
}

/** @param {string} dir @param {string[]} acc */
function walkFiles(dir, acc) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walkFiles(path, acc);
    } else if (entry.isFile()) {
      acc.push(path);
    }
  }
}

/**
 * @param {string} root
 * @param {string | null} distDir
 * @returns {string[]} absolute file paths to scan
 */
export function collectFiles(root, distDir) {
  const files = new Set();
  const tracked = gitTrackedFiles(root);
  if (tracked !== null) {
    for (const rel of tracked) files.add(join(root, rel));
  } else {
    const walked = [];
    walkFiles(root, walked);
    for (const file of walked) files.add(file);
  }
  // data/public is gitignored (D-079) so git ls-files never lists it; walk it
  // explicitly so generated exports are scanned before they are packed into
  // the state release (T-110). The Set dedupes the non-git fallback walk.
  const publicDataDir = join(root, 'data', 'public');
  if (existsSync(publicDataDir)) {
    const walked = [];
    walkFiles(publicDataDir, walked);
    for (const file of walked) files.add(file);
  }
  if (distDir !== null && existsSync(distDir)) {
    const walked = [];
    walkFiles(distDir, walked);
    for (const file of walked) files.add(file);
  }
  return [...files];
}

function isProbablyBinary(path) {
  try {
    const buf = readFileSync(path);
    if (buf.length > MAX_FILE_BYTES) return true;
    return buf.subarray(0, 8192).includes(0);
  } catch {
    return true;
  }
}

/**
 * @param {string} root
 * @param {string | null} distDir
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]} human-readable findings (never containing secret values)
 */
export function findSecretLeaks(root, distDir, env = process.env) {
  const needles = secretNeedles(env);
  const findings = [];
  for (const file of collectFiles(root, distDir)) {
    if (!existsSync(file) || !statSync(file).isFile() || isProbablyBinary(file)) continue;
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const needle of needles) {
      if (needle.test(text)) {
        findings.push(`${relative(root, file) || file}: contains ${needle.name}`);
      }
    }
  }
  return findings;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const findings = findSecretLeaks(options.root, options.dist);
    if (findings.length > 0) {
      console.error('Secret leak check FAILED:');
      for (const finding of findings) console.error(`  ${finding}`);
      process.exit(1);
    }
    console.log('Secret leak check passed.');
  } catch (error) {
    console.error(`Secret leak check error: ${error instanceof Error ? error.message : error}`);
    process.exit(2);
  }
}
