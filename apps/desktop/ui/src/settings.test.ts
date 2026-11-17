import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings, serializeSettings } from './settings';

describe('parseSettings', () => {
  it('accepts valid settings without a notice', () => {
    expect(parseSettings('{"version":1,"theme":"dark"}')).toEqual({
      settings: { version: 1, theme: 'dark' },
    });
  });

  it('treats an empty string as a first launch (defaults, no notice)', () => {
    expect(parseSettings('')).toEqual({ settings: DEFAULT_SETTINGS });
  });

  it.each(['{', 'null', '{"version":2,"theme":"dark"}', '{"version":1,"theme":"neon"}', '[]'])(
    'resets %s to defaults with a notice',
    (raw) => {
      const parsed = parseSettings(raw);
      expect(parsed.settings).toEqual(DEFAULT_SETTINGS);
      expect(parsed.notice).toBe('Settings were reset: the file was unreadable');
    },
  );

  it('round-trips through serialize', () => {
    const settings = { version: 1, theme: 'light' } as const;
    expect(parseSettings(serializeSettings(settings))).toEqual({ settings });
  });
});

describe('repoFolder setting', () => {
  it('stays valid without it and accepts it when present', () => {
    expect(parseSettings('{"version":1,"theme":"dark"}').settings.repoFolder).toBeUndefined();
    const parsed = parseSettings(
      '{"version":1,"theme":"dark","repoFolder":"C:\\\\dev\\\\draftorb"}',
    );
    expect(parsed.notice).toBeUndefined();
    expect(parsed.settings.repoFolder).toBe('C:\\dev\\draftorb');
  });

  it('rejects an empty folder string', () => {
    expect(parseSettings('{"version":1,"theme":"dark","repoFolder":""}').notice).toBeTruthy();
  });
});
