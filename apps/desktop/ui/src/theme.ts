export type ThemeSetting = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_SETTINGS: readonly ThemeSetting[] = ['system', 'light', 'dark'];

/** `system` follows the OS preference; an explicit choice always wins (D-107). */
export function resolveTheme(setting: ThemeSetting, prefersDark: boolean): ResolvedTheme {
  if (setting === 'system') return prefersDark ? 'dark' : 'light';
  return setting;
}

/** The header toggle flips the resolved theme and stores it as an explicit choice. */
export function toggledTheme(resolved: ResolvedTheme): ThemeSetting {
  return resolved === 'dark' ? 'light' : 'dark';
}
