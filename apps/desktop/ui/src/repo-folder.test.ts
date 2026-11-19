import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeCommand = vi.fn();
vi.mock('./tauri', () => ({
  isTauri: () => true,
  invokeCommand: (...a: unknown[]) => invokeCommand(...a),
}));

import { saveRepoFolder, type Settings } from './settings';

const current: Settings = { version: 1, theme: 'dark', repoFolder: '/old' };

describe('saveRepoFolder', () => {
  beforeEach(() => invokeCommand.mockReset());

  it('clears the setting on an empty value without checking the folder', async () => {
    invokeCommand.mockResolvedValueOnce(undefined);
    const result = await saveRepoFolder(current, '   ');
    expect(result.settings).toEqual({ version: 1, theme: 'dark' });
    expect(invokeCommand).toHaveBeenCalledTimes(1);
    expect(invokeCommand).toHaveBeenCalledWith('save_app_file', {
      name: 'settings.json',
      json: '{"version":1,"theme":"dark"}',
    });
  });

  it('checks then stores a trimmed valid folder, keeping other settings', async () => {
    invokeCommand.mockResolvedValue(undefined);
    const result = await saveRepoFolder(current, ' /new ');
    expect(invokeCommand).toHaveBeenNthCalledWith(1, 'check_repo_folder', { repoFolder: '/new' });
    expect(result).toEqual({ settings: { version: 1, theme: 'dark', repoFolder: '/new' } });
  });

  it('keeps the old value and reports the error for an invalid folder', async () => {
    invokeCommand.mockRejectedValueOnce('not a DraftOrb repo folder: data/ missing');
    const result = await saveRepoFolder(current, '/nope');
    expect(result).toEqual({
      settings: current,
      error: 'not a DraftOrb repo folder: data/ missing',
    });
    expect(invokeCommand).toHaveBeenCalledTimes(1);
  });
});
