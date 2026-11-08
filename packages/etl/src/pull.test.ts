/**
 * Tests for the network-free parts of `pnpm etl pull` (T-108): argument
 * parsing, state tag selection, repo resolution and tar.gz extraction path
 * safety. The gh CLI itself is never invoked here.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

import { parsePullArgs } from './commands/pull';
import { UsageError } from './cli-args';
import {
  isValidRepoSlug,
  parseOriginOwner,
  pickNewestStateTag,
  pickNewestStateTagWithAssets,
  resolveStateRepo,
} from './state-release';
import { extractTarGz, parseTar, resolveEntryTarget } from './tar-extract';

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'draftorb-tar-test-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

// --- argument parsing ---

describe('parsePullArgs', () => {
  it('defaults to the newest release and data/public', () => {
    expect(parsePullArgs([])).toEqual({
      repo: undefined,
      tag: undefined,
      withDb: false,
      dir: undefined,
    });
  });

  it('parses --repo, --tag, --db and --dir', () => {
    expect(
      parsePullArgs([
        '--repo=octo/draftorb-state',
        '--tag=state-20261108T1200Z',
        '--db',
        '--dir=/tmp/x',
      ]),
    ).toEqual({
      repo: 'octo/draftorb-state',
      tag: 'state-20261108T1200Z',
      withDb: true,
      dir: '/tmp/x',
    });
  });

  it('rejects unknown flags and positionals', () => {
    expect(() => parsePullArgs(['--bogus'])).toThrow(UsageError);
    expect(() => parsePullArgs(['extra'])).toThrow(UsageError);
  });
});

// --- tag selection ---

describe('pickNewestStateTag', () => {
  it('picks the chronologically newest state-* tag', () => {
    const tags = ['state-20261101T0000Z', 'state-20261108T0930Z', 'state-20261030T2359Z', 'v1.0'];
    expect(pickNewestStateTag(tags)).toBe('state-20261108T0930Z');
  });

  it('ignores non-conforming state-* tags', () => {
    expect(pickNewestStateTag(['state-beta', 'state-2026'])).toBeNull();
    expect(pickNewestStateTag([])).toBeNull();
  });

  it('accepts seconds in tags and orders mixed widths chronologically', () => {
    const tags = [
      'state-20261108T112306Z',
      'state-20261108T1123Z',
      'state-20261108T112359Z',
      'state-20261108T1237',
      'not-a-state-tag',
    ];
    // 11:23:00 < 11:23:06 < 11:23:59; the tag without a trailing Z is ignored.
    expect(pickNewestStateTag(tags)).toBe('state-20261108T112359Z');
  });
});

describe('pickNewestStateTagWithAssets', () => {
  const exportsAsset = 'public-exports.tar.gz';

  it('skips DB-only releases left by failed pipeline runs', () => {
    const releases = [
      { tag: 'state-20261108T1200Z', assets: ['DraftOrb.sqlite.gz'] },
      {
        tag: 'state-20261108T0000Z',
        assets: ['DraftOrb.sqlite.gz', 'public-exports.tar.gz'],
      },
      { tag: 'state-20261107T1200Z', assets: ['public-exports.tar.gz'] },
    ];
    expect(pickNewestStateTagWithAssets(releases, exportsAsset)).toBe('state-20261108T0000Z');
  });

  it('returns null when no state release carries the asset', () => {
    expect(
      pickNewestStateTagWithAssets(
        [{ tag: 'state-20261108T1200Z', assets: ['DraftOrb.sqlite.gz'] }],
        exportsAsset,
      ),
    ).toBeNull();
    expect(pickNewestStateTagWithAssets([], exportsAsset)).toBeNull();
  });
});

// --- repo resolution ---

describe('resolveStateRepo', () => {
  it('uses --repo verbatim when it is a full slug', () => {
    expect(resolveStateRepo('octo/state', {})).toBe('octo/state');
  });

  it('falls back to DRAFTORB_STATE_REPO then the default name', () => {
    expect(resolveStateRepo(undefined, { DRAFTORB_STATE_REPO: 'custom' }, 'octo')).toBe(
      'octo/custom',
    );
    expect(resolveStateRepo(undefined, {}, 'octo')).toBe('octo/draftorb-state');
  });

  it('rejects malformed slugs', () => {
    expect(() => resolveStateRepo('a/b/c', {})).toThrow(UsageError);
    expect(() => resolveStateRepo('bad name', {})).toThrow(UsageError);
  });

  it('requires an owner for bare names', () => {
    expect(() => resolveStateRepo(undefined, {}, undefined)).toThrow(UsageError);
  });
});

describe('parseOriginOwner / isValidRepoSlug', () => {
  it('parses https and ssh remote urls', () => {
    expect(parseOriginOwner('https://github.com/kiritoc/draftorb.git')).toBe('kiritoc');
    expect(parseOriginOwner('git@github.com:kiritoc/draftorb.git')).toBe('kiritoc');
    expect(parseOriginOwner('not a url')).toBeUndefined();
  });

  it('validates repo slugs', () => {
    expect(isValidRepoSlug('octo/draftorb-state')).toBe(true);
    expect(isValidRepoSlug('draftorb-state')).toBe(false);
  });
});

// --- tar.gz extraction ---

/** Builds a minimal ustar archive in memory. */
function buildTar(entries: Array<{ name: string; body?: string; type?: string }>): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512);
    header.write(entry.name.slice(0, 100), 0, 'utf8');
    header.write('0000644\0', 100, 'utf8');
    header.write('0000000\0', 108, 'utf8');
    header.write('0000000\0', 116, 'utf8');
    const body = Buffer.from(entry.body ?? '', 'utf8');
    header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124, 'utf8');
    header.write('00000000000\0', 136, 'utf8');
    header.fill(0x20, 148, 156);
    header.write(entry.type ?? '0', 156, 'utf8');
    header.write('ustar\0', 257, 'utf8');
    header.write('00', 263, 'utf8');
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'utf8');
    chunks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function gz(entries: Array<{ name: string; body?: string; type?: string }>): Buffer {
  return gzipSync(buildTar(entries));
}

describe('parseTar', () => {
  it('parses names, sizes and payloads', () => {
    const entries = parseTar(buildTar([{ name: 'public/a.json', body: '{"x":1}' }]));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe('public/a.json');
    expect(entries[0]!.data.toString('utf8')).toBe('{"x":1}');
  });
});

describe('resolveEntryTarget', () => {
  // Real temp dir: path.resolve/join behave identically on every OS, unlike a
  // hardcoded POSIX '/tmp/...' string which gains a drive letter on Windows.
  const root = join(tempDir(), 'draftorb-target');

  it('maps prefixed entries into the target', () => {
    expect(resolveEntryTarget(root, 'public', 'public/16.22/x.json')).toBe(
      resolve(root, '16.22', 'x.json'),
    );
  });

  it('skips entries outside the prefix', () => {
    expect(resolveEntryTarget(root, 'public', 'other/x.json')).toBeNull();
    expect(resolveEntryTarget(root, 'public', 'public')).toBeNull();
    expect(resolveEntryTarget(root, 'public', '')).toBeNull();
    expect(resolveEntryTarget(root, 'public', 'public/dir\\file.txt')).toBeNull();
  });

  it('rejects traversal and absolute paths', () => {
    expect(() => resolveEntryTarget(root, 'public', 'public/../evil')).toThrow(/Unsafe/);
    expect(() => resolveEntryTarget(root, 'public', 'public/a/../../evil')).toThrow(/Unsafe/);
    expect(() => resolveEntryTarget(root, 'public', 'public//x')).toThrow(/Unsafe/);
    expect(() => resolveEntryTarget(root, 'public', 'public/./x')).toThrow(/Unsafe/);
  });

  it('rejects absolute entries', () => {
    expect(() => resolveEntryTarget(root, 'public', '/etc/passwd')).toThrow(/Unsafe/);
    expect(() => resolveEntryTarget(root, 'public', '/public/x.json')).toThrow(/Unsafe/);
    expect(() => resolveEntryTarget(root, 'public', '\\server\\share\\x')).toThrow(/Unsafe/);
  });

  it('rejects drive-letter entries', () => {
    expect(() => resolveEntryTarget(root, 'public', 'public/C:/x')).toThrow(/Unsafe/);
    expect(() => resolveEntryTarget(root, 'public', 'public/C:x')).toThrow(/Unsafe/);
    expect(() => resolveEntryTarget(root, 'public', 'public/d:/deep/x.json')).toThrow(/Unsafe/);
  });

  it('rejects backslash traversal', () => {
    expect(() => resolveEntryTarget(root, 'public', 'public/..\\..\\x')).toThrow(/Unsafe/);
    expect(() => resolveEntryTarget(root, 'public', 'public/a\\..\\..\\evil')).toThrow(/Unsafe/);
    expect(() => resolveEntryTarget(root, 'public', '..\\..\\escape')).toThrow(/Unsafe/);
  });

  it('rejects NUL bytes', () => {
    expect(() => resolveEntryTarget(root, 'public', 'public/a\0b.json')).toThrow(/Unsafe/);
    expect(() => resolveEntryTarget(root, 'public', 'public/\0')).toThrow(/Unsafe/);
  });
});

describe('extractTarGz', () => {
  it('extracts files under the strip prefix and returns relative paths', () => {
    const dir = tempDir();
    const written = extractTarGz(
      gz([
        { name: 'public/', type: '5' },
        { name: 'public/16.22/baseline.json', body: '[[1]]' },
        { name: 'public/profiles/index.json', body: '{}' },
        { name: 'pax_global_header', body: 'x' },
      ]),
      dir,
      { stripPrefix: 'public' },
    );
    expect(written.map((f) => f.path).sort()).toEqual([
      '16.22/baseline.json',
      'profiles/index.json',
    ]);
    expect(readFileSync(join(dir, '16.22', 'baseline.json'), 'utf8')).toBe('[[1]]');
  });

  it('aborts on an entry that escapes the target', () => {
    const dir = tempDir();
    const evil = gz([{ name: 'public/../../escape.txt', body: 'x' }]);
    expect(() => extractTarGz(evil, dir, { stripPrefix: 'public' })).toThrow(/Unsafe/);
  });

  it('skips backslash entries instead of writing them', () => {
    const dir = tempDir();
    const archive = gz([
      { name: 'public/ok.txt', body: 'ok' },
      { name: 'public/dir\\evil.txt', body: 'x' },
    ]);
    const written = extractTarGz(archive, dir, { stripPrefix: 'public' });
    expect(written.map((f) => f.path)).toEqual(['ok.txt']);
  });

  it('skips link entries instead of writing them', () => {
    const dir = tempDir();
    const archive = gz([
      { name: 'public/real.txt', body: 'ok' },
      { name: 'public/link.txt', type: '2', body: '/etc/passwd' },
    ]);
    const written = extractTarGz(archive, dir, { stripPrefix: 'public' });
    expect(written.map((f) => f.path)).toEqual(['real.txt']);
  });
});
