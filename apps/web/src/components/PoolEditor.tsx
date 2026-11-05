/**
 * @draftorb/web — Champion pool editor (T-033, D-024).
 *
 * Per-role pool editor reusing the searchable ChampionPicker (T-031). Edits
 * live in a working copy and are only persisted when the user saves. Supports
 * JSON export and import; an invalid import leaves the stored pool untouched.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  type Champion,
  type ChampionId,
  type ChampionPool,
  type Role,
} from '@draftorb/shared';
import { poolMaxSize } from '../config.js';
import { strings } from '../strings.js';
import { ChampionPicker } from './ChampionPicker.js';
import { parsePoolImport } from '../pool/storage.js';

const USER_ROLE: Role = 'SUPPORT';
const STORED_ROLES: readonly Role[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];

function emptyPools(): Record<Role, number[]> {
  return { TOP: [], JUNGLE: [], MID: [], ADC: [], SUPPORT: [] };
}

export interface PoolEditorProps {
  open: boolean;
  onClose: () => void;
  pool: ChampionPool | null;
  champions: Champion[];
  onSave: (pool: ChampionPool) => void;
}

export function PoolEditor({ open, onClose, pool, champions, onSave }: PoolEditorProps) {
  const [working, setWorking] = useState<Record<Role, number[]>>(emptyPools());
  const [message, setMessage] = useState({ text: '', kind: 'info' as 'info' | 'error' });
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const next = emptyPools();
    for (const role of STORED_ROLES) {
      next[role] = pool?.pools[role] ?? [];
    }
    setWorking(next);
    setImportError(null);
    setMessage({ text: '', kind: 'info' });
  }, [open, pool]);

  const championById = useMemo(() => new Map(champions.map((c) => [c.id, c])), [champions]);

  const isOffRole = (role: Role, championId: ChampionId): boolean => {
    const champion = championById.get(championId);
    return champion !== undefined && !champion.roles.includes(role);
  };

  const countFor = (role: Role): number => working[role].length;

  const addChampion = useCallback(
    (role: Role, championId: ChampionId | null) => {
      if (championId === null) return;
      if (working[role].includes(championId)) return;
      if (countFor(role) >= poolMaxSize) {
        setMessage({ text: strings.poolFull(role, poolMaxSize), kind: 'error' });
        return;
      }
      setWorking((current) => ({ ...current, [role]: [...current[role], championId] }));
      setMessage({ text: '', kind: 'info' });
    },
    [working],
  );

  const removeChampion = useCallback((role: Role, championId: ChampionId) => {
    setWorking((current) => ({
      ...current,
      [role]: current[role].filter((id) => id !== championId),
    }));
  }, []);

  const handleSave = () => {
    const pools: ChampionPool['pools'] = {};
    for (const role of STORED_ROLES) {
      if (working[role].length > 0) {
        pools[role] = working[role];
      }
    }
    onSave({ version: 1, pools });
    onClose();
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportError(null);
    try {
      const parsed = parsePoolImport(await file.text());
      onSave(parsed);
      setMessage({ text: strings.poolImported, kind: 'info' });
      onClose();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : strings.poolInvalid);
    }
  };

  const handleExport = () => {
    const pools: ChampionPool['pools'] = {};
    for (const role of STORED_ROLES) {
      if (working[role].length > 0) {
        pools[role] = working[role];
      }
    }
    const blob = new Blob([JSON.stringify({ version: 1, pools })], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = strings.exportFileName;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage({ text: strings.poolExported, kind: 'info' });
  };

  if (!open) return null;

  const total = working[USER_ROLE].length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={strings.poolEditorLabel}
    >
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-indigo-300">{strings.poolEditorTitle}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-white"
            aria-label={strings.close}
          >
            ✕
          </button>
        </div>

        {message.text && (
          <div
            className={`mb-4 p-3 rounded text-sm ${message.kind === 'error' ? 'bg-red-900/30 text-red-400 border border-red-600/30' : 'bg-indigo-900/30 text-indigo-300 border border-indigo-600/30'}`}
          >
            {message.text}
          </div>
        )}
        {importError && (
          <div className="mb-4 p-3 rounded bg-red-900/30 text-red-400 border border-red-600/30 text-sm">
            {strings.importFailed(importError)}
          </div>
        )}

        <div className="space-y-4">
          {[USER_ROLE].map((role) => {
            const ids = working[role];
            return (
              <div key={role} className="border border-gray-800 rounded p-3">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    {role}
                  </label>
                  <span className="text-xs text-gray-500">
                    {strings.poolCount(countFor(role), poolMaxSize)}
                  </span>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <ChampionPicker
                    value={null}
                    onChange={(championId) => addChampion(role, championId)}
                    champions={champions}
                    placeholder={strings.addRole(role)}
                    disabled={countFor(role) >= poolMaxSize}
                  />
                  <button
                    type="button"
                    onClick={() => setWorking((current) => ({ ...current, [USER_ROLE]: [] }))}
                    disabled={total === 0}
                    className="px-2 py-1 text-xs text-gray-400 hover:text-red-400 disabled:opacity-50"
                  >
                    {strings.clearAll}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {ids.length === 0 && (
                    <span className="text-xs text-gray-500 italic">{strings.empty}</span>
                  )}
                  {ids.map((championId) => {
                    const champion = championById.get(championId);
                    const offRole = isOffRole(role, championId);
                    return (
                      <span
                        key={championId}
                        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs border ${
                          offRole
                            ? 'bg-amber-900/30 text-amber-300 border-amber-600/30'
                            : 'bg-gray-800 text-gray-300 border-gray-600/30'
                        }`}
                        title={offRole ? strings.offRole(role) : undefined}
                      >
                        {champion?.name ?? strings.championFallback(championId)}
                        <button
                          type="button"
                          onClick={() => removeChampion(role, championId)}
                          className="ml-1.5 text-gray-500 hover:text-white"
                          aria-label={strings.removeFromRole(
                            champion?.name ?? String(championId),
                            role,
                          )}
                        >
                          ✕
                        </button>
                        {offRole && (
                          <span className="text-[10px] text-amber-400" aria-hidden="true">
                            {strings.offRoleLabel}
                          </span>
                        )}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span>{strings.poolCountSummary(total)}</span>
            <span className="text-amber-400">{strings.offRoleHints}</span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleExport}
              className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 text-gray-200 rounded border border-gray-600"
            >
              {strings.exportJson}
            </button>
            <label className="cursor-pointer px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 text-gray-200 rounded border border-gray-600">
              {strings.importJson}
              <input type="file" accept=".json" className="hidden" onChange={handleImport} />
            </label>
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded"
            >
              {strings.save}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
