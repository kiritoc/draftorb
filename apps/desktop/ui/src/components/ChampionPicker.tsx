/**
 * Searchable champion picker (port of the web component, desktop styling).
 * Controlled by `value`/`onChange`; used by every draft slot.
 * Keyboard: the search input is a combobox — ArrowUp/ArrowDown move the
 * active option (`aria-activedescendant`), Enter selects, Escape closes.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

import type { Champion, ChampionId } from '@draftorb/shared';
import { PICKER_RESULT_LIMIT } from '../config';
import { strings } from '../strings';
import { championIconUrl } from '../data/champion-icons';
import { ChampionPortrait } from './ChampionPortrait';

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

interface PickerOption {
  readonly key: string;
  readonly id: ChampionId | null;
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
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();
  const valueId = useId();
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

  // A new query or a reopened listbox restarts keyboard navigation at the top.
  useEffect(() => {
    setActiveIndex(0);
  }, [open, query]);

  const selected = champions.find((champion) => champion.id === value);
  const filtered = champions
    .filter((champion) => champion.name.toLowerCase().includes(query.toLowerCase()))
    .slice(0, PICKER_RESULT_LIMIT);

  // Flat option list for keyboard navigation: "Clear" first when a champion
  // is selected, then the filtered champions (same order as rendered).
  const options: PickerOption[] = [
    ...(selected !== undefined ? [{ key: 'clear', id: null }] : []),
    ...filtered.map((champion) => ({ key: `champion-${champion.id}`, id: champion.id })),
  ];
  const active = options.length === 0 ? -1 : Math.min(activeIndex, options.length - 1);
  const optionId = (index: number) => `${listboxId}-option-${index}`;

  const handleSelect = useCallback(
    (id: ChampionId | null) => {
      onChange(id);
      setQuery('');
      setOpen(false);
      buttonRef.current?.focus();
    },
    [onChange],
  );

  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (options.length === 0) return;
      setActiveIndex((current) => {
        const next = event.key === 'ArrowDown' ? current + 1 : current - 1;
        return (next + options.length) % options.length;
      });
    } else if (event.key === 'Enter') {
      const option = active >= 0 ? options[active] : undefined;
      if (option !== undefined) {
        event.preventDefault();
        handleSelect(option.id);
      }
    }
  };

  const clearOptionClass = (isActive: boolean) =>
    isActive
      ? 'w-full px-3 py-2 text-left text-slate-500 bg-indigo-100 dark:text-slate-400 dark:bg-indigo-900/60'
      : 'w-full px-3 py-2 text-left text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700';
  const championOptionClass = (isActive: boolean) =>
    isActive
      ? 'flex w-full items-center gap-2 px-3 py-2 text-left text-slate-800 bg-indigo-100 dark:text-slate-200 dark:bg-indigo-900/60'
      : 'flex w-full items-center gap-2 px-3 py-2 text-left text-slate-800 hover:bg-indigo-50 dark:text-slate-200 dark:hover:bg-indigo-900/40';

  return (
    <div className="relative w-full" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-labelledby={labelledBy !== undefined ? `${labelledBy} ${valueId}` : undefined}
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
          <span id={valueId} className="truncate">
            {selected
              ? `${selected.name} · ${selected.roles.map((role) => strings.roleNames[role]).join(', ')}`
              : placeholder}
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
            aria-activedescendant={active >= 0 ? optionId(active) : undefined}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder={strings.championSearch}
            aria-label={searchLabel ?? placeholder}
            className="w-full border-b border-slate-300 bg-white px-3 py-2 text-slate-900 focus:outline-none focus:border-indigo-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
          {selected ? (
            <button
              type="button"
              role="option"
              id={optionId(0)}
              aria-selected={active === 0}
              tabIndex={-1}
              onClick={() => handleSelect(null)}
              className={clearOptionClass(active === 0)}
            >
              {strings.championClear}
            </button>
          ) : null}
          {filtered.map((champion, index) => {
            const optionIndex = (selected !== undefined ? 1 : 0) + index;
            return (
              <button
                type="button"
                key={champion.id}
                role="option"
                id={optionId(optionIndex)}
                aria-selected={active === optionIndex}
                tabIndex={-1}
                onClick={() => handleSelect(champion.id)}
                className={championOptionClass(active === optionIndex)}
              >
                <ChampionPortrait
                  name={champion.name}
                  iconUrl={championIconUrl(iconVersion ?? null, champion.icon)}
                  size="sm"
                />
                <span className="truncate">{champion.name}</span>
              </button>
            );
          })}
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
