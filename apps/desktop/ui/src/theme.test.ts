import { describe, expect, it } from 'vitest';
import { resolveTheme, toggledTheme } from './theme';

describe('resolveTheme', () => {
  it.each([
    ['system', true, 'dark'],
    ['system', false, 'light'],
    ['light', true, 'light'],
    ['light', false, 'light'],
    ['dark', true, 'dark'],
    ['dark', false, 'dark'],
  ] as const)('%s with prefersDark=%s -> %s', (setting, prefersDark, expected) => {
    expect(resolveTheme(setting, prefersDark)).toBe(expected);
  });

  it('toggling flips the resolved theme into an explicit choice', () => {
    expect(toggledTheme('dark')).toBe('light');
    expect(toggledTheme('light')).toBe('dark');
  });
});
