/**
 * loadPickData recovery (BL-050): a corrupt file under another role's folder
 * must not break the selected role; the selected role's own files and shared
 * files still fail loudly.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./aggregates', () => ({
  cacheRead: vi.fn(),
}));

import { cacheRead } from './aggregates';
import { loadPickData } from './export-data';

const mockRead = vi.mocked(cacheRead);

const ROLE_FILES = ['baseline', 'ally-pairs', 'enemy-pairs', 'lane-vs', 'lane-full'];

function seedCache(corruptPath: string): void {
  const patchFiles: Record<string, string> = {
    'champions.json': '{}',
    'role-prob.json': '{}',
  };
  for (const role of ['SUPPORT', 'TOP']) {
    for (const name of ROLE_FILES) patchFiles[`roles/${role}/${name}.json`] = '[]';
  }
  patchFiles[corruptPath] = '{not json';

  const manifest = {
    patch: '16.22',
    generatedAt: '2026-11-26T00:00:00Z',
    schemaVersion: 5,
    region: 'euw',
    rankBuckets: ['DIAMOND'],
    roles: ['SUPPORT', 'TOP'],
    minimalRoles: [],
    files: Object.keys(patchFiles).map((path) => ({ path, sha256: '0'.repeat(64) })),
  };
  const byPath: Record<string, string> = {
    'latest.json': JSON.stringify({
      schemaVersion: 1,
      patch: '16.22',
      manifest: '16.22/manifest.json',
      generatedAt: '2026-11-26T00:00:00Z',
    }),
    '16.22/manifest.json': JSON.stringify(manifest),
    'champion-tags.json': '{}',
    ...Object.fromEntries(Object.entries(patchFiles).map(([p, v]) => [`16.22/${p}`, v])),
  };
  mockRead.mockImplementation(async (name: string) => byPath[name] ?? null);
}

describe('loadPickData recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads a healthy role when another role's file is corrupt", async () => {
    seedCache('roles/SUPPORT/baseline.json');
    const loaded = await loadPickData('TOP');
    expect(loaded?.patch).toBe('16.22');
  });

  it("still fails when the selected role's own file is corrupt", async () => {
    seedCache('roles/TOP/baseline.json');
    await expect(loadPickData('TOP')).rejects.toThrow();
  });

  it('still fails when a shared file is corrupt', async () => {
    seedCache('role-prob.json');
    await expect(loadPickData('TOP')).rejects.toThrow();
  });
});
