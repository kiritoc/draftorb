/**
 * Role override chips of the draft entry bar (BL-022): shown for the active
 * pick slot while it holds a champion; "Auto" clears the manual role so the
 * engine infers it again.
 */

import { roleSchema, type Role } from '@draftorb/shared';
import { strings } from '../strings';

const ALL_ROLES: readonly Role[] = roleSchema.options;

export interface EntryRoleChipsProps {
  /** Chip-group label, e.g. the active slot's name. */
  targetLabel: string;
  /** Manual role of the active slot; undefined means auto/inferred. */
  activeRole?: Role;
  onSelect: (role: Role | undefined) => void;
}

export function EntryRoleChips({ targetLabel, activeRole, onSelect }: EntryRoleChipsProps) {
  const chipClass = (isActive: boolean) =>
    isActive
      ? 'rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white'
      : 'rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700';

  return (
    <div
      role="group"
      aria-label={strings.entryRoleFor(targetLabel)}
      className="flex flex-wrap items-center gap-1"
    >
      <span className="text-xs text-slate-500 dark:text-slate-400">{strings.entryRole}</span>
      <button
        type="button"
        aria-pressed={activeRole === undefined}
        onClick={() => onSelect(undefined)}
        className={chipClass(activeRole === undefined)}
      >
        {strings.roleAuto}
      </button>
      {ALL_ROLES.map((role) => (
        <button
          key={role}
          type="button"
          aria-pressed={activeRole === role}
          onClick={() => onSelect(role)}
          className={chipClass(activeRole === role)}
        >
          {strings.roleNames[role]}
        </button>
      ))}
    </div>
  );
}
