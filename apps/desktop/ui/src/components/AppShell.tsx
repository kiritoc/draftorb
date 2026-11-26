import type { Role } from '@draftorb/shared';
import type { DataStatus } from '../data-status';
import { strings } from '../strings';
import type { ResolvedTheme, ThemeSetting } from '../theme';
import { Header } from './Header';
import { Nav, type ScreenId } from './Nav';
import { PoolSyncBanner } from './PoolSyncBanner';
import type { PoolSyncStatus } from '../pool/pool-sync';
import type { ProfileLoad } from '../profile/profile-export';
import { RoleSelector } from './RoleSelector';
import { SettingsScreen } from './SettingsScreen';
import { PickScreen } from '../screens/PickScreen';

export interface AppShellProps {
  screen: ScreenId;
  onScreenChange: (screen: ScreenId) => void;
  dataStatus: DataStatus;
  /** Bumped each time the launch data download settles (see App). */
  dataReadyNonce: number;
  theme: ThemeSetting;
  resolvedTheme: ResolvedTheme;
  onThemeChange: (theme: ThemeSetting) => void;
  onToggleTheme: () => void;
  role: Role;
  onRoleChange: (role: Role) => void;
  enabledRoles?: readonly Role[];
  notice?: string;
  poolSync?: PoolSyncStatus;
  repoFolder?: string;
  onSaveRepoFolder?: (value: string) => Promise<string | undefined>;
  /** Called after the pool changes outside settings (save, repo export). */
  onPoolChanged?: () => void;
  repoFolderAvailable?: boolean;
  profileStatus?: string;
  profileLoad?: ProfileLoad;
}

export function AppShell(props: AppShellProps) {
  return (
    <div className="min-h-screen text-lg">
      <Header
        dataStatus={props.dataStatus}
        resolvedTheme={props.resolvedTheme}
        onToggleTheme={props.onToggleTheme}
      />
      {props.notice !== undefined && (
        <p
          role="status"
          className="bg-amber-50 px-6 py-3 text-base text-amber-900 dark:bg-amber-900/30 dark:text-amber-100"
        >
          {props.notice}
        </p>
      )}
      {props.poolSync !== undefined && <PoolSyncBanner status={props.poolSync} />}
      <Nav active={props.screen} onSelect={props.onScreenChange} />
      <main className="space-y-6 px-6 py-6">
        {/* Pick stays mounted (hidden) so draft state survives tab switches. */}
        <section hidden={props.screen !== 'pick'} className="space-y-6">
          <RoleSelector
            selected={props.role}
            enabledRoles={props.enabledRoles}
            onSelect={props.onRoleChange}
          />
          <PickScreen
            role={props.role}
            profileLoad={props.profileLoad ?? { kind: 'none', reason: 'noFolder' }}
            dataReadyNonce={props.dataReadyNonce}
            repoFolder={props.repoFolder}
            onPoolChanged={props.onPoolChanged}
          />
        </section>
        {props.screen === 'settings' && (
          <SettingsScreen
            theme={props.theme}
            onThemeChange={props.onThemeChange}
            repoFolder={props.repoFolder}
            onSaveRepoFolder={props.onSaveRepoFolder}
            repoFolderAvailable={props.repoFolderAvailable}
            profileStatus={props.profileStatus}
          />
        )}
        {(props.screen === 'setup' || props.screen === 'game') && (
          <section className="space-y-6">
            <RoleSelector
              selected={props.role}
              enabledRoles={props.enabledRoles}
              onSelect={props.onRoleChange}
            />
            <p className="text-slate-600 dark:text-slate-300">{strings.pickPlaceholder}</p>
          </section>
        )}
      </main>
    </div>
  );
}
