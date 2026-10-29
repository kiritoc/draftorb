import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { UsageError } from '../cli-args';
import { migrate, openDb } from '../db';
import { statusCommand } from './status';

async function withTemporaryDb(
  run: (dbPath: string) => Promise<void>,
  createDb = false,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'draftorb-status-cmd-'));
  const dbPath = join(directory, 'test.sqlite');
  const originalDbPath = process.env.DRAFTORB_DB_PATH;
  process.env.DRAFTORB_DB_PATH = dbPath;

  if (createDb) {
    const db = openDb(dbPath);
    migrate(db);
    db.close();
  }

  try {
    await run(dbPath);
  } finally {
    if (originalDbPath === undefined) {
      delete process.env.DRAFTORB_DB_PATH;
    } else {
      process.env.DRAFTORB_DB_PATH = originalDbPath;
    }
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('statusCommand', () => {
  it('prints "no database at <path>" and exits 0 when database file does not exist', async () => {
    await withTemporaryDb(async (dbPath) => {
      const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await statusCommand.run([]);
        expect(consoleLog).toHaveBeenCalledWith(`no database at ${dbPath}`);
      } finally {
        consoleLog.mockRestore();
      }
    }, false);
  });

  it('does not create parent directory when database path does not exist', async () => {
    const parentDir = join(tmpdir(), `draftorb-status-nonexistent-${Date.now()}`);
    const nonExistentDb = join(parentDir, 'sub', 'test.sqlite');
    process.env.DRAFTORB_DB_PATH = nonExistentDb;
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await statusCommand.run([]);
      expect(existsSync(parentDir)).toBe(false);
    } finally {
      consoleLog.mockRestore();
      delete process.env.DRAFTORB_DB_PATH;
    }
  });

  it('does not write tables to an unmigrated existing database file', async () => {
    await withTemporaryDb(async (dbPath) => {
      // Create empty sqlite file by opening and immediately closing without WAL/migrate
      openDb(dbPath).close();
      const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await statusCommand.run([]);
        const db = openDb(dbPath);
        const tables = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'")
          .all();
        db.close();
        expect(tables).toHaveLength(0);
      } finally {
        consoleLog.mockRestore();
      }
    }, false);
  });

  it('prints formatted status when database file exists', async () => {
    await withTemporaryDb(async () => {
      const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await statusCommand.run([]);
        expect(consoleLog).toHaveBeenCalled();
        const output = consoleLog.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(output).toContain('Migrations:');
        expect(output).toContain('Players: 0');
        expect(output).toContain('Matches: 0');
        expect(output).toContain('Participants: 0');
        expect(output).toContain('Match cursors: 0');
        expect(output).toContain('Rejects (global): 0');
      } finally {
        consoleLog.mockRestore();
      }
    }, true);
  });

  it('accepts a platform positional argument', async () => {
    await withTemporaryDb(async () => {
      const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await statusCommand.run(['euw1']);
        expect(consoleLog).toHaveBeenCalled();
        const output = consoleLog.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(output).toContain('Migrations:');
      } finally {
        consoleLog.mockRestore();
      }
    }, true);
  });

  it('rejects unknown platform argument with UsageError', async () => {
    await withTemporaryDb(async () => {
      await expect(statusCommand.run(['invalid-platform'])).rejects.toThrow(UsageError);
    }, true);
  });
});
