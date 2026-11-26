/**
 * Pool editor "add" form (SPECS §2.1, D-101): pick a champion once, tick
 * the roles it applies to, apply. The champion may land in several roles.
 */

import type { ReactElement } from 'react';

import type { Champion, ChampionId, Role } from '@draftorb/shared';
import { roleSchema } from '@draftorb/shared';
import { strings } from '../strings';
import { ChampionPicker } from './ChampionPicker';

const ROLES: readonly Role[] = roleSchema.options;

export interface PoolAddFormProps {
  champions: Champion[];
  iconVersion?: string | null;
  championId: ChampionId | null;
  roles: readonly Role[];
  /** False when there is nothing to apply (no champion, or no roles for a new one). */
  canApply: boolean;
  onChampionChange: (id: ChampionId | null) => void;
  onRoleToggle: (role: Role) => void;
  onApply: () => void;
}

/** Champion picker plus role checkboxes; applying with no role removes the champion. */
export function PoolAddForm({
  champions,
  iconVersion = null,
  championId,
  roles,
  canApply,
  onChampionChange,
  onRoleToggle,
  onApply,
}: PoolAddFormProps): ReactElement {
  return (
    <div className="mb-4 space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <ChampionPicker
        value={championId}
        onChange={onChampionChange}
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
              checked={roles.includes(role)}
              onChange={() => onRoleToggle(role)}
              className="h-4 w-4"
            />
            {strings.roleNames[role]}
          </label>
        ))}
        <button
          type="button"
          onClick={onApply}
          disabled={!canApply}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white disabled:pointer-events-none disabled:opacity-50"
        >
          {strings.poolApply}
        </button>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">{strings.poolPickHint}</p>
    </div>
  );
}
