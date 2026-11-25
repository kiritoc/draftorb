/**
 * Aggregates download tests (BL-010b): tar.gz parsing, sha256 verification,
 * cache fallback, stale flag and patch pruning — fetch/invoke are mocked.
 */

import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

import { MANIFEST_SCHEMA_VERSION } from '@draftorb/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../tauri', () => ({
  isTauri: vi.fn(() => false),
  invokeCommand: vi.fn(),
}));

import { invokeCommand, isTauri } from '../tauri';
import {
  cacheRead,
  cacheWrite,
  clearDataCache,
  downloadAggregates,
  ensureData,
  readCachedMeta,
} from './aggregates';

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

function latestJson(patch: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    patch,
    manifest: `${patch}/manifest.json`,
    generatedAt: '2026-11-21T00:00:00Z',
  });
}

const TAGS = '{"tags":{}}';

/** Manifest as `publish-public` ships it inside the tarball: patch-relative
 * paths for `<patch>/` files plus `/name` archive-root entries. */
function manifestFor(
  files: Record<string, string>,
  patch: string,
  opts: { omitSha?: string[] } = {},
): string {
  const dir = `${patch}`;
  const entries = Object.keys(files)
    .filter((n) => n.startsWith(`${dir}/`) && n !== `${dir}/manifest.json`)
    .map((n) => ({
      path: n.slice(dir.length + 1),
      sha256: opts.omitSha?.includes(n) ? undefined : sha(files[n]!),
    }));
  for (const name of ['latest.json', 'champion-tags.json']) {
    entries.push({ path: `/${name}`, sha256: sha(files[name]!) });
  }
  return JSON.stringify({
    patch,
    generatedAt: '2026-11-21T00:00:00Z',
    region: 'EUW1',
    rankBuckets: [],
    roles: [],
    files: entries,
    schemaVersion: MANIFEST_SCHEMA_VERSION,
  });
}

function mockFetch(tarball: ArrayBuffer) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(tarball, { status: 200 })),
  );
}

function fixture(patch = '16.22'): Record<string, string> {
  const files: Record<string, string> = {
    'latest.json': latestJson(patch),
    'champion-tags.json': TAGS,
    [`${patch}/champions.json`]: '[]',
  };
  files[`${patch}/manifest.json`] = manifestFor(files, patch);
  return files;
}

function offline() {
  vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
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
    expect(meta.schemaVersion).toBe(1);
    expect(await cacheRead('latest.json')).toContain('16.22');
    expect(await cacheRead('16.22/champions.json')).toBe('[]');
    expect(await cacheRead('champion-tags.json')).toBe(TAGS);
    expect(await readCachedMeta()).toMatchObject({ patch: '16.22', schemaVersion: 1 });
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

  it('rejects a tampered archive-root file (latest.json)', async () => {
    const files = fixture();
    // Same patch/manifest pointers, different generatedAt: schema-valid but
    // no longer matching the manifest sha256.
    files['latest.json'] = latestJson('16.22').replace('2026-11-21', '2026-11-22');
    mockFetch(makeTarball(files));
    await expect(downloadAggregates('https://example.test/x.tar.gz')).rejects.toThrow(
      'sha256 mismatch',
    );
  });

  it('rejects a manifest entry without sha256', async () => {
    const files = fixture();
    files['16.22/manifest.json'] = manifestFor(files, '16.22', {
      omitSha: ['16.22/champions.json'],
    });
    mockFetch(makeTarball(files));
    await expect(downloadAggregates('https://example.test/x.tar.gz')).rejects.toThrow(
      'has no sha256',
    );
  });

  it('rejects a tar entry the manifest does not cover', async () => {
    const files = fixture();
    files['16.22/smuggled.json'] = '{}';
    mockFetch(makeTarball(files));
    await expect(downloadAggregates('https://example.test/x.tar.gz')).rejects.toThrow(
      'not covered by the manifest',
    );
  });

  it('rejects when latest.json points at a missing manifest', async () => {
    const files = fixture();
    files['latest.json'] = JSON.stringify({
      schemaVersion: 1,
      patch: '16.22',
      manifest: '16.22/gone.json',
      generatedAt: '2026-11-21T00:00:00Z',
    });
    mockFetch(makeTarball(files));
    await expect(downloadAggregates('https://example.test/x.tar.gz')).rejects.toThrow(
      'missing 16.22/gone.json',
    );
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
    mockFetch(makeTarball(fixture()));
    await downloadAggregates('https://example.test/x.tar.gz');
    offline();
    const load = await ensureData('https://example.test/x.tar.gz');
    expect(load).toMatchObject({ kind: 'loaded', patch: '16.22', stale: true });
  });

  it('returns none when the cached latest.json disagrees with the meta', async () => {
    mockFetch(makeTarball(fixture()));
    await downloadAggregates('https://example.test/x.tar.gz');
    // Simulate a crash between the latest.json write and the meta write.
    await cacheWrite('latest.json', latestJson('17.3'));
    offline();
    const load = await ensureData('https://example.test/x.tar.gz');
    expect(load).toEqual({ kind: 'none' });
  });

  it('returns none when download fails and cache is empty', async () => {
    offline();
    const load = await ensureData('https://example.test/x.tar.gz');
    expect(load).toEqual({ kind: 'none' });
  });
});

describe('cache pruning', () => {
  it('drops old patch directories after a successful download', async () => {
    mockFetch(makeTarball(fixture('15.1')));
    await downloadAggregates('https://example.test/x.tar.gz');
    expect(await cacheRead('15.1/champions.json')).toBe('[]');

    mockFetch(makeTarball(fixture('16.22')));
    await downloadAggregates('https://example.test/x.tar.gz');
    expect(await cacheRead('16.22/champions.json')).toBe('[]');
    expect(await cacheRead('15.1/champions.json')).toBeNull();
    expect(await cacheRead('latest.json')).toContain('16.22');
    expect(await readCachedMeta()).toMatchObject({ patch: '16.22' });
  });
});

describe('tauri cache path', () => {
  it('routes reads/writes/prune through invokeCommand when in Tauri', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(invokeCommand).mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'data_cache_read') return (args?.name as string) === 'latest.json' ? '{}' : null;
      return null;
    });
    expect(await cacheRead('latest.json')).toBe('{}');
    expect(invokeCommand).toHaveBeenCalledWith('data_cache_read', { name: 'latest.json' });
  });
});
