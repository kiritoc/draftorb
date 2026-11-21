/**
 * publish-public tests (BL-004, D-111): the public aggregates artifact must
 * contain latest.json + the patch tree and never profiles/, SQLite files or
 * PUUID-like content.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  collectPublishFiles,
  findSecretViolations,
  isForbiddenPublishPath,
  parseOriginRepo,
  parsePublishPublicArgs,
  scanPublishSet,
} from './publish-public';

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

function makePublicDir(): string {
  const dir = tempDir();
  touch(
    dir,
    'latest.json',
    '{"schemaVersion":1,"patch":"16.22","manifest":"16.22/manifest.json","generatedAt":"x"}',
  );
  touch(dir, '16.22/manifest.json', '{}');
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
    touch(dir, 'latest.json', '{"patch":"16.22"}');
    touch(dir, '16.21/x.json');
    expect(() => collectPublishFiles(dir)).toThrow('Patch dir 16.22/ missing');
  });
});

describe('scanPublishSet', () => {
  it('passes a clean publishable set', () => {
    expect(scanPublishSet(collectPublishFiles(makePublicDir()))).toEqual([]);
  });

  it('flags PUUID-like content inside a publishable file', () => {
    const dir = tempDir();
    touch(dir, 'latest.json', '{"patch":"16.22"}');
    const puuid = 'Qw1_'.repeat(19) + 'Qw';
    touch(dir, '16.22/leak.json', `{"id":"${puuid}"}`);
    const violations = scanPublishSet(collectPublishFiles(dir));
    expect(violations.some((v) => v.includes('PUUID-like identifier'))).toBe(true);
  });
});
