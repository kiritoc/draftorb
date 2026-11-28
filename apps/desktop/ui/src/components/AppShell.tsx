import type { Role } from '@draftorb/shared';
import type { DataStatus } from '../data-status';
import type { DraftHandoff } from '../draft-handoff';
import { strings } from '../strings';
import type { ResolvedTheme, ThemeSetting } from '../theme';
import { Header } from './Header';
import { NewGameDialog } from './NewGameDialog';
import { Nav, type ScreenId } from './Nav';
import { PoolSyncBanner } from './PoolSyncBanner';
import type { PoolSyncStatus } from '../pool/pool-sync';
import type { ProfileLoad } from '../profile/profile-export';
import { RoleSelector } from './RoleSelector';
import { SettingsScreen } from './SettingsScreen';
import { PickScreen } from '../screens/PickScreen';
import { SetupScreen } from '../screens/SetupScreen';

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
  /** Active role; null when the coverage verdict enables no role. */
  role: Role | null;
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
  /** BL-055: bumped on each confirmed "New game"; remounts the game screens. */
  gameResetNonce: number;
  /** Whether the "New game" confirmation dialog is open (state lives in App). */
  newGameOpen: boolean;
  onNewGameOpenChange: (open: boolean) => void;
  /** Confirmed reset: clears every per-game field on Pick and Setup. */
  onNewGameConfirm: () => void;
  /**
   * BL-058: draft context reported by the pick screen (stays mounted while
   * hidden), forwarded to the setup screen. State lives in App so this
   * component stays hook-free and callable as a plain function in tests.
   */
  draftHandoff?: DraftHandoff;
  onDraftHandoffChange?: (handoff: DraftHandoff) => void;
  /** B-089: matchup layers active for the drafted role (reported by PickScreen via App). */
  matchupEnabled?: boolean;
  /** B-089: PickScreen reports its matchup state up through App. */
  onMatchupEnabledChange?: (enabled: boolean) => void;
}

export function AppShell(props: AppShellProps) {
  return (
    <div className="min-h-screen text-lg">
      <Header
        dataStatus={props.dataStatus}
        resolvedTheme={props.resolvedTheme}
        onToggleTheme={props.onToggleTheme}
        onNewGame={() => props.onNewGameOpenChange(true)}
        matchupEnabled={props.matchupEnabled}
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
          {/* Empty verdict: PickScreen skips recommendations but keeps the pool editor. */}
          {/* BL-055: the reset nonce remounts the screen so every per-game
              field returns to its default; the pool reloads untouched. */}
          <PickScreen
            key={`pick-${props.gameResetNonce}`}
            role={props.role ?? 'SUPPORT'}
            noEligibleRole={props.role === null}
            profileLoad={props.profileLoad ?? { kind: 'none', reason: 'noFolder' }}
            dataReadyNonce={props.dataReadyNonce}
            repoFolder={props.repoFolder}
            onPoolChanged={props.onPoolChanged}
            onDraftHandoffChange={props.onDraftHandoffChange}
            onMatchupEnabledChange={props.onMatchupEnabledChange}
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
        {props.screen === 'setup' && (
          <SetupScreen
            key={`setup-${props.gameResetNonce}`}
            preferredRole={props.role}
            draftHandoff={props.draftHandoff}
            dataReadyNonce={props.dataReadyNonce}
            profileLoad={props.profileLoad ?? { kind: 'none', reason: 'noFolder' }}
            profileStatus={props.profileStatus}
          />
        )}
        {props.screen === 'game' && (
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
      <NewGameDialog
        open={props.newGameOpen}
        onCancel={() => props.onNewGameOpenChange(false)}
        onConfirm={props.onNewGameConfirm}
      />
    </div>
  );
}
