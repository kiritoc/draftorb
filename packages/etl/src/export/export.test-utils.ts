import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach } from 'vitest';

import { openDb, migrate } from '../db';
import { exportJson, type ExportOptions, type ExportResult } from './index';

const PATCH = '16.21';
const FIXED_NOW = new Date('2026-11-02T21:00:00Z');

interface Context {
  directory: string;
  publicDir: string;
  db: Database.Database;
}

export interface ExportTestSuite {
  readonly db: Database.Database;
  readonly directory: string;
  readonly publicDir: string;
  readFile<T>(relativePath: string): T;
  exportOnce(options?: ExportOptions): ExportResult;
}

export function createExportTestSuite(): ExportTestSuite {
  let context: Context | undefined;

  beforeEach(() => {
    const directory = mkdtempSync(join(tmpdir(), 'draftorb-export-'));
    const db = openDb(join(directory, 'test.sqlite'));
    migrate(db);
    context = { directory, publicDir: join(directory, 'public'), db };
  });

  afterEach(() => {
    if (context === undefined) return;
    context.db.close();
    rmSync(context.directory, { recursive: true, force: true });
    context = undefined;
  });

  const active = (): Context => {
    if (context === undefined) throw new Error('Export test context is not initialized');
    return context;
  };

  return {
    get db() {
      return active().db;
    },
    get directory() {
      return active().directory;
    },
    get publicDir() {
      return active().publicDir;
    },
    readFile<T>(relativePath: string): T {
      return JSON.parse(readFileSync(join(active().publicDir, PATCH, relativePath), 'utf8')) as T;
    },
    exportOnce(options: ExportOptions = {}): ExportResult {
      const current = active();
      return exportJson(current.db, {
        patch: PATCH,
        publicDir: current.publicDir,
        now: () => FIXED_NOW,
        ...options,
      });
    },
  };
}

export { FIXED_NOW, PATCH };
