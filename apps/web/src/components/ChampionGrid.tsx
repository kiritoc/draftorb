/**
 * @draftorb/web — Searchable champion grid with avatars (pool editor).
 *
 * Shows the whole champion catalogue as an avatar grid filterable by name.
 * Clicking a champion toggles its membership in the edited pool; selected
 * champions are pinned to the top and highlighted. Off-role picks (for the
 * editor's role) get an amber marker. Avatars come from the Data Dragon CDN
 * via `championIconUrl`; when no CDN version is resolved a letter placeholder
 * is rendered instead.
 */

import { useMemo, useState } from 'react';

import { type Champion, type ChampionId, type Role } from '@draftorb/shared';
import { championIconUrl } from '../data/champion-icons.js';
import { strings } from '../strings.js';

export interface ChampionGridProps {
  champions: Champion[];
  /** Role the pool applies to; champions lacking it are marked off-role. */
  role: Role;
  selectedIds: ReadonlySet<ChampionId>;
  /** Resolved Data Dragon version, or null when icons are unavailable. */
  iconVersion: string | null;
  onToggle: (id: ChampionId) => void;
}

function ChampionAvatar({
  champion,
  iconVersion,
}: {
  champion: Champion;
  iconVersion: string | null;
}) {
  const [failed, setFailed] = useState(false);
  const url = championIconUrl(iconVersion, champion.icon);
  if (url === null || failed) {
    return (
      <span
        className="flex items-center justify-center w-12 h-12 rounded bg-gray-700 text-lg font-bold text-gray-300"
        aria-hidden="true"
      >
        {champion.name.charAt(0)}
      </span>
    );
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="w-12 h-12 rounded object-cover"
    />
  );
}

export function ChampionGrid({
  champions,
  role,
  selectedIds,
  iconVersion,
  onToggle,
}: ChampionGridProps) {
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return champions
      .filter((champion) => q === '' || champion.name.toLowerCase().includes(q))
      .sort(
        (a, b) =>
          Number(selectedIds.has(b.id)) - Number(selectedIds.has(a.id)) ||
          a.name.localeCompare(b.name),
      );
  }, [champions, query, selectedIds]);

  return (
    <div>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={strings.championGridSearch}
        aria-label={strings.championGridSearch}
        className="w-full px-3 py-2 mb-3 bg-gray-800 border border-gray-600 rounded text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-400"
      />
      <div
        role="group"
        aria-label={strings.championGridLabel}
        className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2 max-h-96 overflow-y-auto pr-1"
      >
        {visible.map((champion) => {
          const selected = selectedIds.has(champion.id);
          const offRole = !champion.roles.includes(role);
          return (
            <button
              type="button"
              key={champion.id}
              onClick={() => onToggle(champion.id)}
              aria-pressed={selected}
              title={offRole ? strings.offRole(role) : undefined}
              className={`flex flex-col items-center gap-1 p-2 rounded border text-center transition-colors ${
                selected
                  ? 'bg-indigo-900/40 border-indigo-500'
                  : 'bg-gray-800/60 border-gray-700 hover:border-gray-500'
              } ${offRole && !selected ? 'border-amber-700/60' : ''}`}
            >
              <ChampionAvatar champion={champion} iconVersion={iconVersion} />
              <span className="text-xs text-gray-200 leading-tight break-words w-full">
                {champion.name}
              </span>
              <span className="text-[10px] text-gray-500 leading-tight">
                {champion.roles.join(', ')}
              </span>
              {offRole && (
                <span className="text-[10px] text-amber-400" aria-hidden="true">
                  {strings.offRoleLabel}
                </span>
              )}
              {selected && (
                <span className="text-[10px] text-indigo-300" aria-hidden="true">
                  {strings.inPoolTag}
                </span>
              )}
            </button>
          );
        })}
        {visible.length === 0 && (
          <div className="col-span-full px-3 py-4 text-gray-500 text-sm">
            {strings.noChampionMatches}
          </div>
        )}
      </div>
    </div>
  );
}
