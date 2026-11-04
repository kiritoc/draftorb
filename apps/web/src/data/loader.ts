/**
 * @draftorb/web — Data loader.
 *
 * Fetches the versioned data export from `data/public` (the web root in
 * production, mirrored at `/` by the vite dev server). Resolves the current
 * patch through `latest.json` (D-051), then loads the manifest and every
 * export file it lists.
 */

import {
  type Champion,
  type Latest,
  type Manifest,
  type ChampionTagsMap,
  championsMapSchema,
  championTagsMapSchema,
  latestSchema,
  manifestSchema,
} from '@draftorb/shared';

/** Root-relative base for the exported data tree. `data/public` is the web
 *  root when statically hosted; the vite dev server mirrors it at `/`. */
const DATA_BASE = '';

async function fetchJsonBody(response: Response, path: string): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`Failed to load ${path} (${response.status} ${response.statusText})`);
  }
  return response.json();
}

/** Fetch and schema-validate a JSON file. */
export async function fetchJson<T>(
  path: string,
  schema: { parse: (value: unknown) => T },
): Promise<T> {
  const response = await fetch(`${DATA_BASE}${path}`);
  return schema.parse(await fetchJsonBody(response, path));
}

/** Resolve the current patch through the latest-patch pointer (D-051). */
export async function loadLatest(): Promise<Latest> {
  return fetchJson('latest.json', latestSchema);
}

/** Load the manifest referenced by the latest-patch pointer. */
export async function loadManifest(path: string): Promise<Manifest> {
  return fetchJson(path, manifestSchema);
}

/** Load every export file listed in the manifest. */
export interface LoadedExport {
  patch: string;
  manifest: Manifest;
  files: Record<string, unknown>;
}

export async function loadExportFiles(manifest: Manifest): Promise<LoadedExport> {
  const files: Record<string, unknown> = {};
  for (const file of manifest.files) {
    const response = await fetch(`${DATA_BASE}${manifest.patch}/${file.path}`);
    files[file.path] = await fetchJsonBody(response, file.path);
  }
  return { patch: manifest.patch, manifest, files };
}

/** Load the champion catalog for a patch (values of the champions map). */
export async function loadChampions(patch: string): Promise<Champion[]> {
  const map = await fetchJson(`${patch}/champions.json`, championsMapSchema);
  return Object.values(map);
}

/** Load the checked-in manual champion tags published with the web app. */
export async function loadChampionTags(): Promise<ChampionTagsMap> {
  return fetchJson('champion-tags.json', championTagsMapSchema);
}
