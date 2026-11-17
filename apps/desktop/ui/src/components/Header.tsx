import { describeDataStatus, type DataStatus } from '../data-status';
import { strings } from '../strings';
import type { ResolvedTheme } from '../theme';

export interface HeaderProps {
  dataStatus: DataStatus;
  resolvedTheme: ResolvedTheme;
  onToggleTheme: () => void;
}

export function Header({ dataStatus, resolvedTheme, onToggleTheme }: HeaderProps) {
  const { patch, freshness } = describeDataStatus(dataStatus);
  return (
    <header className="flex flex-wrap items-center gap-4 border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-700 dark:bg-slate-800">
      <h1 className="text-2xl font-semibold">{strings.appName}</h1>
      <div className="text-base text-slate-600 dark:text-slate-300" data-testid="data-status">
        <span>{patch}</span>
        <span className="mx-2">·</span>
        <span>{freshness}</span>
      </div>
      <span
        className="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
        title={strings.unvalidatedHint}
      >
        {strings.unvalidatedLabel}
      </span>
      <button
        type="button"
        onClick={onToggleTheme}
        className="ml-auto rounded-lg border border-slate-300 px-4 py-2 text-base hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700"
      >
        {resolvedTheme === 'dark' ? strings.themeToggleToLight : strings.themeToggleToDark}
      </button>
    </header>
  );
}
