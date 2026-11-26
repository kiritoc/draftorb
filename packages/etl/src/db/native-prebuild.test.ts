import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

const require = createRequire(import.meta.url);

describe('better-sqlite3 native binding (BL-003)', () => {
  it('loads the shipped prebuilt binary and opens a database', () => {
    // binding.js prefers prebuilds/<platform>-<arch>.node and only falls back
    // to a node-gyp build under build/ when no prebuilt exists. Asserting the
    // prebuild path is non-null proves no compiler toolchain was needed.
    const entry = require.resolve('better-sqlite3');
    const binding = require(path.join(path.dirname(entry), 'binding.js')) as {
      getPrebuildPath(): string | null;
    };
    expect(
      binding.getPrebuildPath(),
      'expected a shipped prebuilt .node binary for this platform',
    ).not.toBeNull();

    const db = new Database(':memory:');
    try {
      db.exec('CREATE TABLE t (a INTEGER)');
      db.prepare('INSERT INTO t VALUES (?)').run(1);
      expect(db.prepare('SELECT a FROM t').get()).toEqual({ a: 1 });
    } finally {
      db.close();
    }
  });
});
