/**
 * Ban chips of the draft entry bar (BL-022): one chip per banned champion
 * with a keyboard-reachable remove button.
 */

import { useMemo } from 'react';

import type { Champion, ChampionId } from '@draftorb/shared';
import { strings } from '../strings';
import { championIconUrl } from '../data/champion-icons';
import { ChampionPortrait } from './ChampionPortrait';

export interface BanListProps {
  bans: readonly ChampionId[];
  champions: readonly Champion[];
  iconVersion?: string | null;
  onRemoveBan: (championId: ChampionId) => void;
}

export function BanList({ bans, champions, iconVersion = null, onRemoveBan }: BanListProps) {
  const nameById = useMemo(
    () => new Map(champions.map((champion) => [champion.id, champion])),
    [champions],
  );

  if (bans.length === 0) return null;

  return (
    <ul aria-label={strings.banList} className="mt-2 flex flex-wrap gap-1.5">
      {bans.map((id) => {
        const champion = nameById.get(id);
        const name = champion?.name ?? strings.championFallback(id);
        return (
          <li
            key={id}
            className="flex items-center gap-1 rounded-md border border-red-300 bg-red-50 px-1.5 py-0.5 text-xs text-red-800 dark:border-red-500/40 dark:bg-red-900/30 dark:text-red-200"
          >
            {champion !== undefined && (
              <ChampionPortrait
                name={champion.name}
                iconUrl={championIconUrl(iconVersion, champion.icon)}
                size="sm"
              />
            )}
            <span className="truncate">{name}</span>
            <button
              type="button"
              aria-label={strings.banRemove(name)}
              onClick={() => onRemoveBan(id)}
              className="rounded px-1 text-red-700 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-900/60"
            >
              ×
            </button>
          </li>
        );
      })}
    </ul>
  );
}
