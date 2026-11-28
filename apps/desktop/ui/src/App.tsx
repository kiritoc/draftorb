import { useCallback, useEffect, useState } from 'react';
import type { Role } from '@draftorb/shared';
import { AppShell } from './components/AppShell';
import { ROLE_ORDER } from './config';
import type { ScreenId } from './components/Nav';
import type { DataStatus } from './data-status';
import type { DraftHandoff } from './draft-handoff';
import { ensureData } from './data/aggregates';
import { loadEnabledRoles } from './data/role-coverage';
import { describeProfileLoad, loadProfileExport, type ProfileLoad } from './profile/profile-export';
import { loadPool } from './pool/pool-store';
import { poolSyncStatus, type PoolSyncStatus } from './pool/pool-sync';
import { readRepoPool } from './pool/repo-pool';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  persistThemeChoice,
  saveRepoFolder,
  type Settings,
} from './settings';
import { isTauri } from './tauri';
import { defaultRole } from './roles';
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
  const [settings, setSettings] = useState<Settings | null>(null);
  const [notice, setNotice] = useState<string | undefined>();
  const [poolNotice, setPoolNotice] = useState<string | undefined>();
  const [poolSync, setPoolSync] = useState<PoolSyncStatus>({ kind: 'noFolder' });
  const [profileLoad, setProfileLoad] = useState<ProfileLoad>({ kind: 'none', reason: 'noFolder' });
  const [dataStatus, setDataStatus] = useState<DataStatus>(NO_DATA);
  const [dataReadyNonce, setDataReadyNonce] = useState(0);
  const [enabledRoles, setEnabledRoles] = useState<readonly Role[] | undefined>(undefined);
  // BL-055: "New game" flow — dialog open state plus a nonce that remounts
  // the Pick/Setup screens so every per-game field returns to defaults.
  const [newGameOpen, setNewGameOpen] = useState(false);
  const [gameResetNonce, setGameResetNonce] = useState(0);
  // BL-058: draft context handed off from the pick screen to the setup
  // screen. Lives here (not in AppShell) so AppShell stays hook-free; the
  // remounted PickScreen re-reports a fresh empty handoff after a reset.
  const [draftHandoff, setDraftHandoff] = useState<DraftHandoff | undefined>(undefined);
  const prefersDark = usePrefersDark();
  const resolvedTheme = settings === null ? null : resolveTheme(settings.theme, prefersDark);

  useEffect(() => {
    void loadSettings().then((loaded) => {
      setSettings(loaded.settings);
      setNotice(loaded.notice);
    });
    void ensureData().then((status) => {
      setDataStatus(status);
      setDataReadyNonce((nonce) => nonce + 1);
    });
  }, []);

  // Role enablement is a dataset property (D-126): recompute whenever the
  // launch download settles. Until a verdict exists the selector falls back
  // to DEFAULT_ENABLED_ROLES.
  useEffect(() => {
    let cancelled = false;
    void loadEnabledRoles()
      .then((roles) => {
        if (!cancelled && roles !== null) setEnabledRoles(roles);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [dataReadyNonce]);

  // Keep the user's pick while it is eligible; otherwise fall back to the
  // first eligible role. null = confirmed empty verdict (no eligible role).
  const activeRole: Role | null =
    enabledRoles === undefined || enabledRoles.includes(role)
      ? role
      : (ROLE_ORDER.find((r) => enabledRoles.includes(r)) ?? null);

  const repoFolder = settings?.repoFolder;
  const settingsLoaded = settings !== null;
  const refreshPoolSync = useCallback(async () => {
    const program = await loadPool();
    const repo = repoFolder === undefined ? null : await readRepoPool(repoFolder);
    setPoolNotice(program.notice);
    setPoolSync(poolSyncStatus(program.pool, repo));
  }, [repoFolder]);
  useEffect(() => {
    if (!settingsLoaded) return;
    void refreshPoolSync();
  }, [settingsLoaded, refreshPoolSync]);

  useEffect(() => {
    if (!settingsLoaded) return;
    let cancelled = false;
    void loadProfileExport(repoFolder).then((load) => {
      if (!cancelled) setProfileLoad(load);
    });
    return () => {
      cancelled = true;
    };
  }, [settingsLoaded, repoFolder]);

  const saveFolder = useCallback(
    async (value: string): Promise<string | undefined> => {
      const result = await saveRepoFolder(settings ?? DEFAULT_SETTINGS, value);
      setSettings(result.settings);
      return result.error;
    },
    [settings],
  );

  useEffect(() => {
    if (resolvedTheme === null) return;
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
  }, [resolvedTheme]);

  const changeTheme = useCallback(
    (theme: ThemeSetting) => {
      const next: Settings = { ...(settings ?? DEFAULT_SETTINGS), theme };
      setSettings(next);
      void persistThemeChoice(theme, next).catch(() => {});
    },
    [settings],
  );

  // BL-055: confirmed reset — role back to the default eligible one, screens
  // remount on the next render. Pool, settings, profile and aggregates live
  // outside the remounted trees and are untouched; the current screen and
  // the nav selection do not change. BL-058: the draft handoff is cleared
  // too, and the remounted PickScreen re-reports its empty draft anyway.
  const confirmNewGame = useCallback(() => {
    setNewGameOpen(false);
    setRole(defaultRole(enabledRoles));
    setDraftHandoff(undefined);
    setGameResetNonce((nonce) => nonce + 1);
  }, [enabledRoles]);

  // Render nothing until the stored theme is known: no wrong-theme flash.
  if (settings === null || resolvedTheme === null) return null;

  return (
    <AppShell
      screen={screen}
      onScreenChange={setScreen}
      dataStatus={dataStatus}
      dataReadyNonce={dataReadyNonce}
      theme={settings.theme}
      resolvedTheme={resolvedTheme}
      onThemeChange={changeTheme}
      onToggleTheme={() => changeTheme(toggledTheme(resolvedTheme))}
      role={activeRole}
      onRoleChange={setRole}
      enabledRoles={enabledRoles}
      notice={notice ?? poolNotice}
      poolSync={poolSync}
      repoFolder={settings.repoFolder}
      onSaveRepoFolder={saveFolder}
      onPoolChanged={() => void refreshPoolSync()}
      repoFolderAvailable={isTauri()}
      profileStatus={describeProfileLoad(profileLoad)}
      profileLoad={profileLoad}
      gameResetNonce={gameResetNonce}
      newGameOpen={newGameOpen}
      onNewGameOpenChange={setNewGameOpen}
      onNewGameConfirm={confirmNewGame}
      draftHandoff={draftHandoff}
      onDraftHandoffChange={setDraftHandoff}
    />
  );
}
