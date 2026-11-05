import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { MANIFEST_SCHEMA_VERSION } from '@draftorb/shared';

import { seed, validPerksJson } from './export.fixtures.js';
import { createExportTestSuite, FIXED_NOW, PATCH } from './export.test-utils.js';
import { exportJson } from './index.js';

const suite = createExportTestSuite();

describe('exportJson', () => {
  it('determinism: two exports into separate dirs are byte-identical (C1)', () => {
    seed(suite.db, 'match', [{}]);
    seed(suite.db, 'roleProb', [
      { championId: 412, role: 'SUPPORT', gamesW: 10, gamesW2: 10, prob: 1 },
    ]);
    seed(suite.db, 'baseline', [
      {
        championId: 412,
        myRole: 'SUPPORT',
        rankBucket: 'IRON',
        gamesW: 10,
        gamesW2: 10,
        winsW: 6,
        games: 3,
      },
    ]);
    const dirA = join(suite.directory, 'public-a');
    const dirB = join(suite.directory, 'public-b');
    const resultA = exportJson(suite.db, { patch: PATCH, publicDir: dirA, now: () => FIXED_NOW });
    const resultB = exportJson(suite.db, { patch: PATCH, publicDir: dirB, now: () => FIXED_NOW });

    const listFiles = (root: string): string[] =>
      readdirSync(root, { recursive: true })
        .map(String)
        .filter((rel) => statSync(join(root, rel)).isFile())
        .sort();
    const filesA = listFiles(join(dirA, PATCH));
    const filesB = listFiles(join(dirB, PATCH));
    expect(filesA).toEqual(filesB);
    for (const rel of filesA) {
      const a = readFileSync(join(dirA, PATCH, rel), 'utf8');
      const b = readFileSync(join(dirB, PATCH, rel), 'utf8');
      expect(a).toBe(b);
    }
    expect(resultA.manifest.generatedAt).toBe(resultB.manifest.generatedAt);
  });

  it('atomicity: re-export after data shrinks leaves no stale files (C4a)', () => {
    seed(suite.db, 'match', [{}]);
    seed(suite.db, 'roleProb', [
      { championId: 412, role: 'SUPPORT', gamesW: 10, gamesW2: 10, prob: 1 },
      { championId: 26, role: 'SUPPORT', gamesW: 10, gamesW2: 10, prob: 1 },
    ]);
    suite.exportOnce();
    expect(readFileSync(join(suite.publicDir, PATCH, 'role-prob.json'), 'utf8')).toContain('26');

    // Re-export with only 412 qualifying -> 26's files must be gone.
    suite.db.prepare('DELETE FROM role_prob WHERE champion_id = 26').run();
    suite.exportOnce();
    const publicDir = suite.publicDir;
    const remaining = readdirSync(join(publicDir, PATCH), { recursive: true })
      .map(String)
      .filter((relativePath) => statSync(join(publicDir, PATCH, relativePath)).isFile())
      .map((relativePath) => relativePath.replaceAll('\\', '/'))
      .sort();
    expect(remaining).toEqual([
      'manifest.json',
      'pick-rate.json',
      'role-prob.json',
      'roles/SUPPORT/ally-pairs.json',
      'roles/SUPPORT/baseline.json',
      'roles/SUPPORT/enemy-pairs.json',
      'roles/SUPPORT/lane-full.json',
      'roles/SUPPORT/lane-vs.json',
    ]);
    const roleProb = suite.readFile('role-prob.json') as Record<string, Record<string, number>>;
    expect(Object.keys(roleProb)).toEqual(['412']);
    // No temp dir left behind.
    expect(readdirSync(publicDir).some((p) => p.startsWith('.16.21.tmp'))).toBe(false);
  });

  it('pre-write schema failure preserves the previous export (C4b pre-write)', () => {
    seed(suite.db, 'match', [{}]);
    seed(suite.db, 'roleProb', [
      { championId: 412, role: 'SUPPORT', gamesW: 10, gamesW2: 10, prob: 1 },
    ]);
    suite.exportOnce();
    const previous = readFileSync(join(suite.publicDir, PATCH, 'manifest.json'), 'utf8');

    // This invalid row is rejected while file contents are being built, before a temp directory exists.
    seed(suite.db, 'runeCtx', [
      {
        championId: 999,
        myRole: 'SUPPORT',
        contextKey: '',
        contextLevel: 5,
        perksHash: 'x',
        perksJson: validPerksJson,
        gamesW: 10,
        gamesW2: 10,
        winsW: 6,
        players: 1,
      },
    ]);

    expect(() => suite.exportOnce()).toThrow(/Invalid rune export/);
    // Previous export intact.
    expect(readFileSync(join(suite.publicDir, PATCH, 'manifest.json'), 'utf8')).toBe(previous);
    // No temp dir left behind.
    expect(
      readdirSync(suite.publicDir).filter(
        (name) => name.startsWith('.16.21.tmp-') || name.startsWith('.16.21.old-'),
      ),
    ).toEqual([]);
  });

  it('rolls back a failure after writing into the temporary export (C4b)', () => {
    seed(suite.db, 'match', [{}]);
    seed(suite.db, 'roleProb', [
      { championId: 412, role: 'SUPPORT', gamesW: 10, gamesW2: 10, prob: 1 },
    ]);
    suite.exportOnce();

    const snapshot = (patchDir: string): Map<string, string> =>
      new Map(
        readdirSync(patchDir, { recursive: true })
          .map(String)
          .filter((relativePath) => statSync(join(patchDir, relativePath)).isFile())
          .sort()
          .map((relativePath) => [
            relativePath,
            readFileSync(join(patchDir, relativePath), 'utf8'),
          ]),
      );
    const patchDir = join(suite.publicDir, PATCH);
    const previous = snapshot(patchDir);

    expect(() =>
      suite.exportOnce({
        hooks: {
          afterWrite(relativePath) {
            if (relativePath === 'role-prob.json') throw new Error('injected write failure');
          },
        },
      }),
    ).toThrow('injected write failure');

    expect(snapshot(patchDir)).toEqual(previous);
    expect(
      readdirSync(suite.publicDir).filter(
        (name) => name.startsWith('.16.21.tmp-') || name.startsWith('.16.21.old-'),
      ),
    ).toEqual([]);
  });

  it('returns final published paths for every export file (C3)', () => {
    seed(suite.db, 'match', [{}]);
    seed(suite.db, 'roleProb', [
      { championId: 412, role: 'SUPPORT', gamesW: 10, gamesW2: 10, prob: 1 },
    ]);

    const result = suite.exportOnce();

    for (const file of result.files) {
      expect(file.path).toBe(join(suite.publicDir, PATCH, file.relativePath));
      expect(existsSync(file.path)).toBe(true);
      expect(file.path).not.toContain('.tmp-');
    }
  });

  it('preserves static catalogs across re-export and lists them in the manifest', () => {
    seed(suite.db, 'match', [{}]);
    const patchDir = join(suite.publicDir, PATCH);
    mkdirSync(patchDir, { recursive: true });
    writeFileSync(join(patchDir, 'champions.json'), '{"412":{}}');
    writeFileSync(join(patchDir, 'items.json'), '{"3340":{}}');
    writeFileSync(join(patchDir, 'runes.json'), '[{"id":8000}]');

    const first = suite.exportOnce();
    expect(first.warnings.some((w) => w.includes('missing static catalog'))).toBe(false);
    suite.exportOnce();

    expect(readFileSync(join(patchDir, 'champions.json'), 'utf8')).toBe('{"412":{}}');
    expect(readFileSync(join(patchDir, 'items.json'), 'utf8')).toBe('{"3340":{}}');
    expect(readFileSync(join(patchDir, 'runes.json'), 'utf8')).toBe('[{"id":8000}]');
    const manifest = suite.readFile<{ files: Array<{ path: string }> }>('manifest.json');
    const paths = manifest.files.map((f) => f.path);
    expect(paths).toContain('champions.json');
    expect(paths).toContain('items.json');
    expect(paths).toContain('runes.json');
  });

  it('warns when static catalogs are missing', () => {
    seed(suite.db, 'match', [{}]);
    const result = suite.exportOnce();
    expect(result.warnings.some((w) => w.includes('missing static catalog'))).toBe(true);
  });

  const writeLatestJson = (patch: string, withManifest: boolean): void => {
    mkdirSync(suite.publicDir, { recursive: true });
    writeFileSync(
      join(suite.publicDir, 'latest.json'),
      JSON.stringify({
        schemaVersion: 1,
        patch,
        manifest: `${patch}/manifest.json`,
        generatedAt: FIXED_NOW.toISOString(),
      }),
    );
    if (withManifest) {
      mkdirSync(join(suite.publicDir, patch), { recursive: true });
      writeFileSync(
        join(suite.publicDir, patch, 'manifest.json'),
        JSON.stringify({
          schemaVersion: MANIFEST_SCHEMA_VERSION,
          patch,
          generatedAt: FIXED_NOW.toISOString(),
          region: 'euw1',
          rankBuckets: [],
          roles: [],
          files: [],
        }),
      );
    }
  };
  const writeLatest = (patch: string): void => writeLatestJson(patch, true);
  const readLatestPatch = (): string =>
    (JSON.parse(readFileSync(join(suite.publicDir, 'latest.json'), 'utf8')) as { patch: string })
      .patch;

  it('keeps a newer published latest.json when the database has no matches', () => {
    // No match seed: dbLatestPatch is undefined, but a newer pointer exists.
    writeLatest('16.22');
    const result = suite.exportOnce();

    expect(result.latestPath).toBeNull();
    expect(result.warnings.some((w) => w.includes('newer patch 16.22'))).toBe(true);
    expect(readLatestPatch()).toBe('16.22');
  });

  it('keeps a newer published latest.json when the database latest patch is older', () => {
    // match seed defaults to patch 16.21; the published pointer is ahead.
    seed(suite.db, 'match', [{}]);
    writeLatest('16.22');
    const result = suite.exportOnce();

    expect(result.latestPath).toBeNull();
    expect(result.warnings.some((w) => w.includes('newer patch 16.22'))).toBe(true);
    expect(readLatestPatch()).toBe('16.22');
  });

  it('moves latest.json forward over an older published pointer', () => {
    seed(suite.db, 'match', [{}]);
    writeLatest('16.20');
    const result = suite.exportOnce();

    expect(result.latestPath).not.toBeNull();
    expect(readLatestPatch()).toBe('16.21');
  });

  it('replaces a dangling newer latest.json when the export is eligible', () => {
    // latest.json points at 16.22 but its patch directory is gone (partial
    // restore); the db latest patch 16.21 must be able to take over.
    seed(suite.db, 'match', [{}]);
    writeLatestJson('16.22', false);
    const result = suite.exportOnce();

    expect(result.latestPath).not.toBeNull();
    expect(result.warnings.some((w) => w.includes('manifest is missing or invalid'))).toBe(true);
    expect(readLatestPatch()).toBe('16.21');
  });

  it('keeps a dangling newer latest.json when the export is not eligible', () => {
    seed(suite.db, 'match', [{}]);
    writeLatestJson('16.22', false);
    const result = suite.exportOnce({ patch: '16.20' });

    expect(result.latestPath).toBeNull();
    expect(readLatestPatch()).toBe('16.22');
  });
});
