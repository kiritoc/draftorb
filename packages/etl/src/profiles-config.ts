/**
 * @draftorb/etl — Configured profile loading (T-091, D-068).
 *
 * Reads and validates the committed `data/profiles.config.json`. Only the
 * profiles listed here are ever synced — visitors cannot add any, and
 * adding another person's profile requires their consent (SETUP.md).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { profileConfigSchema, type ProfileConfig, type ProfileConfigEntry } from '@draftorb/shared';

import { PLATFORMS, platformToRegion, type Platform, type RegionalRouting } from './riot';
import { defaultDataDir } from './config/paths';
import { UsageError } from './cli-args';

export function defaultProfilesConfigPath(): string {
  return join(defaultDataDir(), 'profiles.config.json');
}

/** Load and validate the profile config; throws on missing/invalid file. */
export function loadProfilesConfig(configPath = defaultProfilesConfigPath()): ProfileConfig {
  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch (error) {
    throw new Error(
      `Cannot read profiles config at ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Profiles config at ${configPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return profileConfigSchema.parse(parsed);
}

export interface ProfileRouting {
  platform: Platform;
  region: RegionalRouting;
}

/**
 * Resolve a config entry's platform label (e.g. `EUW1`) to the lowercase
 * Riot platform and its regional routing. Throws a UsageError on an unknown
 * platform so a typo fails loudly instead of silently syncing nowhere.
 */
export function profileRouting(entry: ProfileConfigEntry): ProfileRouting {
  const platform = PLATFORMS.find((candidate) => candidate === entry.platform.toLowerCase());
  if (!platform) {
    throw new UsageError(
      `Unknown platform "${entry.platform}" for profile "${entry.id}". Expected one of: ${PLATFORMS.join(', ')}`,
    );
  }
  return { platform, region: platformToRegion(platform) };
}
