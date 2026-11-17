import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeCommand = vi.fn();
vi.mock('./tauri', () => ({
  isTauri: () => true,
  invokeCommand: (...a: unknown[]) => invokeCommand(...a),
}));

import { loadSettings, persistThemeChoice } from './settings';
import { resolveTheme } from './theme';

async function startupTheme(stored: string, prefersDark: boolean) {
  invokeCommand.mockResolvedValueOnce(stored);
  const { settings } = await loadSettings();
  return resolveTheme(settings.theme, prefersDark);
}

describe('theme at startup (D-107)', () => {
  beforeEach(() => invokeCommand.mockReset());

  it('a fresh profile follows the OS theme', async () => {
    expect(await startupTheme('', true)).toBe('dark');
    expect(await startupTheme('', false)).toBe('light');
  });

  it('a stored explicit choice wins over the OS theme', async () => {
    expect(await startupTheme('{"version":1,"theme":"light"}', true)).toBe('light');
    expect(await startupTheme('{"version":1,"theme":"dark"}', false)).toBe('dark');
  });

  it('a choice survives a restart', async () => {
    invokeCommand.mockResolvedValueOnce(undefined);
    await persistThemeChoice('light');
    expect(invokeCommand).toHaveBeenCalledWith('save_app_file', {
      name: 'settings.json',
      json: '{"version":1,"theme":"light"}',
    });
    const saved = (invokeCommand.mock.calls[0]?.[1] as { json: string }).json;
    expect(await startupTheme(saved, true)).toBe('light');
  });
});

describe('repoFolder preservation', () => {
  it('keeps repoFolder when the theme changes', async () => {
    invokeCommand.mockReset();
    invokeCommand.mockResolvedValueOnce(undefined);
    await persistThemeChoice('dark', { version: 1, theme: 'light', repoFolder: '/repo' });
    expect(invokeCommand).toHaveBeenCalledWith('save_app_file', {
      name: 'settings.json',
      json: '{"version":1,"theme":"dark","repoFolder":"/repo"}',
    });
  });
});
