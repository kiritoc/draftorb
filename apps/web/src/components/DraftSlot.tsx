/**
 * @draftorb/web — A single draft slot.
 *
 * A champion picker paired with an optional role. Used for the user slot,
 * allies, and enemies in the draft screen (T-031).
 */

import { type ChampionId, type Role } from '@draftorb/shared';
import { strings } from '../strings.js';
import { ChampionPicker } from './ChampionPicker.js';

export type DraftSlotState = {
  championId: ChampionId | null;
  role?: Role;
};

export interface DraftSlotProps {
  label: string;
  slot: DraftSlotState;
  onChange: (slot: DraftSlotState) => void;
  champions: import('@draftorb/shared').Champion[];
  disabled?: boolean;
}

const ROLES: readonly Role[] = ['SUPPORT', 'ADC', 'MID', 'JUNGLE', 'TOP'];

export function DraftSlot({ label, slot, onChange, champions, disabled = false }: DraftSlotProps) {
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

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
        {label}
      </label>
      <ChampionPicker
        value={slot.championId}
        onChange={handleChampion}
        champions={champions}
        disabled={disabled}
      />
      <select
        value={slot.role ?? ''}
        onChange={handleRole}
        disabled={disabled || !hasChampion}
        className="w-full px-2 py-1.5 bg-gray-800 border border-gray-600 rounded text-gray-200 focus:outline-none focus:border-indigo-400"
      >
        <option value="">{strings.roleOptional}</option>
        {ROLES.map((role) => (
          <option key={role} value={role}>
            {role}
          </option>
        ))}
      </select>
    </div>
  );
}
