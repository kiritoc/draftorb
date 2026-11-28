import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeCommand = vi.fn();
let tauri = true;
vi.mock('../tauri', () => ({
  isTauri: () => tauri,
  invokeCommand: (...a: unknown[]) => invokeCommand(...a),
}));

import { describeProfileLoad, loadProfileExport, syncedDate } from './profile-export';
import { makeIndex, makeProfile } from './test-fixtures';

const files = (map: Record<string, string | null | Error>) =>
  invokeCommand.mockImplementation(async (_cmd: string, args: { fileName: string }) => {
    const value = map[args.fileName];
    if (value instanceof Error) throw value;
    return value ?? null;
  });

describe('loadProfileExport', () => {
  beforeEach(() => {
    invokeCommand.mockReset();
    tauri = true;
  });

  it('is none/noFolder without a folder or outside the desktop program', async () => {
    expect(await loadProfileExport(undefined)).toEqual({ kind: 'none', reason: 'noFolder' });
    tauri = false;
    expect(await loadProfileExport('/r')).toEqual({ kind: 'none', reason: 'noFolder' });
  });

  it('is none/missing without index.json, with an empty index or without the profile file', async () => {
    files({});
    expect(await loadProfileExport('/r')).toEqual({ kind: 'none', reason: 'missing' });
    files({ 'index.json': JSON.stringify({ schemaVersion: 1, profiles: [] }) });
    expect(await loadProfileExport('/r')).toEqual({ kind: 'none', reason: 'missing' });
    files({ 'index.json': JSON.stringify(makeIndex()) });
    expect(await loadProfileExport('/r')).toEqual({ kind: 'none', reason: 'missing' });
  });

  it('is invalid for bad JSON, schema failures and read errors, naming the file', async () => {
    files({ 'index.json': '{oops' });
    expect(await loadProfileExport('/r')).toEqual({
      kind: 'invalid',
      notice: expect.stringContaining('index.json'),
    });
    files({ 'index.json': '{"schemaVersion":1}' });
    expect((await loadProfileExport('/r')).kind).toBe('invalid');
    files({ 'index.json': JSON.stringify(makeIndex()), 'kiritoctoc-euw1.json': '{"x":1}' });
    const bad = await loadProfileExport('/r');
    expect(bad).toEqual({
      kind: 'invalid',
      notice: expect.stringContaining('kiritoctoc-euw1.json'),
    });
    files({ 'index.json': new Error('denied') });
    expect((await loadProfileExport('/r')).kind).toBe('invalid');
  });

  it('loads a schema v1 export, normalizing favorites to the SUPPORT role', async () => {
    const profile = makeProfile([{ championId: 1, role: 'SUPPORT', win: true }]);
    // Pre-BL-057 shape: schemaVersion 1, single SUPPORT-scoped favorites list.
    const v1 = {
      ...profile,
      schemaVersion: 1,
      favorites: { combined: [1], recency: [1], mastery: [] },
    };
    files({
      'index.json': JSON.stringify({ ...makeIndex(), schemaVersion: 1 }),
      'kiritoctoc-euw1.json': JSON.stringify(v1),
    });
    const load = await loadProfileExport('/r');
    expect(load.kind).toBe('loaded');
    if (load.kind !== 'loaded') return;
    expect(load.profile.schemaVersion).toBe(3);
    expect(load.profile.favorites.SUPPORT?.combined).toEqual([1]);
  });

  it('loads the first profile on the happy path', async () => {
    const profile = makeProfile([{ championId: 1, role: 'SUPPORT', win: true }]);
    files({
      'index.json': JSON.stringify(makeIndex()),
      'kiritoctoc-euw1.json': JSON.stringify(profile),
    });
    const load = await loadProfileExport('/r');
    expect(load).toEqual({ kind: 'loaded', profile });
    expect(invokeCommand).toHaveBeenCalledWith('read_profile_file', {
      repoFolder: '/r',
      fileName: 'kiritoctoc-euw1.json',
    });
  });
});

describe('profile status text', () => {
  it('formats syncedAt (unix seconds) as a date', () => {
    expect(syncedDate(1794900000)).toBe('2026-11-17');
  });

  it('describes loaded, missing and no-folder states', () => {
    const profile = makeProfile([]);
    expect(describeProfileLoad({ kind: 'loaded', profile })).toBe(
      "KiriToc's picks · 0 games · synced 2026-11-17",
    );
    expect(describeProfileLoad({ kind: 'none', reason: 'missing' })).toContain('pnpm etl pull');
    expect(describeProfileLoad({ kind: 'none', reason: 'noFolder' })).toContain('repo folder');
  });
});
