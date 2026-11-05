import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadChampionTags, loadChampions, loadExportFiles, loadLatest, loadManifest } from './loader';
import { manifestSchema } from '@draftorb/shared';

const originalFetch = globalThis.fetch;

const latestJson = {
  schemaVersion: 1,
  patch: '16.21',
  manifest: '16.21/manifest.json',
  generatedAt: '2026-11-04T16:47:00.000Z',
};

const manifestJson = {
  schemaVersion: 3,
  patch: '16.21',
  generatedAt: '2026-11-04T16:47:00.000Z',
  region: 'euw1',
  rankBuckets: ['IRON', 'MASTER_PLUS'],
  roles: ['SUPPORT'],
  files: [
    { path: 'role-prob.json', sha256: 'abc' },
    { path: 'roles/SUPPORT/baseline.json', sha256: 'def' },
  ],
};

describe('data loader', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('loads latest.json and validates its schema', async () => {
    const calls: string[] = [];
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: RequestInfo | URL): Promise<Response> => {
        calls.push(String(input));
        return new Response(JSON.stringify(latestJson), { status: 200 });
      },
    );
    const latest = await loadLatest();
    expect(latest.patch).toBe('16.21');
    expect(latest.manifest).toBe('16.21/manifest.json');
    expect(calls).toEqual(['latest.json']);
  });

  it('rejects a malformed latest.json', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ schemaVersion: 99, patch: '', manifest: '', generatedAt: '' }), {
        status: 200,
      }),
    );
    await expect(loadLatest()).rejects.toThrow();
  });

  it('loads the manifest referenced by latest', async () => {
    const calls: string[] = [];
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: RequestInfo | URL): Promise<Response> => {
        const url = String(input);
        calls.push(url);
        const body = url === 'latest.json' ? latestJson : manifestJson;
        return new Response(JSON.stringify(body), { status: 200 });
      },
    );
    const latest = await loadLatest();
    const manifest = await loadManifest(latest.manifest);
    expect(manifest.patch).toBe('16.21');
    expect(manifest.roles).toEqual(['SUPPORT']);
    expect(calls).toEqual(['latest.json', '16.21/manifest.json']);
  });

  it('loads export files relative to the manifest patch', async () => {
    const calls: string[] = [];
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: RequestInfo | URL): Promise<Response> => {
        const url = String(input);
        calls.push(url);
        if (url === '16.21/role-prob.json') {
          return new Response(JSON.stringify({ '412': { SUPPORT: 1 } }), { status: 200 });
        }
        return new Response(JSON.stringify([[412, 'IRON', 6, 10, 10, 3]]), { status: 200 });
      },
    );

    const manifest = manifestSchema.parse({
      ...manifestJson,
      files: [
        { path: 'role-prob.json', sha256: 'abc' },
        { path: 'roles/SUPPORT/baseline.json', sha256: 'def' },
      ],
    });
    const result = await loadExportFiles(manifest);

    expect(calls).toEqual([
      '16.21/role-prob.json',
      '16.21/roles/SUPPORT/baseline.json',
    ]);
    expect(result.files['roles/SUPPORT/baseline.json']).toEqual([
      [412, 'IRON', 6, 10, 10, 3],
    ]);
  });

  it('rejects when an export file fails to load', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: RequestInfo | URL): Promise<Response> => {
        const url = String(input);
        if (url === '16.21/roles/SUPPORT/baseline.json') {
          return new Response('not found', { status: 404 });
        }
        return new Response(JSON.stringify([[412, 'IRON', 6, 10, 10, 3]]), { status: 200 });
      },
    );

    const manifest = manifestSchema.parse(manifestJson);
    await expect(loadExportFiles(manifest)).rejects.toThrow(/Failed to load/);
  });

  it('propagates a failed fetch as an error', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('network down'),
    );
    await expect(loadLatest()).rejects.toThrow(/network down/);
  });

  it('loads the champion catalogue for a patch', async () => {
    const championsMap = {
      '412': { id: 412, name: 'Soraka', icon: 'Soraka.png', roles: ['SUPPORT'] },
      '1': { id: 1, name: 'Annie', icon: 'Annie.png', roles: ['MID', 'SUPPORT'] },
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(championsMap), { status: 200 }),
    );
    const champions = await loadChampions('16.21');
    expect(champions).toHaveLength(2);
    expect(champions.map((c) => c.name).sort()).toEqual(['Annie', 'Soraka']);
    expect(globalThis.fetch).toHaveBeenCalledWith('16.21/champions.json');
  });

  it('loads and validates manual champion tags', async () => {
    const tags = {
      '412': {
        championId: 412,
        damageType: 'AP',
        archetype: 'enchanter',
        hardEngage: false,
        peel: true,
        poke: false,
        waveclear: false,
        scaling: { early: false, mid: true, late: true },
        range: 'RANGED',
        ccCount: 1,
      },
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(tags), { status: 200 }),
    );
    await expect(loadChampionTags()).resolves.toEqual(tags);
    expect(globalThis.fetch).toHaveBeenCalledWith('champion-tags.json');
  });
});
