/**
 * Fast draft entry bar (BL-022, SPECS §10): one champion search that fills
 * the active draft slot, digit keys jump between the ten pick slots, and a
 * ban pseudo-target appends to the ban list. The dropdown stays open after
 * each pick so a practiced user never reaches for the mouse.
 *
 * Keyboard contract (search input focused):
 * - typing filters champions; ArrowUp/Down move, Enter picks, Escape closes
 * - with an empty query, digits 1-9/0 jump to pick slots 1-10
 * - with an empty query on the ban target, Backspace removes the last ban
 * - Tab stays native so the role chips and slot chips remain reachable
 */

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

import type { Champion, ChampionId, Role } from '@draftorb/shared';
import { PICKER_RESULT_LIMIT } from '../config';
import { strings } from '../strings';
import {
  BAN_LIMIT,
  BAN_TARGET,
  isPickTargetIndex,
  lastBan,
  targetIndexForDigit,
} from '../pick/draft-entry';
import { championIconUrl } from '../data/champion-icons';
import { ChampionPortrait } from './ChampionPortrait';
import { BanList } from './BanList';
import { EntryRoleChips } from './EntryRoleChips';

export interface EntryTargetInfo {
  /** Stable key ('user', 'ally-0', 'enemy-4') for React keys. */
  readonly key: string;
  /** Short chip label ('You', 'Ally 1', 'Enemy 3'). */
  readonly label: string;
  /** Display name of the champion filling the slot, or null when empty. */
  readonly championName: string | null;
}

export interface DraftEntryBarProps {
  /** Full champion catalog; already-picked and banned ids are filtered out. */
  champions: readonly Champion[];
  /** Data Dragon version for portraits; null falls back to initials. */
  iconVersion?: string | null;
  /** The ten pick targets in entry order. */
  targets: readonly EntryTargetInfo[];
  /** Active target index: 0-9 pick slots, BAN_TARGET (10) for bans. */
  activeIndex: number;
  onActiveIndex: (index: number) => void;
  bans: readonly ChampionId[];
  /** Champion ids unavailable to the search (picked or banned). */
  excludedIds: ReadonlySet<ChampionId>;
  /** Manual role of the active pick slot; undefined means auto/inferred. */
  activeRole?: Role;
  /** Whether the active pick slot accepts a role override right now. */
  roleEditable: boolean;
  onPick: (targetIndex: number, championId: ChampionId) => void;
  onSetRole: (targetIndex: number, role: Role | undefined) => void;
  onAddBan: (championId: ChampionId) => void;
  onRemoveBan: (championId: ChampionId) => void;
}

export function DraftEntryBar({
  champions,
  iconVersion = null,
  targets,
  activeIndex,
  onActiveIndex,
  bans,
  excludedIds,
  activeRole,
  roleEditable,
  onPick,
  onSetRole,
  onAddBan,
  onRemoveBan,
}: DraftEntryBarProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeOption, setActiveOption] = useState(0);
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const needle = query.toLowerCase();
    return champions
      .filter(
        (champion) => !excludedIds.has(champion.id) && champion.name.toLowerCase().includes(needle),
      )
      .slice(0, PICKER_RESULT_LIMIT);
  }, [champions, excludedIds, query]);

  // A new query or a reopened list restarts keyboard navigation at the top.
  useEffect(() => {
    setActiveOption(0);
  }, [open, query]);

  // Close on outside pointer interaction; keyboard users have Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);
  const active = filtered.length === 0 ? -1 : Math.min(activeOption, filtered.length - 1);
  const optionId = (index: number) => `${listboxId}-option-${index}`;
  const statusId = `${listboxId}-status`;
  const banFull = bans.length >= BAN_LIMIT;
  const activeTargetLabel =
    activeIndex === BAN_TARGET
      ? strings.entryBanCount(bans.length)
      : (targets[activeIndex]?.label ?? '');

  // Keep the highlighted option visible: focus stays on the input, so the
  // browser does not scroll the listbox by itself (covers wraparound too).
  useEffect(() => {
    if (!open || active < 0) return;
    const option = listboxRef.current?.querySelector<HTMLElement>(`[id="${optionId(active)}"]`);
    option?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const handleSelect = (championId: ChampionId) => {
    if (activeIndex === BAN_TARGET) {
      // At the limit, keep the query so the rejection is visible (status below).
      if (banFull) return;
      onAddBan(championId);
    } else {
      onPick(activeIndex, championId);
    }
    // Stay open with an empty query: the next champion is one Enter away.
    setQuery('');
    inputRef.current?.focus();
  };

  // Tabbing away from the search closes the list so it stops covering the
  // slot chips; focusing an option keeps it open so the click can land.
  const handleInputBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && listboxRef.current?.contains(next) === true) return;
    setOpen(false);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (filtered.length === 0) return;
      setActiveOption((current) => {
        const next = event.key === 'ArrowDown' ? current + 1 : current - 1;
        return (next + filtered.length) % filtered.length;
      });
    } else if (event.key === 'Enter') {
      if (open) {
        const champion = active >= 0 ? filtered[active] : undefined;
        if (champion !== undefined) {
          event.preventDefault();
          handleSelect(champion.id);
        }
      } else {
        setOpen(true);
      }
    } else if (event.key === 'Escape') {
      setOpen(false);
      setQuery('');
    } else if (event.key === 'Backspace' && query === '' && activeIndex === BAN_TARGET) {
      const last = lastBan(bans);
      if (last !== undefined) {
        event.preventDefault();
        onRemoveBan(last);
      }
    } else if (query === '') {
      const target = targetIndexForDigit(event.key);
      if (target !== null) {
        event.preventDefault();
        onActiveIndex(target);
      }
    }
  };

  const chipClass = (isActive: boolean) =>
    isActive
      ? 'rounded-lg border border-indigo-400 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-800 ring-1 ring-indigo-400 dark:border-indigo-500 dark:bg-indigo-900/50 dark:text-indigo-200'
      : 'rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700';

  return (
    <div
      ref={rootRef}
      className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/40"
    >
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start">
        <div className="relative flex-1">
          <input
            ref={inputRef}
            autoFocus
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-activedescendant={active >= 0 ? optionId(active) : undefined}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={handleInputBlur}
            onKeyDown={handleKeyDown}
            placeholder={strings.championSearch}
            aria-label={strings.entrySearch}
            aria-describedby={statusId}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-400 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
          {open && (
            <div
              ref={listboxRef}
              role="listbox"
              id={listboxId}
              aria-label={strings.championSearch}
              className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-auto rounded-lg border border-slate-300 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-800"
            >
              {filtered.map((champion, index) => (
                <button
                  type="button"
                  key={champion.id}
                  role="option"
                  id={optionId(index)}
                  aria-selected={active === index}
                  tabIndex={-1}
                  onClick={() => handleSelect(champion.id)}
                  className={
                    active === index
                      ? 'flex w-full items-center gap-2 bg-indigo-100 px-3 py-2 text-left text-slate-800 dark:bg-indigo-900/60 dark:text-slate-200'
                      : 'flex w-full items-center gap-2 px-3 py-2 text-left text-slate-800 hover:bg-indigo-50 dark:text-slate-200 dark:hover:bg-indigo-900/40'
                  }
                >
                  <ChampionPortrait
                    name={champion.name}
                    iconUrl={championIconUrl(iconVersion, champion.icon)}
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

        {roleEditable && isPickTargetIndex(activeIndex) && (
          <EntryRoleChips
            targetLabel={targets[activeIndex]?.label ?? ''}
            activeRole={activeRole}
            onSelect={(role) => onSetRole(activeIndex, role)}
          />
        )}
      </div>

      <div role="group" aria-label={strings.entryTargets} className="mt-2 flex flex-wrap gap-1.5">
        {targets.map((target, index) => (
          <button
            key={target.key}
            type="button"
            aria-pressed={activeIndex === index}
            onClick={() => onActiveIndex(index)}
            className={chipClass(activeIndex === index)}
          >
            <span className="font-semibold">{target.label}</span>
            {target.championName !== null && (
              <span className="ml-1 text-slate-500 dark:text-slate-400">{target.championName}</span>
            )}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={activeIndex === BAN_TARGET}
          onClick={() => onActiveIndex(BAN_TARGET)}
          className={chipClass(activeIndex === BAN_TARGET)}
        >
          {strings.entryBanCount(bans.length)}
        </button>
      </div>

      <BanList
        bans={bans}
        champions={champions}
        iconVersion={iconVersion}
        onRemoveBan={onRemoveBan}
      />

      <p
        id={statusId}
        role="status"
        aria-live="polite"
        className="mt-2 text-xs font-medium text-slate-600 dark:text-slate-300"
      >
        {strings.entryActiveTarget(activeTargetLabel)}
        {activeIndex === BAN_TARGET && banFull && ` · ${strings.banLimitReached(BAN_LIMIT)}`}
      </p>

      <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">{strings.entryHints}</p>
    </div>
  );
}
