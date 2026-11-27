/**
 * Champion pool editor (BL-016b, D-101/D-114, SPECS §2.1/§19.3).
 *
 * Champion x roles model: pick a champion once, tick the roles it applies
 * to, apply. Edits live in a working copy and are persisted only on Save.
 * JSON backup is validated before it replaces the working copy; the repo
 * file (`data/pool.config.json`) import/export are manual actions and never
 * overwrite either side automatically (D-118).
 */

import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type MouseEvent,
  type ReactElement,
  type SyntheticEvent,
} from 'react';

import {
  poolConfigSchema,
  roleSchema,
  type Champion,
  type PoolConfig,
  type Role,
} from '@draftorb/shared';
import { strings } from '../strings';
import { PoolAddForm } from './PoolAddForm';
import { PoolMessage } from './PoolMessage';
import { PoolRoleSection } from './PoolRoleSection';
import { PoolTransferSection } from './PoolTransferSection';
import {
  canApplyDraft,
  canExportToRepo,
  initPoolEditorState,
  isPoolDirty,
  poolEditorReducer,
  type PoolEditorMessageScope,
} from '../pool/pool-editor-state';
import { exportPoolToRepo, readRepoPool } from '../pool/repo-pool';

const ROLES: readonly Role[] = roleSchema.options;

export interface PoolEditorProps {
  open: boolean;
  onClose: () => void;
  /** The program-stored pool (last saved/loaded state). */
  pool: PoolConfig;
  champions: Champion[];
  iconVersion?: string | null;
  /** Repo folder for the `data/pool.config.json` actions; undefined hides them. */
  repoFolder?: string;
  /** Persists the working copy; may be async so failures keep the editor open. */
  onSave: (pool: PoolConfig) => void | Promise<void>;
  /** Called after a successful repo-file export so the difference banner refreshes (D-118). */
  onPoolChanged?: () => void;
}

/** Modal champion pool editor; edits stay in a working copy until Save. */
export function PoolEditor({
  open,
  onClose,
  pool,
  champions,
  iconVersion = null,
  repoFolder,
  onSave,
  onPoolChanged,
}: PoolEditorProps): ReactElement | null {
  const [state, dispatch] = useReducer(poolEditorReducer, pool, initPoolEditorState);
  const { working, draftChampionId, draftRoles, message } = state;
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Reset only when a session starts (closed -> open). Reloads that hand in a
  // new `pool` object while the editor is open must not erase unsaved edits.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) dispatch({ type: 'replace', pool, message: null });
  }

  // Native modal: initial focus, inert background, Esc; focus returns to the opener.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) dialog.showModal();
    return () => {
      if (opener?.isConnected === true) opener.focus();
    };
  }, [open]);

  const roleEntries = useMemo(
    () => ROLES.map((role) => ({ role, entries: working.pools[role] ?? [] })),
    [working],
  );
  const totalCount = ROLES.reduce((sum, role) => sum + (working.pools[role]?.length ?? 0), 0);

  // Canonical serialization makes "dirty" exact: reverting edits clears it.
  const dirty = isPoolDirty(working, pool);

  // Route each message to the section that produced it (B-081).
  const formMessage = message?.scope === 'form' ? message : null;
  const transferMessage = message?.scope === 'transfer' ? message : null;
  const footerMessage = message?.scope === 'footer' ? message : null;

  // Each message renders next to the action that produced it (B-081).
  const showError = (text: string, scope: PoolEditorMessageScope) =>
    dispatch({ type: 'message', message: { text, kind: 'error', scope } });
  const showInfo = (text: string, scope: PoolEditorMessageScope) =>
    dispatch({ type: 'message', message: { text, kind: 'info', scope } });

  const handleSave = async () => {
    try {
      await onSave(working);
      onClose();
    } catch (error) {
      showError(
        strings.poolSaveFailed(error instanceof Error ? error.message : String(error)),
        'footer',
      );
    }
  };

  const handleApplyJson = (text: string): boolean => {
    try {
      const parsed = poolConfigSchema.safeParse(JSON.parse(text));
      if (!parsed.success) throw new Error('schema');
      dispatch({
        type: 'replace',
        pool: parsed.data,
        message: { text: strings.poolJsonImported, kind: 'info', scope: 'transfer' },
      });
      return true;
    } catch {
      showError(strings.poolJsonInvalid, 'transfer');
      return false;
    }
  };

  const handleRepoImport = async () => {
    if (repoFolder === undefined) return;
    const result = await readRepoPool(repoFolder);
    if (result.notice !== undefined) {
      showError(result.notice, 'transfer');
      return;
    }
    if (result.missing) {
      showInfo(strings.poolRepoMissing, 'transfer');
      return;
    }
    dispatch({
      type: 'replace',
      pool: result.pool,
      message: { text: strings.poolRepoImported, kind: 'info', scope: 'transfer' },
    });
  };

  const handleRepoExport = async () => {
    if (repoFolder === undefined) return;
    if (!canExportToRepo(working, pool)) {
      showError(strings.poolDirtyExport, 'transfer');
      return;
    }
    try {
      await exportPoolToRepo(repoFolder, working);
      showInfo(strings.poolRepoExported, 'transfer');
      onPoolChanged?.();
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error), 'transfer');
    }
  };

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    // Esc: keep React as the source of truth for open state.
    event.preventDefault();
    onClose();
  };

  const handleBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
    // Clicks on ::backdrop target the dialog element itself.
    if (event.target === event.currentTarget) onClose();
  };

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-label={strings.poolEditorLabel}
      onCancel={handleCancel}
      onClick={handleBackdropClick}
      className="m-auto w-full max-w-3xl rounded-xl border border-slate-300 bg-transparent p-0 backdrop:bg-slate-900/50 backdrop:backdrop-blur-sm dark:border-slate-600"
    >
      <div className="max-h-[90vh] overflow-y-auto bg-white p-6 dark:bg-slate-800">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-indigo-700 dark:text-indigo-300">
            {strings.poolEditorTitle}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={strings.close}
            className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            ✕
          </button>
        </div>

        <PoolAddForm
          champions={champions}
          iconVersion={iconVersion}
          championId={draftChampionId}
          roles={draftRoles}
          canApply={canApplyDraft(state)}
          onChampionChange={(id) => dispatch({ type: 'pickChampion', id })}
          onRoleToggle={(role) => dispatch({ type: 'toggleRole', role })}
          onApply={() => dispatch({ type: 'apply' })}
        />

        {formMessage !== null && <PoolMessage message={formMessage} className="mb-4" />}

        <div className="mb-4 space-y-3">
          {roleEntries.map(({ role, entries }) => (
            <PoolRoleSection
              key={role}
              role={role}
              entries={entries}
              champions={champions}
              iconVersion={iconVersion}
              onRemove={(championId, role) => dispatch({ type: 'remove', championId, role })}
            />
          ))}
        </div>

        <PoolTransferSection
          pool={working}
          dirty={dirty}
          repoFolder={repoFolder}
          message={transferMessage}
          onApplyJson={handleApplyJson}
          onRepoImport={() => void handleRepoImport()}
          onRepoExport={() => void handleRepoExport()}
        />

        <div className="border-t border-slate-200 pt-4 dark:border-slate-700">
          {footerMessage !== null && <PoolMessage message={footerMessage} className="mb-3" />}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => dispatch({ type: 'clear' })}
              disabled={totalCount === 0}
              className="rounded-lg px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:pointer-events-none disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-900/30"
            >
              {strings.poolClear}
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-300 px-4 py-1.5 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                {strings.poolCancel}
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500"
              >
                {strings.poolSave}
              </button>
            </div>
          </div>
        </div>
      </div>
    </dialog>
  );
}
