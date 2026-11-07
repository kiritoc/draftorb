/**
 * @draftorb/web — Configured-profile loader (T-093, D-072).
 *
 * Fetches `profiles/index.json` then the first exported profile's JSON and
 * validates both with the shared schemas. Any failure (missing files, bad
 * JSON, schema mismatch) disables personalization: the function returns
 * null and logs a dev notice — it never throws into the draft screen.
 */

import { profileExportSchema, profileIndexSchema, type ProfileExport } from '@draftorb/shared';

import { fetchJson } from './loader.js';

export async function loadProfile(): Promise<ProfileExport | null> {
  try {
    const index = await fetchJson('profiles/index.json', profileIndexSchema);
    const entry = index.profiles[0];
    if (entry === undefined) {
      return null;
    }
    return await fetchJson(`profiles/${entry.file}`, profileExportSchema);
  } catch (error) {
    console.warn(
      '[draftorb] profile export unavailable — personalized features are disabled:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
