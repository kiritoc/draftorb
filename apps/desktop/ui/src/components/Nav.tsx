import { strings } from '../strings';

export type ScreenId = 'pick' | 'setup' | 'game' | 'settings';

interface NavEntry {
  id: ScreenId;
  label: string;
  disabledReason?: string;
}

const ENTRIES: readonly NavEntry[] = [
  { id: 'pick', label: strings.navPick },
  { id: 'setup', label: strings.navSetup, disabledReason: strings.navSetupDisabled },
  { id: 'game', label: strings.navGame, disabledReason: strings.navGameDisabled },
  { id: 'settings', label: strings.navSettings },
];

export interface NavProps {
  active: ScreenId;
  onSelect: (id: ScreenId) => void;
}

export function Nav({ active, onSelect }: NavProps) {
  return (
    <nav className="flex gap-2 px-6 pt-4" aria-label="Screens">
      {ENTRIES.map((entry) => {
        const disabled = entry.disabledReason !== undefined;
        const selected = entry.id === active;
        return (
          <button
            key={entry.id}
            type="button"
            disabled={disabled}
            title={entry.disabledReason}
            aria-current={selected ? 'page' : undefined}
            onClick={() => onSelect(entry.id)}
            className={`rounded-lg px-5 py-3 text-lg ${
              selected
                ? 'bg-indigo-600 text-white'
                : 'hover:bg-slate-200 dark:hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent'
            }`}
          >
            {entry.label}
          </button>
        );
      })}
    </nav>
  );
}
