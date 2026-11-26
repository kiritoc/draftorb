/**
 * A single draft slot: champion picker + optional role select
 * (port of the web component). The user slot hides the role select —
 * the user's role comes from `DraftInput.userRole`.
 */

import { useId } from 'react';
import { roleSchema, type Champion, type ChampionId, type Role } from '@draftorb/shared';
import { strings } from '../strings';
import { formatRoleConfidence, type EnemyRoleView } from '../pick/enemy-roles';
import { ChampionPicker } from './ChampionPicker';

export interface DraftSlotState {
  championId: ChampionId | null;
  role?: Role;
}

export interface DraftSlotProps {
  label: string;
  slot: DraftSlotState;
  onChange: (slot: DraftSlotState) => void;
  champions: Champion[];
  disabled?: boolean;
  showRole?: boolean;
  /** Enemy-role inference view (BL-015); absent for ally/user slots. */
  roleView?: EnemyRoleView | null;
  iconVersion?: string | null;
}

const ALL_ROLES: readonly Role[] = roleSchema.options;

export function DraftSlot({
  label,
  slot,
  onChange,
  champions,
  disabled = false,
  showRole = true,
  roleView = null,
  iconVersion = null,
}: DraftSlotProps) {
  const handleChampion = (championId: ChampionId | null) => {
    onChange({
      ...slot,
      championId,
      role: slot.championId === championId ? slot.role : undefined,
    });
  };

  const handleRole = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const role = event.target.value as Role | '';
    onChange({ ...slot, role: role === '' ? undefined : role });
  };

  const hasChampion = slot.championId != null;
  const inferredRole = roleView?.source === 'inferred' ? roleView.role : null;
  const selectRole = slot.role ?? inferredRole ?? '';
  const autoRoleLabel = roleView === null ? strings.roleOptional : strings.roleAuto;
  const labelId = useId();

  return (
    <div className="flex flex-col gap-1.5">
      <span
        id={labelId}
        className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"
      >
        {label}
      </span>
      <ChampionPicker
        value={slot.championId}
        onChange={handleChampion}
        champions={champions}
        disabled={disabled}
        iconVersion={iconVersion}
        labelledBy={labelId}
        searchLabel={strings.championSearchFor(label)}
      />
      {showRole && (
        <>
          <select
            value={selectRole}
            onChange={handleRole}
            disabled={disabled || !hasChampion}
            aria-label={strings.roleFor(label)}
            className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-slate-800 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
          >
            <option value="">{autoRoleLabel}</option>
            {ALL_ROLES.map((role) => (
              <option key={role} value={role}>
                {strings.roleNames[role]}
              </option>
            ))}
          </select>
          {roleView?.source === 'inferred' &&
            roleView.role !== null &&
            roleView.confidence !== null && (
              <span className="text-xs font-medium text-indigo-600 dark:text-indigo-300">
                {strings.roleInferred(
                  strings.roleNames[roleView.role],
                  formatRoleConfidence(roleView.confidence),
                )}
              </span>
            )}
          {roleView?.source === 'manual' && roleView.role !== null && (
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {strings.roleManual(strings.roleNames[roleView.role])}
            </span>
          )}
          {roleView?.source === 'unresolved' && (
            <span className="text-xs font-medium text-amber-600 dark:text-amber-300">
              {strings.roleUnresolved}
            </span>
          )}
        </>
      )}
    </div>
  );
}
