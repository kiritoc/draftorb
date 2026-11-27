import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sampleReportCommand } from './sample-report';

const MANIFEST = {
  patch: '16.22',
  generatedAt: '2026-11-26T00:00:00.000Z',
  region: 'euw1',
  rankBuckets: [
    'IRON',
    'BRONZE',
    'SILVER',
    'GOLD',
    'PLATINUM',
    'EMERALD',
    'DIAMOND',
    'MASTER_PLUS',
  ],
  roles: ['SUPPORT', 'TOP', 'JUNGLE'],
  minimalRoles: [],
  schemaVersion: 5,
  files: [
    { path: 'roles/TOP/baseline.json', sha256: 'x'.repeat(64) },
    { path: 'roles/JUNGLE/baseline.json', sha256: 'x'.repeat(64) },
  ],
};

describe('sampleReportCommand', () => {
  let directory: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  const originalPublicDir = process.env.DRAFTORB_PUBLIC_DIR;

  const writeExport = (patchDir: string): void => {
    const root = join(directory, 'public', patchDir);
    mkdirSync(join(root, 'roles', 'TOP'), { recursive: true });
    mkdirSync(join(root, 'roles', 'JUNGLE'), { recursive: true });
    writeFileSync(join(root, 'manifest.json'), JSON.stringify(MANIFEST));
    writeFileSync(
      join(root, 'roles', 'TOP', 'baseline.json'),
      JSON.stringify([
        [412, 'IRON', 6, 10, 10, 3],
        [99, 'GOLD', 1, 4, 4],
      ]),
    );
    writeFileSync(
      join(root, 'roles', 'JUNGLE', 'baseline.json'),
      JSON.stringify([[64, 'DIAMOND', 9, 12, 12]]),
    );
  };

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'draftorb-sample-report-'));
    process.env.DRAFTORB_PUBLIC_DIR = join(directory, 'public');
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    if (originalPublicDir === undefined) {
      delete process.env.DRAFTORB_PUBLIC_DIR;
    } else {
      process.env.DRAFTORB_PUBLIC_DIR = originalPublicDir;
    }
    rmSync(directory, { recursive: true, force: true });
  });

  const output = (): string => logSpy.mock.calls.map((call) => String(call[0])).join('\n');

  it('prints per-file rows and n_eff stats for the latest patch', async () => {
    writeExport('16.22');
    writeFileSync(
      join(directory, 'public', 'latest.json'),
      JSON.stringify({
        schemaVersion: 1,
        patch: '16.22',
        manifest: '16.22/manifest.json',
        generatedAt: '2026-11-26T00:00:00.000Z',
      }),
    );

    await sampleReportCommand.run([]);

    expect(output()).toContain('patch 16.22');
    expect(output()).toContain('TOP: 2 row(s)');
    expect(output()).toContain('roles/TOP/baseline.json: 2 row(s)');
    expect(output()).toContain('n_eff min 4.00, median 7.00, max 10.00');
    expect(output()).toContain('JUNGLE: 1 row(s)');
    expect(output()).toContain('roles/JUNGLE/baseline.json: 1 row(s)');
  });

  it('accepts an explicit patch', async () => {
    writeExport('16.21');
    const manifest = { ...MANIFEST, patch: '16.21' };
    writeFileSync(join(directory, 'public', '16.21', 'manifest.json'), JSON.stringify(manifest));

    await sampleReportCommand.run(['16.21']);
    expect(output()).toContain('patch 16.21');
  });

  it('fails clearly when nothing is exported', async () => {
    await expect(sampleReportCommand.run([])).rejects.toThrow(/no latest\.json/);
    await expect(sampleReportCommand.run(['16.22'])).rejects.toThrow(/no manifest/);
  });
});
