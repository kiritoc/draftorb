import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeCommand = vi.fn();
vi.mock('../tauri', () => ({
  isTauri: () => true,
  invokeCommand: (...a: unknown[]) => invokeCommand(...a),
}));

import { emptyPool, setChampionRoles, serializePoolConfig } from './pool-model';
import { exportPoolToRepo, readRepoPool } from './repo-pool';
import { loadPool, savePool } from './pool-store';

describe('pool store', () => {
  beforeEach(() => invokeCommand.mockReset());

  it('treats an empty stored file as a first launch (no notice)', async () => {
    invokeCommand.mockResolvedValueOnce('');
    expect(await loadPool()).toEqual({ pool: emptyPool() });
    expect(invokeCommand).toHaveBeenCalledWith('load_app_file', { name: 'pool.json' });
  });

  it('saves the serialized pool to pool.json and reloads it', async () => {
    const pool = setChampionRoles(emptyPool(), 1, ['SUPPORT'], 'Annie').pool;
    invokeCommand.mockResolvedValueOnce(undefined);
    await savePool(pool);
    const args = invokeCommand.mock.calls[0]?.[1] as { name: string; json: string };
    expect(args.name).toBe('pool.json');
    invokeCommand.mockResolvedValueOnce(args.json);
    expect(await loadPool()).toEqual({ pool });
  });

  it('gives an empty pool and a notice for a corrupt file or an IPC error', async () => {
    invokeCommand.mockResolvedValueOnce('{oops');
    expect((await loadPool()).notice).toBeTruthy();
    invokeCommand.mockRejectedValueOnce('boom');
    expect((await loadPool()).notice).toBeTruthy();
  });
});

describe('repo pool', () => {
  beforeEach(() => invokeCommand.mockReset());
  const pool = setChampionRoles(emptyPool(), 7, ['TOP']).pool;

  it('reports a missing file without a notice', async () => {
    invokeCommand.mockResolvedValueOnce(null);
    expect(await readRepoPool('/r')).toEqual({ pool: emptyPool(), missing: true });
    expect(invokeCommand).toHaveBeenCalledWith('read_repo_pool', { repoFolder: '/r' });
  });

  it('parses an existing file', async () => {
    invokeCommand.mockResolvedValueOnce(serializePoolConfig(pool));
    expect(await readRepoPool('/r')).toEqual({ pool, missing: false });
  });

  it('ignores an invalid file with a notice, and turns Err into a notice', async () => {
    invokeCommand.mockResolvedValueOnce('nope');
    const invalid = await readRepoPool('/r');
    expect(invalid.pool).toEqual(emptyPool());
    expect(invalid.notice).toContain('invalid');
    invokeCommand.mockRejectedValueOnce('not a DraftOrb repo folder: data/ missing');
    expect((await readRepoPool('/r')).notice).toBe('not a DraftOrb repo folder: data/ missing');
  });

  it('exports the serialized pool', async () => {
    invokeCommand.mockResolvedValueOnce(undefined);
    await exportPoolToRepo('/r', pool);
    expect(invokeCommand).toHaveBeenCalledWith('write_repo_pool', {
      repoFolder: '/r',
      json: serializePoolConfig(pool),
    });
  });
});
