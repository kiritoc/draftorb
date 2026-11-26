import type { Role } from '@draftorb/shared';
import { ROLE_ORDER } from '../config';
import { roleAvailability } from '../roles';
import { strings } from '../strings';

export interface RoleSelectorProps {
  /** null when no role is eligible (nothing highlighted). */
  selected: Role | null;
  enabledRoles?: readonly Role[];
  onSelect: (role: Role) => void;
}

export function RoleSelector({ selected, enabledRoles, onSelect }: RoleSelectorProps) {
  const availability = roleAvailability(enabledRoles);
  return (
    <div role="group" aria-label={strings.roleSelectorLabel} className="flex flex-wrap gap-3">
      {ROLE_ORDER.map((role) => {
        const { enabled, reason } = availability[role];
        return (
          <button
            key={role}
            type="button"
            disabled={!enabled}
            title={reason}
            aria-pressed={role === selected}
            onClick={() => onSelect(role)}
            className={`rounded-lg border px-6 py-3 text-lg ${
              role === selected
                ? 'border-indigo-600 bg-indigo-600 text-white'
                : 'border-slate-300 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent'
            }`}
          >
            {strings.roleNames[role]}
          </button>
        );
      })}
    </div>
  );
}
