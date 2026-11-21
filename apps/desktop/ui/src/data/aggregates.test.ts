/**
 * Aggregates download tests (BL-010b): tar.gz parsing, sha256 verification,
 * cache fallback and stale flag — fetch/invoke are mocked.
 */

import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../tauri', () => ({
  isTauri: vi.fn(() => false),
  invokeCommand: vi.fn(),
}));

import { invokeCommand, isTauri } from '../tauri';
import { cacheRead, clearDataCache, downloadAggregates, ensureData, readCachedMeta } from './aggregates';

// Minimal ustar writer mirroring packages/etl/src/tar-create.ts output.
function tarEntry(name: string, data: string | Uint8Array): Buffer {
  const payload = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
  const header = Buffer.alloc(512);
  header.write(name.slice(0, 100), 0, 'utf8');
  header.write('0000644\0', 100, 'ascii');
  header.write('0000000\0', 108, 'ascii');
  header.write('0000000\0', 116, 'ascii');
  header.write(payload.length.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
  header.write('        ', 136, 'ascii');
  header.write('0', 156, 'ascii');
  header.write('ustar\0', 257, 'ascii');
  header.write('00', 263, 'ascii');
  const sum = header.reduce((a, b) => a + b, 0);
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  const pad = Buffer.alloc(Math.ceil(payload.length / 512) * 512);
  payload.copy(pad);
  return Buffer.concat([header, pad]);
}

function makeTarball(files: Record<string, string>): ArrayBuffer {
  const parts = Object.entries(files).map(([name, content]) => tarEntry(name, content));
  parts.push(Buffer.alloc(1024));
  const gz = gzipSync(Buffer.concat(parts));
  return gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength) as ArrayBuffer;
}

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

function manifestFor(files: Record<string, string>, patch = '16.22'): string {
  const dir = `${patch}`;
  return JSON.stringify({
    patch,
    files: Object.keys(files)
      .filter((n) => n.startsWith(`${dir}/`))
      .map((n) => ({ path: n.slice(dir.length + 1), sha256: sha(files[n]!) })),
  });
}

function mockFetch(tarball: ArrayBuffer) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(tarball, { status: 200 })),
  );
}

const FILES = {
  'latest.json': JSON.stringify({
    schemaVersion: 1,
    patch: '16.22',
    manifest: '16.22/manifest.json',
    generatedAt: '2026-11-21T00:00:00Z',
  }),
  '16.22/manifest.json': '', // filled per test
  '16.22/champions.json': '[]',
};

function fixture(): Record<string, string> {
  const files = { ...FILES };
  files['16.22/manifest.json'] = manifestFor({ '16.22/champions.json': '[]' });
  return files;
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(isTauri).mockReturnValue(false);
  await clearDataCache();
});

describe('downloadAggregates', () => {
  it('downloads, verifies sha256 and caches every entry', async () => {
    mockFetch(makeTarball(fixture()));
    const meta = await downloadAggregates('https://example.test/x.tar.gz');
    expect(meta.patch).toBe('16.22');
    expect(meta.generatedAt).toBe('2026-11-21T00:00:00Z');
    expect(await cacheRead('latest.json')).toContain('16.22');
    expect(await cacheRead('16.22/champions.json')).toBe('[]');
    expect(await readCachedMeta()).toMatchObject({ patch: '16.22' });
  });

  it('rejects a sha256 mismatch and caches nothing', async () => {
    const files = fixture();
    files['16.22/champions.json'] = '[1]'; // tampered after manifest build
    mockFetch(makeTarball(files));
    await expect(downloadAggregates('https://example.test/x.tar.gz')).rejects.toThrow(
      'sha256 mismatch',
    );
    expect(await cacheRead('16.22/champions.json')).toBeNull();
  });

  it('rejects a non-200 response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    await expect(downloadAggregates('https://example.test/x.tar.gz')).rejects.toThrow('HTTP 404');
  });
});

describe('ensureData', () => {
  it('returns loaded+fresh on success', async () => {
    mockFetch(makeTarball(fixture()));
    const load = await ensureData('https://example.test/x.tar.gz');
    expect(load).toEqual({
      kind: 'loaded',
      patch: '16.22',
      generatedAt: '2026-11-21T00:00:00Z',
      stale: false,
    });
  });

  it('falls back to the cache with stale=true when offline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    // seed cache via a successful download first
    mockFetch(makeTarball(fixture()));
    await downloadAggregates('https://example.test/x.tar.gz');
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    const load = await ensureData('https://example.test/x.tar.gz');
    expect(load).toMatchObject({ kind: 'loaded', patch: '16.22', stale: true });
  });

  it('returns none when download fails and cache is empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    const load = await ensureData('https://example.test/x.tar.gz');
    expect(load).toEqual({ kind: 'none' });
  });
});

describe('tauri cache path', () => {
  it('routes reads/writes through invokeCommand when in Tauri', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(invokeCommand).mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'data_cache_read') return (args?.name as string) === 'latest.json' ? '{}' : null;
      return null;
    });
    expect(await cacheRead('latest.json')).toBe('{}');
    expect(invokeCommand).toHaveBeenCalledWith('data_cache_read', { name: 'latest.json' });
  });
});
