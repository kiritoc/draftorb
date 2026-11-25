/**
 * Searchable champion picker (port of the web component, desktop styling).
 * Controlled by `value`/`onChange`; used by every draft slot.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import type { Champion, ChampionId } from '@draftorb/shared';
import { PICKER_RESULT_LIMIT } from '../config';
import { strings } from '../strings';
import { ChampionPortrait } from './ChampionPortrait';
import { championIconUrl } from '../data/champion-icons';

export interface ChampionPickerProps {
  value: ChampionId | null;
  onChange: (id: ChampionId | null) => void;
  champions: Champion[];
  placeholder?: string;
  disabled?: boolean;
  /** Data Dragon version for portraits; null falls back to initials. */
  iconVersion?: string | null;
  /** ID of the element naming this picker (e.g. the slot label). */
  labelledBy?: string;
  /** Accessible name of the search input; defaults to `placeholder`. */
  searchLabel?: string;
}

export function ChampionPicker({
  value,
  onChange,
  champions,
  placeholder = strings.championSearch,
  disabled = false,
  iconVersion = null,
  labelledBy,
  searchLabel,
}: ChampionPickerProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        setQuery('');
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const selected = champions.find((champion) => champion.id === value);
  const filtered = champions
    .filter((champion) => champion.name.toLowerCase().includes(query.toLowerCase()))
    .slice(0, PICKER_RESULT_LIMIT);

  const handleSelect = useCallback(
    (id: ChampionId | null) => {
      onChange(id);
      setQuery('');
      setOpen(false);
      buttonRef.current?.focus();
    },
    [onChange],
  );

  return (
    <div className="relative w-full" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-labelledby={labelledBy}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-slate-900 hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected !== undefined && (
            <ChampionPortrait
              name={selected.name}
              iconUrl={championIconUrl(iconVersion ?? null, selected.icon)}
              size="sm"
            />
          )}
          <span className="truncate">
            {selected ? `${selected.name} · ${selected.roles.join(', ')}` : placeholder}
          </span>
        </span>
        <span className="text-slate-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div
          role="listbox"
          id={listboxId}
          aria-label={placeholder}
          className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-slate-300 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-800"
        >
          <input
            autoFocus
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={strings.championSearch}
            aria-label={searchLabel ?? placeholder}
            className="w-full border-b border-slate-300 bg-white px-3 py-2 text-slate-900 focus:outline-none focus:border-indigo-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
          {selected ? (
            <button
              type="button"
              role="option"
              onClick={() => handleSelect(null)}
              className="w-full px-3 py-2 text-left text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
            >
              {strings.championClear}
            </button>
          ) : null}
          {filtered.map((champion) => (
            <button
              type="button"
              key={champion.id}
              role="option"
              onClick={() => handleSelect(champion.id)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-slate-800 hover:bg-indigo-50 dark:text-slate-200 dark:hover:bg-indigo-900/40"
            >
              <ChampionPortrait
                name={champion.name}
                iconUrl={championIconUrl(iconVersion ?? null, champion.icon)}
                size="sm"
              />
              <span className="truncate">{champion.name}</span>
            </button>
          ))}
          {filtered.length === 0 && query.length > 0 && (
            <div className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">
              {strings.championNoMatch}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
