/**
 * Data Dragon importer for champions, items, and runes.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { defaultPublicDataDir } from './config/paths';
import { invalidateManifest } from './public-data';
import {
  type ChampionsMap,
  championsMapSchema,
  type ChampionRoleProbabilities,
  type ItemsMap,
  itemsMapSchema,
  type Role,
  type RuneTrees,
  runeTreesSchema,
} from '@draftorb/shared';

import { deriveChampionRoles } from './derive-roles';

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
 * Extracts the 2-component patch identifier from a full game or Data Dragon version.
 * E.g., '14.23.1' -> '14.23', '16.21.1' -> '16.21'.
 */
export function getPatchFromVersion(version: string): string {
  const parts = version.trim().split('.');
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new Error(
      `Invalid version format: "${version}". Expected at least two dot-separated segments.`,
    );
  }
  return `${parts[0]}.${parts[1]}`;
}

/**
 * Maps Data Dragon static class tags to draft roles.
 */
export function mapChampionTagsToRoles(tags: readonly string[] | undefined): Role[] {
  const roles = new Set<Role>();
  for (const tag of tags ?? []) {
    switch (tag) {
      case 'Support':
        roles.add('SUPPORT');
        break;
      case 'Marksman':
        roles.add('ADC');
        break;
      case 'Mage':
      case 'Assassin':
        roles.add('MID');
        break;
      case 'Fighter':
      case 'Tank':
        roles.add('TOP');
        break;
    }
  }
  if (roles.size === 0) {
    roles.add('MID');
  }
  return Array.from(roles);
}

/**
 * Transforms raw champion dictionary from Data Dragon into a validated ChampionsMap.
 *
 * When `roleProbabilities` is provided (observed `role_prob` data), each
 * champion's roles are derived from the observed probabilities, replacing the
 * Data Dragon champion-tag bootstrap hint. Champions without role-prob data
 * keep their tag-derived roles.
 */
export function transformChampions(
  rawData: Record<string, RawDDragonChampion>,
  roleProbabilities?: ChampionRoleProbabilities,
): ChampionsMap {
  const champions: Record<string, unknown> = {};
  const derivedRoles =
    roleProbabilities === undefined ? undefined : deriveChampionRoles(roleProbabilities);

  for (const rawChamp of Object.values(rawData)) {
    const id = parseInt(rawChamp.key, 10);
    if (isNaN(id) || id <= 0) {
      continue;
    }
    const roles = derivedRoles?.[String(id)] ?? mapChampionTagsToRoles(rawChamp.tags);
    const champion = {
      id,
      name: rawChamp.name,
      icon: rawChamp.image?.full ?? `${rawChamp.id}.png`,
      roles,
    };
    champions[String(id)] = champion;
  }

  return championsMapSchema.parse(champions);
}

/**
 * Transforms raw item dictionary from Data Dragon into a validated ItemsMap.
 */
export function transformItems(rawData: Record<string, RawDDragonItem>): ItemsMap {
  const items: Record<string, unknown> = {};

  for (const [idStr, rawItem] of Object.entries(rawData)) {
    const id = parseInt(idStr, 10);
    if (isNaN(id) || id <= 0) {
      continue;
    }
    if (!rawItem.name || !rawItem.name.trim()) {
      // Data Dragon contains empty-name internal placeholder items; skip them
      continue;
    }

    const item = {
      id,
      name: rawItem.name.trim(),
      icon: rawItem.image?.full ?? '',
      goldTotal: rawItem.gold?.total ?? 0,
      purchasable: Boolean(rawItem.gold?.purchasable),
      tags: rawItem.tags ?? [],
      from: (rawItem.from ?? []).map((x) => parseInt(x, 10)).filter((n) => !isNaN(n) && n > 0),
      into: (rawItem.into ?? []).map((x) => parseInt(x, 10)).filter((n) => !isNaN(n) && n > 0),
      stats: rawItem.stats ?? {},
    };

    items[String(id)] = item;
  }

  return itemsMapSchema.parse(items);
}

/**
 * Transforms raw runesReforged array from Data Dragon into validated RuneTrees.
 */
export function transformRunes(rawTrees: RawDDragonRuneTree[]): RuneTrees {
  const trees = rawTrees.map((tree) => ({
    id: tree.id,
    key: tree.key,
    icon: tree.icon,
    name: tree.name,
    slots: (tree.slots ?? []).map((slot) => ({
      runes: (slot.runes ?? []).map((rune) => ({
        id: rune.id,
        key: rune.key,
        name: rune.name,
        icon: rune.icon,
        shortDesc: rune.shortDesc,
      })),
    })),
  }));

  return runeTreesSchema.parse(trees);
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
