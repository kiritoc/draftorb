import { useCallback, useEffect, useState } from 'react';
import type { Role } from '@draftorb/shared';
import { AppShell } from './components/AppShell';
import type { ScreenId } from './components/Nav';
import type { DataStatus } from './data-status';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from './settings';
import { resolveTheme, toggledTheme, type ThemeSetting } from './theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';
const NO_DATA: DataStatus = { kind: 'none' };

function usePrefersDark(): boolean {
  const [prefersDark, setPrefersDark] = useState(() => window.matchMedia(DARK_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return prefersDark;
}

export function App() {
  const [screen, setScreen] = useState<ScreenId>('pick');
  const [role, setRole] = useState<Role>('SUPPORT');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [notice, setNotice] = useState<string | undefined>();
  const prefersDark = usePrefersDark();
  const resolvedTheme = resolveTheme(settings.theme, prefersDark);

  useEffect(() => {
    void loadSettings().then((loaded) => {
      setSettings(loaded.settings);
      setNotice(loaded.notice);
    });
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
  }, [resolvedTheme]);

  const changeTheme = useCallback((theme: ThemeSetting) => {
    const next: Settings = { version: 1, theme };
    setSettings(next);
    void saveSettings(next).catch(() => {});
  }, []);

  return (
    <AppShell
      screen={screen}
      onScreenChange={setScreen}
      dataStatus={NO_DATA}
      theme={settings.theme}
      resolvedTheme={resolvedTheme}
      onThemeChange={changeTheme}
      onToggleTheme={() => changeTheme(toggledTheme(resolvedTheme))}
      role={role}
      onRoleChange={setRole}
      notice={notice}
    />
  );
}
