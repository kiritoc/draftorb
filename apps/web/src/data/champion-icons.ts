/**
 * @draftorb/web — Champion avatar URLs (Data Dragon CDN).
 *
 * `champions.json` stores only the icon file name (e.g. `Annie.png`). The
 * export patch is a `major.minor` label (`16.22`) while Data Dragon CDN paths
 * need a full version (`16.22.1`), resolved through `api/versions.json`
 * (newest first). Every helper degrades to `null` on failure so a CDN outage
 * never blocks the app — the grid then renders a letter placeholder.
 */

const VERSIONS_URL = 'https://ddragon.leagueoflegends.com/api/versions.json';
const ICON_BASE = 'https://ddragon.leagueoflegends.com/cdn';

let versionsPromise: Promise<string[] | null> | null = null;

/** Fetch the Data Dragon version list once per session; null on failure. */
export function loadDDragonVersions(): Promise<string[] | null> {
  versionsPromise ??= fetch(VERSIONS_URL)
    .then(async (response) => {
      if (!response.ok) {
        return null;
      }
      const body: unknown = await response.json();
      return Array.isArray(body) && body.every((v) => typeof v === 'string') ? body : null;
    })
    .catch(() => null);
  return versionsPromise;
}

/** Pick the newest full version matching a `major.minor` patch label. */
export function resolveIconVersion(patch: string, versions: readonly string[]): string | null {
  const prefix = `${patch}.`;
  return versions.find((v) => v === patch || v.startsWith(prefix)) ?? null;
}

/** Resolve the CDN version for an export patch; null when unavailable. */
export async function loadChampionIconVersion(patch: string): Promise<string | null> {
  const versions = await loadDDragonVersions();
  return versions === null ? null : resolveIconVersion(patch, versions);
}

/** Build the CDN URL for a champion icon; null without a resolved version. */
export function championIconUrl(version: string | null, icon: string): string | null {
  if (version === null) {
    return null;
  }
  return `${ICON_BASE}/${version}/img/champion/${encodeURIComponent(icon)}`;
}
