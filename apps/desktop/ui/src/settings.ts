import { z } from 'zod';
import { strings } from './strings';
import { invokeCommand, isTauri } from './tauri';
import { THEME_SETTINGS, type ThemeSetting } from './theme';

const SETTINGS_FILE = 'settings.json';

export const settingsSchema = z.object({
  version: z.literal(1),
  theme: z.enum(THEME_SETTINGS as [ThemeSetting, ...ThemeSetting[]]),
  /** Local DraftOrb clone (D-118, SPECS §19.1); no UI to set it yet. */
  repoFolder: z.string().min(1).optional(),
});
export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = { version: 1, theme: 'system' };

export interface ParsedSettings {
  settings: Settings;
  notice?: string;
}

/** Never throws: anything unreadable falls back to defaults plus a notice. */
export function parseSettings(raw: string): ParsedSettings {
  if (raw.trim() === '') return { settings: { ...DEFAULT_SETTINGS } };
  try {
    const result = settingsSchema.safeParse(JSON.parse(raw));
    if (result.success) return { settings: result.data };
  } catch {
    // fall through to the reset notice
  }
  return { settings: { ...DEFAULT_SETTINGS }, notice: strings.settingsReset };
}

export function serializeSettings(settings: Settings): string {
  return JSON.stringify(settings);
}

let memorySettings = '';

/** Settings live in the program's config dir (D-101); a plain browser keeps them in memory. */
export async function loadSettings(): Promise<ParsedSettings> {
  try {
    const raw = isTauri()
      ? await invokeCommand<string>('load_app_file', { name: SETTINGS_FILE })
      : memorySettings;
    return parseSettings(raw);
  } catch {
    return parseSettings('{');
  }
}

/** Persists an explicit theme choice and returns the stored settings. */
export async function persistThemeChoice(
  theme: ThemeSetting,
  current: Settings = DEFAULT_SETTINGS,
): Promise<Settings> {
  const next: Settings = { ...current, theme };
  await saveSettings(next);
  return next;
}

/** Validates and stores the repo folder; an empty value clears it. The old value is kept on error. */
export async function saveRepoFolder(
  current: Settings,
  input: string,
): Promise<{ settings: Settings; error?: string }> {
  const folder = input.trim();
  if (folder === '') {
    const { repoFolder: _removed, ...rest } = current;
    await saveSettings(rest);
    return { settings: rest };
  }
  if (!isTauri()) return { settings: current, error: strings.repoFolderDesktopOnly };
  try {
    await invokeCommand('check_repo_folder', { repoFolder: folder });
  } catch (error) {
    return { settings: current, error: typeof error === 'string' ? error : String(error) };
  }
  const next: Settings = { ...current, repoFolder: folder };
  await saveSettings(next);
  return { settings: next };
}

export async function saveSettings(settings: Settings): Promise<void> {
  const raw = serializeSettings(settings);
  if (!isTauri()) {
    memorySettings = raw;
    return;
  }
  await invokeCommand('save_app_file', { name: SETTINGS_FILE, json: raw });
}
