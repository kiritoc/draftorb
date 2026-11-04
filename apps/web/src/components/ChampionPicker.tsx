/**
 * @draftorb/web — Searchable champion picker.
 *
 * Reusable champion selection component used by the draft screen (T-031) and
 * the pool editor (T-033). Controlled by `value`/`onChange`.
 */

import { useState, useCallback } from 'react';

import { type Champion, type ChampionId } from '@draftorb/shared';
import { strings } from '../strings.js';

export interface ChampionPickerProps {
  /** Currently selected champion id, or null when none is selected. */
  value: ChampionId | null;
  /** Called when the user selects or clears a champion. */
  onChange: (id: ChampionId | null) => void;
  /** Full champion catalogue to search through. */
  champions: Champion[];
  /** Placeholder shown when nothing is selected. */
  placeholder?: string;
  disabled?: boolean;
}

export function ChampionPicker({
  value,
  onChange,
  champions,
  placeholder = strings.championSearch,
  disabled = false,
}: ChampionPickerProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const selected = champions.find((champion) => champion.id === value);
  const filtered = champions
    .filter((champion) => champion.name.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 20);

  const handleSelect = useCallback(
    (id: ChampionId | null) => {
      onChange(id);
      setQuery('');
      setOpen(false);
    },
    [onChange],
  );

  return (
    <div className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="w-full flex items-center justify-between px-3 py-2 text-left bg-gray-800 border border-gray-600 rounded text-gray-100 disabled:opacity-50 disabled:pointer-events-none"
      >
        <span className="truncate">
          {selected ? `${selected.name} · ${selected.roles.join(', ')}` : placeholder}
        </span>
        <span className="text-gray-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={placeholder}
          className="absolute z-10 w-full mt-1 max-h-60 overflow-auto bg-gray-800 border border-gray-600 rounded shadow-lg"
        >
          <input
            autoFocus
            role="combobox"
            aria-controls="champion-picker-options"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={strings.search}
            className="w-full px-3 py-2 bg-gray-900 border-b border-gray-600 text-gray-100 focus:outline-none focus:border-indigo-400"
          />
          {selected ? (
            <button
              type="button"
              role="option"
              onClick={() => handleSelect(null)}
              className="w-full text-left px-3 py-2 text-gray-400 hover:bg-gray-700"
            >
              {strings.clear}
            </button>
          ) : null}
          {filtered.map((champion) => (
            <button
              type="button"
              key={champion.id}
              role="option"
              id={`champion-picker-option-${champion.id}`}
              onClick={() => handleSelect(champion.id)}
              className="w-full text-left px-3 py-2 text-gray-200 hover:bg-indigo-500 hover:text-white"
            >
              {champion.name}
            </button>
          ))}
          {filtered.length === 0 && query.length > 0 && (
            <div className="px-3 py-2 text-gray-500 text-sm">{strings.noChampionMatches}</div>
          )}
        </div>
      )}
    </div>
  );
}
