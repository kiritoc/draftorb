/**
 * Data Dragon importer for champions, items, and runes.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { defaultPublicDataDir } from './config/paths';
import { invalidateManifest } from './public-data';
import { type ChampionsMap, type ItemsMap, type RuneTrees } from '@draftorb/shared';

import {
  getPatchFromVersion,
  transformChampions,
  transformItems,
  transformRunes,
} from './ddragon-transform';

// Pure transforms live in ddragon-transform.ts; re-exported so existing
// imports keep working.
export {
  getPatchFromVersion,
  mapChampionTagsToRoles,
  transformChampions,
  transformItems,
  transformRunes,
} from './ddragon-transform';

const DDRAGON_BASE = 'https://ddragon.leagueoflegends.com';

export interface RawDDragonChampion {
  id: string;
  key: string;
  name: string;
  image?: { full?: string };
  tags?: string[];
}

export interface RawDDragonItem {
  name: string;
  image?: { full?: string };
  gold?: { total?: number; purchasable?: boolean };
  tags?: string[];
  from?: string[];
  into?: string[];
  stats?: Record<string, number>;
  /** Raw classification fields used by `etl classify-items` (D-082). */
  maps?: Record<string, boolean>;
  inStore?: boolean;
  specialRecipe?: number;
  consumed?: boolean;
  hideFromAll?: boolean;
  depth?: number;
  requiredChampion?: string;
}

export interface RawDDragonRunePerk {
  id: number;
  key?: string;
  name: string;
  icon: string;
  shortDesc?: string;
}

export interface RawDDragonRuneTree {
  id: number;
  key: string;
  icon: string;
  name: string;
  slots: { runes: RawDDragonRunePerk[] }[];
}

export interface ImportOptions {
  version?: string;
  outputDir?: string;
  fetchFn?: typeof fetch;
}

export interface ImportResult {
  version: string;
  patch: string;
  championsCount: number;
  itemsCount: number;
  runeTreesCount: number;
  outputPaths: { champions: string; items: string; runes: string };
}

/**
 * Fetches the latest game version string from Data Dragon (or returns customVersion if provided).
 */
export function fetchLatestVersion(customVersion?: string, fetchFn = fetch): Promise<string> {
  if (customVersion && customVersion.trim()) {
    return Promise.resolve(customVersion.trim());
  }
  return fetchFn(`${DDRAGON_BASE}/api/versions.json`)
    .then((res) => {
      if (!res.ok) {
        throw new Error(
          `Failed to fetch Data Dragon versions: HTTP ${res.status} ${res.statusText}`,
        );
      }
      return res.json() as Promise<string[]>;
    })
    .then((versions) => {
      const latest = versions[0];
      if (!latest) {
        throw new Error('Data Dragon returned empty versions array.');
      }
      return latest;
    });
}

/**
 * Fetches and transforms Data Dragon champion.json for a given version.
 */
export async function fetchChampions(version: string, fetchFn = fetch): Promise<ChampionsMap> {
  const url = `${DDRAGON_BASE}/cdn/${version}/data/en_US/champion.json`;
  const res = await fetchFn(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch champions from ${url}: HTTP ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { data: Record<string, RawDDragonChampion> };
  return transformChampions(json.data ?? {});
}

/**
 * Fetches and transforms Data Dragon item.json for a given version.
 */
export async function fetchItems(version: string, fetchFn = fetch): Promise<ItemsMap> {
  const url = `${DDRAGON_BASE}/cdn/${version}/data/en_US/item.json`;
  const res = await fetchFn(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch items from ${url}: HTTP ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { data: Record<string, RawDDragonItem> };
  return transformItems(json.data ?? {});
}

/**
 * Fetches the RAW Data Dragon item.json (untransformed) for classification.
 * Unlike `fetchItems`, this keeps fields the transformed `ItemsMap` drops
 * (`maps`, `specialRecipe`, `inStore`, `consumed`, `hideFromAll`, `depth`,
 * `requiredChampion`) which `etl classify-items` needs (D-082).
 */
export async function fetchRawItems(
  version: string,
  fetchFn = fetch,
): Promise<Record<string, RawDDragonItem>> {
  const url = `${DDRAGON_BASE}/cdn/${version}/data/en_US/item.json`;
  const res = await fetchFn(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch items from ${url}: HTTP ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { data: Record<string, RawDDragonItem> };
  return json.data ?? {};
}

/**
 * Fetches and transforms Data Dragon runesReforged.json for a given version.
 */
export async function fetchRunes(version: string, fetchFn = fetch): Promise<RuneTrees> {
  const url = `${DDRAGON_BASE}/cdn/${version}/data/en_US/runesReforged.json`;
  const res = await fetchFn(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch runes from ${url}: HTTP ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as RawDDragonRuneTree[];
  return transformRunes(json);
}

/**
 * Imports static Data Dragon data (champions, items, runes) and writes them to data/public/<patch>/.
 */
export async function importStaticData(options: ImportOptions = {}): Promise<ImportResult> {
  const fetchFn = options.fetchFn ?? fetch;
  const version = await fetchLatestVersion(options.version, fetchFn);
  const patch = getPatchFromVersion(version);

  const baseDir = options.outputDir ?? defaultPublicDataDir();
  const patchDir = path.join(baseDir, patch);

  const [champions, items, runes] = await Promise.all([
    fetchChampions(version, fetchFn),
    fetchItems(version, fetchFn),
    fetchRunes(version, fetchFn),
  ]);

  await mkdir(patchDir, { recursive: true });
  invalidateManifest(patchDir);

  const championsPath = path.join(patchDir, 'champions.json');
  const itemsPath = path.join(patchDir, 'items.json');
  const runesPath = path.join(patchDir, 'runes.json');

  await Promise.all([
    writeFile(championsPath, JSON.stringify(champions, null, 2), 'utf-8'),
    writeFile(itemsPath, JSON.stringify(items, null, 2), 'utf-8'),
    writeFile(runesPath, JSON.stringify(runes, null, 2), 'utf-8'),
  ]);

  return {
    version,
    patch,
    championsCount: Object.keys(champions).length,
    itemsCount: Object.keys(items).length,
    runeTreesCount: runes.length,
    outputPaths: {
      champions: championsPath,
      items: itemsPath,
      runes: runesPath,
    },
  };
}
