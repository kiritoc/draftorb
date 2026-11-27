/**
 * Tests for `gunzipFile` (B-083): the streaming gunzip used by
 * `etl pull --db`. The real asset decompresses to ~5.6 GB, past the Buffer
 * length limit, so these tests exercise the streaming path with a real
 * SQLite fixture plus a multi-chunk payload.
 */

import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

import { gunzipFile } from './gunzip-file';

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'draftorb-gunzip-test-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function partialFiles(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.includes('.partial-'));
}

describe('gunzipFile', () => {
  it('restores a gzipped SQLite database that better-sqlite3 can open', async () => {
    const dir = tempDir();
    const dbPath = join(dir, 'source.sqlite');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE players (puuid TEXT PRIMARY KEY, tier TEXT)');
    db.prepare('INSERT INTO players (puuid, tier) VALUES (?, ?)').run('p-1', 'DIAMOND');
    db.close();

    const gzPath = join(dir, 'DraftOrb.sqlite.gz');
    writeFileSync(gzPath, gzipSync(readFileSync(dbPath)));

    const destPath = join(dir, 'data', 'DraftOrb.sqlite');
    await gunzipFile(gzPath, destPath);

    const restored = new Database(destPath, { readonly: true });
    try {
      expect(restored.prepare('SELECT tier FROM players WHERE puuid = ?').get('p-1')).toEqual({
        tier: 'DIAMOND',
      });
    } finally {
      restored.close();
    }
  });

  it('streams multi-chunk payloads intact (larger than stream highWaterMark)', async () => {
    const dir = tempDir();
    // 64 MiB of incompressible-ish data forces many write chunks; zeros would
    // still exercise chunking on the write side but let us hash-verify.
    const payload = Buffer.alloc(64 * 1024 * 1024);
    for (let i = 0; i < payload.length; i += 4096) payload[i] = i % 251;
    const gzPath = join(dir, 'big.bin.gz');
    writeFileSync(gzPath, gzipSync(payload));

    const destPath = join(dir, 'big.bin');
    await gunzipFile(gzPath, destPath);

    const restored = readFileSync(destPath);
    expect(restored.length).toBe(payload.length);
    expect(createHash('sha256').update(restored).digest('hex')).toBe(
      createHash('sha256').update(payload).digest('hex'),
    );
  });

  it('overwrites an existing destination', async () => {
    const dir = tempDir();
    const payload = Buffer.from('fresh content');
    const gzPath = join(dir, 'a.gz');
    writeFileSync(gzPath, gzipSync(payload));

    const destPath = join(dir, 'dest.bin');
    writeFileSync(destPath, 'stale content that must be replaced');

    await gunzipFile(gzPath, destPath);
    expect(readFileSync(destPath)).toEqual(payload);
  });

  it('rejects a corrupt gzip and leaves no partial file behind', async () => {
    const dir = tempDir();
    const gzPath = join(dir, 'corrupt.gz');
    writeFileSync(gzPath, Buffer.from('this is not gzip data at all'));

    const destPath = join(dir, 'dest.bin');
    await expect(gunzipFile(gzPath, destPath)).rejects.toThrow();

    expect(partialFiles(dir)).toEqual([]);
    expect(() => readFileSync(destPath)).toThrow();
  });

  it('rejects a missing source file and leaves no partial file behind', async () => {
    const dir = tempDir();
    const destPath = join(dir, 'dest.bin');
    await expect(gunzipFile(join(dir, 'missing.gz'), destPath)).rejects.toThrow();
    expect(partialFiles(dir)).toEqual([]);
  });
});
