import { useState } from 'react';
import { strings } from '../strings';
import { THEME_SETTINGS, type ThemeSetting } from '../theme';

export interface SettingsScreenProps {
  theme: ThemeSetting;
  onThemeChange: (theme: ThemeSetting) => void;
  repoFolder?: string;
  /** Resolves to an error message, or undefined when saved. */
  onSaveRepoFolder?: (value: string) => Promise<string | undefined>;
  repoFolderAvailable?: boolean;
  profileStatus?: string;
}

export function SettingsScreen({
  theme,
  onThemeChange,
  repoFolder,
  onSaveRepoFolder,
  repoFolderAvailable = true,
  profileStatus,
}: SettingsScreenProps) {
  const [draft, setDraft] = useState(repoFolder ?? '');
  const [error, setError] = useState<string | undefined>();

  const save = async (value: string) => {
    const result = await onSaveRepoFolder?.(value);
    setError(result);
    if (result === undefined) setDraft(value.trim());
  };

  return (
    <section className="space-y-6">
      <h2 className="text-xl font-semibold">{strings.settingsTitle}</h2>
      <fieldset className="space-y-2">
        <legend className="text-lg">{strings.themeSettingLabel}</legend>
        {THEME_SETTINGS.map((option) => (
          <label key={option} className="flex items-center gap-3 text-lg">
            <input
              type="radio"
              name="theme"
              className="h-5 w-5"
              checked={theme === option}
              onChange={() => onThemeChange(option)}
            />
            {strings.themeOptions[option]}
          </label>
        ))}
      </fieldset>
      <div className="space-y-2">
        <label htmlFor="repo-folder" className="block text-lg">
          {strings.repoFolderLabel}
        </label>
        {repoFolderAvailable ? (
          <div className="flex flex-wrap gap-2">
            <input
              id="repo-folder"
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2 text-lg dark:border-slate-600 dark:bg-slate-800"
            />
            <button
              type="button"
              onClick={() => void save(draft)}
              className="rounded-lg bg-indigo-600 px-5 py-2 text-lg text-white"
            >
              {strings.repoFolderSave}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft('');
                void save('');
              }}
              className="rounded-lg border border-slate-300 px-5 py-2 text-lg hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700"
            >
              {strings.repoFolderClear}
            </button>
          </div>
        ) : (
          <p className="text-slate-600 dark:text-slate-300">{strings.repoFolderDesktopOnly}</p>
        )}
        <p className="text-base text-slate-600 dark:text-slate-300">{strings.repoFolderHelp}</p>
        {error !== undefined && (
          <p role="alert" className="text-base text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
      </div>
      {profileStatus !== undefined && (
        <div className="space-y-1">
          <h3 className="text-lg">{strings.personalRecordLabel}</h3>
          <p className="text-base text-slate-600 dark:text-slate-300">{profileStatus}</p>
        </div>
      )}
    </section>
  );
}
