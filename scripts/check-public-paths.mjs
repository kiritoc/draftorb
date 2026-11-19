#!/usr/bin/env node
/**
 * Public-paths check (BL-008, D-111): `profiles/` directories and SQLite files
 * must never reach a public location.
 *
 * Forbidden: any directory segment named exactly `profiles`, and files named
 * `*.sqlite`, `*.sqlite3`, `*.db`, `*.sqlite-wal`, `*.sqlite-shm` or any of
 * `*.sqlite.gz`, `*.sqlite3.gz`, `*.db.gz`. `data/profiles.config.json` is
 * fine (not a directory).
 *
 * Default mode checks `git ls-files` of --root (the repository itself is
 * public). `--dir DIR` walks a directory tree instead and reports paths
 * relative to DIR; the public aggregates release (BL-004) must run it on its
 * tree. Do not run it on the private state tarball: that one intentionally
 * contains `profiles/` and the SQLite backup.
 *
 * Usage: node scripts/check-public-paths.mjs [--root DIR | --dir DIR]
 */

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SQLITE_FILE = /\.(sqlite3?|db)(\.gz)?$|\.sqlite-(wal|shm)$/;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {string[]} paths
 * @returns {string[]} the forbidden subset, as given
 */
export function findForbiddenPaths(paths) {
  return paths.filter((path) => {
    const segments = path.replace(/\\/g, '/').split('/');
    const base = segments[segments.length - 1];
    return segments.slice(0, -1).includes('profiles') || SQLITE_FILE.test(base);
  });
}

/** @param {string} root */
function gitTrackedFiles(root) {
  const out = execFileSync('git', ['-C', root, 'ls-files', '-z'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return out.split('\0').filter((p) => p.length > 0);
}

/** @param {string} dir @param {string[]} acc */
function walkFiles(dir, acc) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(path, acc);
    else acc.push(path);
  }
}

/** @param {string[]} argv */
export function parseArgs(argv) {
  /** @type {{ root: string, dir: string | null }} */
  const options = { root: repoRoot, dir: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root' && argv[i + 1] !== undefined) options.root = resolve(argv[++i]);
    else if (argv[i] === '--dir' && argv[i + 1] !== undefined) options.dir = resolve(argv[++i]);
    else throw new Error(`Unknown or incomplete argument: ${argv[i]}`);
  }
  return options;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2));
    let paths;
    if (options.dir !== null) {
      const files = [];
      walkFiles(options.dir, files);
      paths = files.map((file) => relative(options.dir, file));
    } else {
      paths = gitTrackedFiles(options.root);
    }
    const findings = findForbiddenPaths(paths);
    if (findings.length > 0) {
      console.error('Public paths check FAILED (profiles/ directories and SQLite files):');
      for (const finding of findings) console.error(`  ${finding}`);
      process.exit(1);
    }
    console.log('Public paths check passed.');
  } catch (error) {
    console.error(`Public paths check error: ${error instanceof Error ? error.message : error}`);
    process.exit(2);
  }
}
