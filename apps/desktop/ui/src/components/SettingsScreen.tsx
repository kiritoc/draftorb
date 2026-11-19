import { strings } from '../strings';
import { THEME_SETTINGS, type ThemeSetting } from '../theme';

export interface SettingsScreenProps {
  theme: ThemeSetting;
  onThemeChange: (theme: ThemeSetting) => void;
}

export function SettingsScreen({ theme, onThemeChange }: SettingsScreenProps) {
  return (
    <section className="space-y-4">
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
    </section>
  );
}
