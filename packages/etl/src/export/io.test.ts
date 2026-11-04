import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleanupStaleExportDirs, createTempDir, publishTempDir, writeFileAtomic } from './io.js';

describe('export IO', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'draftorb-export-io-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('writeFileAtomic replaces the target and leaves no temp file', () => {
    writeFileSync(join(directory, 'latest.json'), 'old', 'utf8');
    const path = writeFileAtomic(directory, 'latest.json', 'new');
    expect(path).toBe(join(directory, 'latest.json'));
    expect(readFileSync(path, 'utf8')).toBe('new');
    expect(readdirSync(directory)).toEqual(['latest.json']);
  });

  it('writeFileAtomic keeps the previous target and cleans up when the rename fails', () => {
    // A non-empty directory at the target path makes the rename fail after the temp write.
    mkdirSync(join(directory, 'latest.json'));
    writeFileSync(join(directory, 'latest.json', 'keep'), 'old', 'utf8');
    expect(() => writeFileAtomic(directory, 'latest.json', 'new')).toThrow();
    expect(readFileSync(join(directory, 'latest.json', 'keep'), 'utf8')).toBe('old');
    expect(readdirSync(directory)).toEqual(['latest.json']);
  });

  it('replaces an existing patch directory and removes its backup', () => {
    const targetDir = join(directory, '16.21');
    const tempDir = join(directory, '.16.21.tmp-next');
    mkdirSync(targetDir);
    mkdirSync(tempDir);
    writeFileSync(join(targetDir, 'old.json'), 'old');
    writeFileSync(join(tempDir, 'new.json'), 'new');

    expect(publishTempDir(tempDir, targetDir)).toBeNull();

    expect(readdirSync(targetDir)).toEqual(['new.json']);
    expect(readFileSync(join(targetDir, 'new.json'), 'utf8')).toBe('new');
    expect(readdirSync(directory).filter((name) => name.startsWith('.16.21.old-'))).toEqual([]);
  });

  it('returns a warning and preserves the backup when cleanup fails after publish', () => {
    const targetDir = join(directory, '16.21');
    const tempDir = join(directory, '.16.21.tmp-next');
    mkdirSync(targetDir);
    mkdirSync(tempDir);
    writeFileSync(join(targetDir, 'old.json'), 'old');
    writeFileSync(join(tempDir, 'new.json'), 'new');

    const warning = publishTempDir(tempDir, targetDir, () => {
      throw new Error('injected cleanup failure');
    });

    expect(warning).toContain('published');
    expect(warning).toContain('injected cleanup failure');
    expect(readFileSync(join(targetDir, 'new.json'), 'utf8')).toBe('new');
    const backupName = readdirSync(directory).find((name) => name.startsWith('.16.21.old-'));
    expect(backupName).toBeDefined();
    if (backupName === undefined) throw new Error('missing preserved backup');
    expect(readFileSync(join(directory, backupName, 'old.json'), 'utf8')).toBe('old');
  });

  it('restores the previous directory when publishing the temp directory fails', () => {
    const targetDir = join(directory, '16.21');
    mkdirSync(targetDir);
    writeFileSync(join(targetDir, 'previous.json'), 'previous');

    expect(() => publishTempDir(join(directory, 'missing-temp'), targetDir)).toThrow();

    expect(readdirSync(targetDir)).toEqual(['previous.json']);
    expect(readFileSync(join(targetDir, 'previous.json'), 'utf8')).toBe('previous');
    expect(readdirSync(directory).filter((name) => name.startsWith('.16.21.old-'))).toEqual([]);
  });

  it('cleans only matching stale temp and backup directories', () => {
    const staleTemp = join(directory, '.16.21.tmp-stale');
    const staleBackup = join(directory, '.16.21.old-stale');
    const otherPatch = join(directory, '.16.22.tmp-keep');
    const targetDir = join(directory, '16.21');
    mkdirSync(staleTemp);
    mkdirSync(staleBackup);
    mkdirSync(otherPatch);
    mkdirSync(targetDir);
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    utimesSync(staleTemp, old, old);
    utimesSync(staleBackup, old, old);

    cleanupStaleExportDirs(directory, '16.21');

    expect(readdirSync(directory).sort()).toEqual(['.16.22.tmp-keep', '16.21'].sort());
  });

  it('preserves stale backups when the patch directory is missing', () => {
    const staleTemp = join(directory, '.16.21.tmp-stale');
    const staleBackup = join(directory, '.16.21.old-recovery');
    mkdirSync(staleTemp);
    mkdirSync(staleBackup);
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    utimesSync(staleTemp, old, old);
    utimesSync(staleBackup, old, old);

    cleanupStaleExportDirs(directory, '16.21');

    expect(readdirSync(directory)).toEqual(['.16.21.old-recovery']);
  });

  it('creates unique temporary directory names', () => {
    const first = createTempDir(directory, '16.21');
    const second = createTempDir(directory, '16.21');

    expect(first).not.toBe(second);
    expect(readdirSync(directory).sort()).toEqual([basename(first), basename(second)].sort());
  });
});
