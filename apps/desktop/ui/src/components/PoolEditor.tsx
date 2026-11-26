/**
 * Champion pool editor (BL-016b, D-101/D-114, SPECS §2.1/§19.3).
 *
 * Champion x roles model: pick a champion once, tick the roles it applies
 * to, apply. Edits live in a working copy and are persisted only on Save.
 * JSON backup is validated before it replaces the working copy; the repo
 * file (`data/pool.config.json`) import/export are manual actions and never
 * overwrite either side automatically (D-118).
 */

import { useEffect, useMemo, useState } from 'react';

import {
  POOL_CONFIG_MAX_PER_ROLE,
  poolConfigSchema,
  roleSchema,
  type Champion,
  type ChampionId,
  type PoolConfig,
  type Role,
} from '@draftorb/shared';
import { strings } from '../strings';
import { ChampionPicker } from './ChampionPicker';
import { PoolRoleSection } from './PoolRoleSection';
import { PoolTransferSection } from './PoolTransferSection';
import { championPoolRoles, emptyPool, setChampionRoles } from '../pool/pool-model';
import { exportPoolToRepo, readRepoPool } from '../pool/repo-pool';

const ROLES: readonly Role[] = roleSchema.options;

type Message = { text: string; kind: 'info' | 'error' };

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
}

export function PoolEditor({
  open,
  onClose,
  pool,
  champions,
  iconVersion = null,
  repoFolder,
  onSave,
}: PoolEditorProps) {
  const [working, setWorking] = useState<PoolConfig>(pool);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<Message>({ text: '', kind: 'info' });
  const [draftChampionId, setDraftChampionId] = useState<ChampionId | null>(null);
  const [draftRoles, setDraftRoles] = useState<readonly Role[]>([]);

  useEffect(() => {
    if (!open) return;
    setWorking(pool);
    setDirty(false);
    setMessage({ text: '', kind: 'info' });
    setDraftChampionId(null);
    setDraftRoles([]);
  }, [open, pool]);

  const roleEntries = useMemo(
    () => ROLES.map((role) => ({ role, entries: working.pools[role] ?? [] })),
    [working],
  );
  const totalCount = ROLES.reduce((sum, role) => sum + (working.pools[role]?.length ?? 0), 0);

  const mutate = (next: PoolConfig) => {
    setWorking(next);
    setDirty(true);
    setMessage({ text: '', kind: 'info' });
  };

  const handlePickChampion = (id: ChampionId | null) => {
    setDraftChampionId(id);
    setDraftRoles(id === null ? [] : championPoolRoles(working, id));
  };

  const toggleDraftRole = (role: Role) => {
    setDraftRoles((current) =>
      current.includes(role) ? current.filter((r) => r !== role) : [...current, role],
    );
  };

  const handleApply = () => {
    if (draftChampionId === null) return;
    const result = setChampionRoles(working, draftChampionId, draftRoles);
    mutate(result.pool);
    if (result.rejectedRoles.length > 0) {
      const names = result.rejectedRoles.map((role) => strings.roleNames[role]).join(', ');
      setMessage({
        text: strings.poolFull(names, POOL_CONFIG_MAX_PER_ROLE),
        kind: 'error',
      });
    }
  };

  const handleRemove = (championId: number, role: Role) => {
    const remaining = championPoolRoles(working, championId).filter((r) => r !== role);
    mutate(setChampionRoles(working, championId, remaining).pool);
  };

  const handleSave = async () => {
    try {
      await onSave(working);
      onClose();
    } catch (error) {
      setMessage({
        text: strings.poolSaveFailed(error instanceof Error ? error.message : String(error)),
        kind: 'error',
      });
    }
  };

  const handleApplyJson = (text: string): boolean => {
    try {
      const parsed = poolConfigSchema.safeParse(JSON.parse(text));
      if (!parsed.success) throw new Error('schema');
      mutate(parsed.data);
      setMessage({ text: strings.poolJsonImported, kind: 'info' });
      return true;
    } catch {
      setMessage({ text: strings.poolJsonInvalid, kind: 'error' });
      return false;
    }
  };

  const handleRepoImport = async () => {
    if (repoFolder === undefined) return;
    const result = await readRepoPool(repoFolder);
    if (result.notice !== undefined) {
      setMessage({ text: result.notice, kind: 'error' });
      return;
    }
    if (result.missing) {
      setMessage({ text: strings.poolRepoMissing, kind: 'info' });
      return;
    }
    mutate(result.pool);
    setMessage({ text: strings.poolRepoImported, kind: 'info' });
  };

  const handleRepoExport = async () => {
    if (repoFolder === undefined) return;
    if (dirty) {
      setMessage({ text: strings.poolDirtyExport, kind: 'error' });
      return;
    }
    try {
      await exportPoolToRepo(repoFolder, working);
      setMessage({ text: strings.poolRepoExported, kind: 'info' });
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : String(error),
        kind: 'error',
      });
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={strings.poolEditorLabel}
    >
      <div
        className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-slate-300 bg-white p-6 dark:border-slate-600 dark:bg-slate-800">
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

        {message.text !== '' && (
          <p
            role={message.kind === 'error' ? 'alert' : 'status'}
            className={`mb-4 rounded border px-3 py-2 text-sm ${
              message.kind === 'error'
                ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-500/40 dark:bg-red-900/30 dark:text-red-300'
                : 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-900/30 dark:text-indigo-300'
            }`}
          >
            {message.text}
          </p>
        )}

        <div className="mb-4 space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <ChampionPicker
            value={draftChampionId}
            onChange={handlePickChampion}
            champions={champions}
            iconVersion={iconVersion}
            placeholder={strings.championSearch}
            searchLabel={strings.championSearch}
          />
          <div className="flex flex-wrap items-center gap-3">
            {ROLES.map((role) => (
              <label
                key={role}
                className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-200"
              >
                <input
                  type="checkbox"
                  checked={draftRoles.includes(role)}
                  onChange={() => toggleDraftRole(role)}
                  className="h-4 w-4"
                />
                {strings.roleNames[role]}
              </label>
            ))}
            <button
              type="button"
              onClick={handleApply}
              disabled={draftChampionId === null || draftRoles.length === 0}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white disabled:pointer-events-none disabled:opacity-50"
            >
              {strings.poolApply}
            </button>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">{strings.poolPickHint}</p>
        </div>

        <div className="mb-4 space-y-3">
          {roleEntries.map(({ role, entries }) => (
            <PoolRoleSection
              key={role}
              role={role}
              entries={entries}
              champions={champions}
              iconVersion={iconVersion}
              onRemove={handleRemove}
            />
          ))}
        </div>

        <PoolTransferSection
          pool={working}
          dirty={dirty}
          repoFolder={repoFolder}
          onApplyJson={handleApplyJson}
          onRepoImport={() => void handleRepoImport()}
          onRepoExport={() => void handleRepoExport()}
        />

        <div className="flex items-center justify-between border-t border-slate-200 pt-4 dark:border-slate-700">
          <button
            type="button"
            onClick={() => mutate(emptyPool())}
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
  );
}
