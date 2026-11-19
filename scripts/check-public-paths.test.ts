/**
 * Public-paths check tests (BL-008, D-111): `profiles/` directories and SQLite
 * files must never be tracked in the public repository or shipped in a public tree.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { findForbiddenPaths } from './check-public-paths.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(repoRoot, 'scripts', 'check-public-paths.mjs');

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'check-public-paths-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function touch(root: string, ...parts: string[]): void {
  mkdirSync(join(root, ...parts.slice(0, -1)), { recursive: true });
  writeFileSync(join(root, ...parts), 'x');
}

describe('findForbiddenPaths', () => {
  it.each([
    'data/public/profiles/x.json',
    'profiles/index.json',
    'data\\public\\profiles\\x.json',
    'data/DraftOrb.sqlite',
    'a/b.sqlite3',
    'a/b.db',
    'a/b.sqlite-wal',
    'a/b.sqlite-shm',
    'DraftOrb.sqlite.gz',
    'a/b.sqlite3.gz',
    'a/b.db.gz',
  ])('flags %s', (path) => {
    expect(findForbiddenPaths([path])).toEqual([path]);
  });

  it.each([
    'data/profiles.config.json',
    'docs/x.md',
    'data/public/16.21/manifest.json',
    'docs\\x.md',
    'src/profiles.ts',
    'a/db.json',
  ])('allows %s', (path) => {
    expect(findForbiddenPaths([path])).toEqual([]);
  });
});

describe('check-public-paths CLI', () => {
  const run = (args: string[]) => spawnSync('node', [script, ...args], { encoding: 'utf8' });

  it('--dir fails on a planted profiles/ file and a SQLite archive, relative to DIR', () => {
    const dir = tempDir();
    touch(dir, 'profiles', 'a.json');
    touch(dir, 'x.sqlite.gz');
    touch(dir, '16.21', 'manifest.json');
    const result = run(['--dir', dir]);
    expect(result.status).toBe(1);
    const err = result.stderr.replace(/\\/g, '/');
    expect(err).toContain('profiles/a.json');
    expect(err).toContain('x.sqlite.gz');
    expect(err).not.toContain('manifest.json');
    expect(err).not.toContain(dir.replace(/\\/g, '/'));
  });

  it('--dir passes on a clean tree', () => {
    const dir = tempDir();
    touch(dir, '16.21', 'manifest.json');
    expect(run(['--dir', dir]).status).toBe(0);
  });

  it('passes on the real repository', () => {
    const result = run(['--root', repoRoot]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('passed');
  });

  it('exits 2 on an unknown argument', () => {
    expect(run(['--bogus']).status).toBe(2);
  });
});
