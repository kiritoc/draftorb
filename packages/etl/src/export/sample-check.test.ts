/**
 * Unit tests for the published-export sanity check (B-052). Builds a minimal
 * synthetic export in a temp dir — tests must never read gitignored
 * `data/public` (D-079); the real-data check runs in the ETL workflow via
 * `pnpm etl validate-export`.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkPublishedExport } from './sample-check';

const PATCH = '16.21';

interface FixtureContext {
  directory: string;
  publicDir: string;
  tagsFilePath: string;
}

let context: FixtureContext | undefined;

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value), 'utf8');
}

/** Writes a minimal but schema-valid export for one SUPPORT role. */
function writeExport(publicDir: string, baseline: unknown): void {
  const patchDir = join(publicDir, PATCH);
  const roleDir = join(patchDir, 'roles', 'SUPPORT');
  const files = [
    'champions.json',
    'role-prob.json',
    'roles/SUPPORT/baseline.json',
    'roles/SUPPORT/ally-pairs.json',
    'roles/SUPPORT/enemy-pairs.json',
    'roles/SUPPORT/lane-vs.json',
    'roles/SUPPORT/lane-full.json',
  ];

  writeJson(join(publicDir, 'latest.json'), {
    schemaVersion: 1,
    patch: PATCH,
    manifest: `${PATCH}/manifest.json`,
    generatedAt: '2026-11-08T00:00:00.000Z',
  });
  writeJson(join(patchDir, 'manifest.json'), {
    patch: PATCH,
    generatedAt: '2026-11-08T00:00:00.000Z',
    region: 'euw1',
    rankBuckets: ['DIAMOND'],
    roles: ['SUPPORT'],
    minimalRoles: [],
    files: files.map((path) => ({ path })),
    schemaVersion: 8,
  });
  writeJson(join(patchDir, 'champions.json'), {
    '412': { id: 412, name: 'Thresh', icon: 'Thresh.png', roles: ['SUPPORT', 'TOP'] },
    '432': { id: 432, name: 'Bard', icon: 'Bard.png', roles: ['SUPPORT', 'JUNGLE'] },
  });
  writeJson(join(patchDir, 'role-prob.json'), {
    '412': { SUPPORT: 0.7, TOP: 0.3 },
    '432': { JUNGLE: 0.4, SUPPORT: 0.6 },
  });
  writeJson(join(roleDir, 'baseline.json'), baseline);
  writeJson(join(roleDir, 'ally-pairs.json'), []);
  writeJson(join(roleDir, 'enemy-pairs.json'), []);
  writeJson(join(roleDir, 'lane-vs.json'), []);
  writeJson(join(roleDir, 'lane-full.json'), []);
}

function active(): FixtureContext {
  if (context === undefined) throw new Error('Fixture context is not initialized');
  return context;
}

beforeEach(() => {
  const directory = mkdtempSync(join(tmpdir(), 'draftorb-sample-check-'));
  context = {
    directory,
    publicDir: join(directory, 'public'),
    tagsFilePath: join(directory, 'champion-tags.json'),
  };
  writeJson(active().tagsFilePath, {});
});

afterEach(() => {
  if (context !== undefined) {
    rmSync(context.directory, { recursive: true, force: true });
    context = undefined;
  }
});

describe('checkPublishedExport', () => {
  it('passes when every exported role yields recommendations', () => {
    // gamesW=50, gamesW2=0.1 -> n_eff = 25000, well above minGames (25).
    writeExport(active().publicDir, [
      [412, 'DIAMOND', 30, 50, 0.1, 50],
      [432, 'DIAMOND', 25, 50, 0.1, 50],
    ]);

    const result = checkPublishedExport({
      publicDir: active().publicDir,
      tagsFilePath: active().tagsFilePath,
    });

    expect(result.patch).toBe(PATCH);
    expect(result.roles).toEqual(['SUPPORT']);
    expect(result.recommendationCounts['SUPPORT']).toBeGreaterThan(0);
    expect(result.errors).toEqual([]);
  });

  it('reports an error when a role yields zero recommendations (B-052 regression)', () => {
    writeExport(active().publicDir, []);

    const result = checkPublishedExport({
      publicDir: active().publicDir,
      tagsFilePath: active().tagsFilePath,
    });

    expect(result.recommendationCounts['SUPPORT']).toBe(0);
    expect(result.errors).toEqual(['No "Best overall" recommendations for role SUPPORT.']);
  });

  it('warns but does not fail when a non-enabled role yields zero recommendations', () => {
    writeExport(active().publicDir, [
      [412, 'DIAMOND', 30, 50, 0.1, 50],
      [432, 'DIAMOND', 25, 50, 0.1, 50],
    ]);
    const patchDir = join(active().publicDir, PATCH);
    const topFiles = ['baseline', 'ally-pairs', 'enemy-pairs', 'lane-vs', 'lane-full'].map(
      (name) => `roles/TOP/${name}.json`,
    );
    for (const path of topFiles) writeJson(join(patchDir, path), []);
    const manifestPath = join(patchDir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      roles: string[];
      files: { path: string }[];
    };
    manifest.roles = ['SUPPORT', 'TOP'];
    manifest.files.push(...topFiles.map((path) => ({ path })));
    writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8');

    const result = checkPublishedExport({
      publicDir: active().publicDir,
      tagsFilePath: active().tagsFilePath,
    });

    expect(result.recommendationCounts['SUPPORT']).toBeGreaterThan(0);
    expect(result.recommendationCounts['TOP']).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      'Role SUPPORT: 2 champions pass the D-126 coverage gate (< 50 at n_eff >= 25 in DIAMOND); the role stays disabled in the app.',
      'No "Best overall" recommendations for role TOP. (not enabled in the app; not release-blocking)',
      'Role TOP: 0 champions pass the D-126 coverage gate (< 50 at n_eff >= 25 in DIAMOND); the role stays disabled in the app.',
    ]);
  });

  it('warns when a role fails the D-126 baseline coverage gate', () => {
    writeExport(active().publicDir, [
      [412, 'DIAMOND', 30, 50, 0.1, 50],
      [432, 'DIAMOND', 25, 50, 0.1, 50],
    ]);

    const result = checkPublishedExport({
      publicDir: active().publicDir,
      tagsFilePath: active().tagsFilePath,
    });

    expect(result.warnings).toContain(
      'Role SUPPORT: 2 champions pass the D-126 coverage gate (< 50 at n_eff >= 25 in DIAMOND); the role stays disabled in the app.',
    );
  });

  it('does not warn when baseline coverage reaches the D-126 gate', () => {
    const publicDir = join(active().directory, 'public-coverage');
    const baseline = Array.from({ length: 50 }, (_, i) => [1000 + i, 'DIAMOND', 30, 50, 0.1, 50]);
    writeExport(publicDir, baseline);

    const result = checkPublishedExport({
      publicDir,
      tagsFilePath: active().tagsFilePath,
    });

    expect(result.warnings.some((w) => w.includes('coverage gate'))).toBe(false);
  });

  it('validates minimal roles from baseline.json alone (BL-024)', () => {
    writeExport(active().publicDir, [
      [412, 'DIAMOND', 30, 50, 0.1, 50],
      [432, 'DIAMOND', 25, 50, 0.1, 50],
    ]);
    const patchDir = join(active().publicDir, PATCH);
    // ADC is a minimal role: only baseline.json exists, no pair/lane files.
    writeJson(join(patchDir, 'roles', 'ADC', 'baseline.json'), [[412, 'DIAMOND', 30, 50, 0.1, 50]]);
    writeJson(join(patchDir, 'role-prob.json'), { '412': { ADC: 1 }, '432': { SUPPORT: 1 } });
    const manifestPath = join(patchDir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      roles: string[];
      minimalRoles: string[];
      files: { path: string }[];
    };
    manifest.roles = ['SUPPORT', 'ADC'];
    manifest.minimalRoles = ['ADC'];
    manifest.files.push({ path: 'roles/ADC/baseline.json' });
    writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8');

    const result = checkPublishedExport({
      publicDir: active().publicDir,
      tagsFilePath: active().tagsFilePath,
    });

    expect(result.recommendationCounts['ADC']).toBeGreaterThan(0);
    expect(result.errors).toEqual([]);
  });

  it('throws when a required export file is missing from the manifest', () => {
    writeExport(active().publicDir, [[412, 'DIAMOND', 30, 50, 0.1, 50]]);
    // Remove lane-vs.json from the manifest files list.
    const manifestPath = join(active().publicDir, PATCH, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      files: { path: string }[];
    };
    manifest.files = manifest.files.filter((f) => f.path !== 'roles/SUPPORT/lane-vs.json');
    writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8');

    expect(() =>
      checkPublishedExport({
        publicDir: active().publicDir,
        tagsFilePath: active().tagsFilePath,
      }),
    ).toThrow('Required export file is missing: roles/SUPPORT/lane-vs.json');
  });
});
