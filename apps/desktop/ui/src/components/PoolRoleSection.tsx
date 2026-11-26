/**
 * One role section of the pool editor: champion chips with remove buttons
 * and the per-role count against `poolMaxSize` (SPECS §2.1, D-101).
 */

import type { ReactElement } from 'react';

import type { Champion, PoolConfigEntry, Role } from '@draftorb/shared';
import { POOL_CONFIG_MAX_PER_ROLE } from '@draftorb/shared';
import { strings } from '../strings';
import { championName } from '../champion-name';
import { championIconUrl } from '../data/champion-icons';
import { ChampionPortrait } from './ChampionPortrait';

export interface PoolRoleSectionProps {
  role: Role;
  entries: readonly PoolConfigEntry[];
  champions: Champion[];
  iconVersion?: string | null;
  onRemove: (championId: number, role: Role) => void;
}

/** Chips for one role's pool entries with an `n/max` count. */
export function PoolRoleSection({
  role,
  entries,
  champions,
  iconVersion = null,
  onRemove,
}: PoolRoleSectionProps): ReactElement {
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-300">
          {strings.roleNames[role]}
        </h3>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {strings.poolRoleCount(entries.length, POOL_CONFIG_MAX_PER_ROLE)}
        </span>
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-slate-400 dark:text-slate-500">{strings.poolRoleEmpty}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {entries.map((entry) => {
            const name = championName(champions, entry.championId);
            const champion = champions.find((c) => c.id === entry.championId);
            return (
              <li
                key={entry.championId}
                className="flex items-center gap-1.5 rounded-full border border-slate-300 py-1 pl-1 pr-2 dark:border-slate-600"
              >
                <ChampionPortrait
                  name={name}
                  iconUrl={
                    champion !== undefined ? championIconUrl(iconVersion, champion.icon) : null
                  }
                  size="sm"
                />
                <span className="text-sm text-slate-800 dark:text-slate-200">{name}</span>
                <button
                  type="button"
                  onClick={() => onRemove(entry.championId, role)}
                  aria-label={strings.poolRemoveFrom(name, strings.roleNames[role])}
                  className="rounded px-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-300"
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
