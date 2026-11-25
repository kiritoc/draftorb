/**
 * publish-public tests (BL-004, D-111): the public aggregates artifact must
 * contain latest.json + the patch tree and never profiles/, SQLite files or
 * PUUID-like content.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MANIFEST_SCHEMA_VERSION } from '@draftorb/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { createHash } from 'node:crypto';

import {
  augmentManifestWithRootFiles,
  collectPublishFiles,
  findSecretViolations,
  isForbiddenPublishPath,
  parsePublishPublicArgs,
  scanPublishSet,
  toTarEntries,
  type PublishFile,
} from './publish-public';
import { parseOriginRepo } from './shared';

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'publish-public-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function touch(root: string, rel: string, content = '{}'): void {
  const abs = join(root, ...rel.split('/'));
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

function latestJson(patch = '16.22'): string {
  return JSON.stringify({
    schemaVersion: 1,
    patch,
    manifest: `${patch}/manifest.json`,
    generatedAt: 'x',
  });
}

function manifestJson(patch = '16.22'): string {
  return JSON.stringify({
    patch,
    generatedAt: 'x',
    region: 'EUW1',
    rankBuckets: [],
    roles: [],
    files: [],
    schemaVersion: MANIFEST_SCHEMA_VERSION,
  });
}

function makePublicDir(): string {
  const dir = tempDir();
  touch(dir, 'latest.json', latestJson());
  touch(dir, '16.22/manifest.json', manifestJson());
  touch(dir, '16.22/champions.json', '[]');
  touch(dir, 'profiles/index.json', '{}');
  touch(dir, 'profiles/kirito.json', '{}');
  return dir;
}

describe('parsePublishPublicArgs', () => {
  it('defaults tag to data-latest and dryRun to false', () => {
    expect(parsePublishPublicArgs([])).toEqual({
      repo: undefined,
      tag: 'data-latest',
      dryRun: false,
      out: undefined,
    });
  });

  it('parses flags', () => {
    expect(
      parsePublishPublicArgs(['--repo', 'o/r', '--tag', 't', '--dry-run', '--out', 'a/b.gz']),
    ).toEqual({ repo: 'o/r', tag: 't', dryRun: true, out: 'a/b.gz' });
  });

  it('rejects unknown flags', () => {
    expect(() => parsePublishPublicArgs(['--nope'])).toThrow('Usage: etl');
  });
});

describe('parseOriginRepo', () => {
  it.each([
    ['https://github.com/kiritoc/draftorb.git', 'kiritoc/draftorb'],
    ['git@github.com:kiritoc/draftorb.git', 'kiritoc/draftorb'],
    ['https://github.com/kiritoc/draftorb', 'kiritoc/draftorb'],
  ])('%s -> %s', (url, expected) => {
    expect(parseOriginRepo(url)).toBe(expected);
  });
});

describe('isForbiddenPublishPath', () => {
  it.each([
    'profiles/index.json',
    'data/public/profiles/x.json',
    'a/profiles/b.json',
    'DraftOrb.sqlite',
    'x/y.sqlite3.gz',
    'x/y.db',
  ])('flags %s', (p) => expect(isForbiddenPublishPath(p)).toBe(true));

  it.each(['latest.json', '16.22/champions.json', 'data/profiles.config.json'])('allows %s', (p) =>
    expect(isForbiddenPublishPath(p)).toBe(false),
  );
});

describe('findSecretViolations', () => {
  it('flags a PUUID-like token (78 base64url chars, letter+digit)', () => {
    const puuid = 'A1_'.repeat(26);
    expect(findSecretViolations(`{"puuid":"${puuid}"}`)).toContain('PUUID-like identifier');
  });

  it('flags a dashed UUID (canonical PUUID form)', () => {
    expect(findSecretViolations('{"puuid":"0123abcd-4567-89ab-cdef-0123456789ab"}')).toContain(
      'PUUID-like identifier',
    );
  });

  it('flags an RGAPI- key pattern', () => {
    const key = `RGAPI-${'a'.repeat(16)}`;
    expect(findSecretViolations(`key ${key} here`)).toContain('RGAPI- key pattern');
  });

  it('passes clean JSON and sha256-length hashes', () => {
    expect(findSecretViolations('{"sha256":"' + 'a'.repeat(64) + '"}')).toEqual([]);
  });
});

describe('collectPublishFiles', () => {
  it('collects latest.json + patch tree and excludes profiles/', () => {
    const files = collectPublishFiles(makePublicDir());
    const rels = files.map((f) => f.rel).sort();
    expect(rels).toEqual(['16.22/champions.json', '16.22/manifest.json', 'latest.json']);
  });

  it('fails without latest.json', () => {
    const dir = tempDir();
    touch(dir, '16.22/x.json');
    expect(() => collectPublishFiles(dir)).toThrow('No latest.json');
  });

  it('fails when the patch dir is missing', () => {
    const dir = tempDir();
    touch(dir, 'latest.json', latestJson());
    touch(dir, '16.21/x.json');
    expect(() => collectPublishFiles(dir)).toThrow('Patch dir 16.22/ missing');
  });

  it('fails on an invalid latest.json', () => {
    const dir = tempDir();
    touch(dir, 'latest.json', '{"patch":"16.22"}');
    expect(() => collectPublishFiles(dir)).toThrow('latest.json is invalid');
  });

  it('fails cleanly on malformed JSON instead of a raw SyntaxError', () => {
    const dir = tempDir();
    touch(dir, 'latest.json', '{not json');
    expect(() => collectPublishFiles(dir)).toThrow('latest.json is invalid');
  });

  it('fails when the manifest is missing (e.g. after a static refresh)', () => {
    const dir = tempDir();
    touch(dir, 'latest.json', latestJson());
    touch(dir, '16.22/champions.json', '[]');
    expect(() => collectPublishFiles(dir)).toThrow('Manifest 16.22/manifest.json missing');
  });

  it('fails when the manifest is for another patch', () => {
    const dir = tempDir();
    touch(dir, 'latest.json', latestJson());
    touch(dir, '16.22/manifest.json', manifestJson('16.21'));
    expect(() => collectPublishFiles(dir)).toThrow('invalid or not for 16.22');
  });

  it('excludes older patches and root-level reports', () => {
    const dir = makePublicDir();
    touch(dir, '16.21/manifest.json', manifestJson('16.21'));
    touch(dir, 'backtest-report.json', '{}');
    const rels = collectPublishFiles(dir).map((f) => f.rel);
    expect(rels.some((r) => r.startsWith('16.21/'))).toBe(false);
    expect(rels).not.toContain('backtest-report.json');
  });
});

describe('augmentManifestWithRootFiles', () => {
  function archiveEntries(): ReturnType<typeof toTarEntries> {
    const dir = makePublicDir();
    const tagsPath = join(dir, 'champion-tags.json');
    writeFileSync(tagsPath, '{"tags":{}}');
    const files: PublishFile[] = [
      ...collectPublishFiles(dir),
      { rel: 'champion-tags.json', abs: tagsPath, size: 11 },
    ];
    return toTarEntries(files);
  }

  it('adds sha256 entries for the archive-root files to the manifest copy', () => {
    const entries = augmentManifestWithRootFiles(archiveEntries());
    const manifest = entries.find((e) => e.name === '16.22/manifest.json');
    expect(manifest).toBeDefined();
    const parsed = JSON.parse(manifest!.data.toString('utf8')) as {
      files: Array<{ path: string; sha256?: string }>;
    };
    const byPath = new Map(parsed.files.map((f) => [f.path, f.sha256]));
    const latest = entries.find((e) => e.name === 'latest.json')!;
    const tags = entries.find((e) => e.name === 'champion-tags.json')!;
    const sha = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');
    expect(byPath.get('/latest.json')).toBe(sha(latest.data));
    expect(byPath.get('/champion-tags.json')).toBe(sha(tags.data));
    // The fixture manifest starts empty, so the archive copy lists exactly
    // the two root files.
    expect(parsed.files).toHaveLength(2);
    // The manifest does not list itself.
    expect(parsed.files.some((f) => f.path.includes('manifest.json'))).toBe(false);
  });

  it('fails when a root file is missing from the publish set', () => {
    const entries = toTarEntries(collectPublishFiles(makePublicDir()));
    expect(() => augmentManifestWithRootFiles(entries)).toThrow('missing champion-tags.json');
  });
});

describe('scanPublishSet', () => {
  it('passes a clean publishable set', () => {
    expect(scanPublishSet(collectPublishFiles(makePublicDir()))).toEqual([]);
  });

  it('flags PUUID-like content inside a publishable file', () => {
    const dir = tempDir();
    touch(dir, 'latest.json', latestJson());
    touch(dir, '16.22/manifest.json', manifestJson());
    const puuid = 'Qw1_'.repeat(19) + 'Qw';
    touch(dir, '16.22/leak.json', `{"id":"${puuid}"}`);
    const violations = scanPublishSet(collectPublishFiles(dir));
    expect(violations.some((v) => v.includes('PUUID-like identifier'))).toBe(true);
  });
});
