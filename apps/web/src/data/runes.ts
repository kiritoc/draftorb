/**
 * @draftorb/web — Rune export + icon catalog loading (T-041, SPECS §8.1).
 *
 * `roles/<ROLE>/runes/<championId>.json` is fetched lazily for the picked
 * champion only (404 -> no rune data, never an error). `runes.json` is the
 * static Data Dragon catalog kept at the patch root; its perk/style `icon`
 * fields are already `perk-images/...` paths relative to the CDN `img/` dir.
 */

import {
  type Role,
  type RuneExport,
  type RuneTrees,
  runeExportSchema,
  runeTreesSchema,
} from '@draftorb/shared';
import { fetchJson } from './loader.js';

const DATA_BASE = '';
const ICON_BASE = 'https://ddragon.leagueoflegends.com/cdn';

/** One resolvable rune/style icon entry (perk or style id -> name + icon path). */
export interface RuneIconInfo {
  readonly id: number;
  readonly name: string;
  readonly icon: string;
}

/**
 * Index every style and perk id of the rune catalog for icon lookup.
 * Keystones are perks (slot 0 of each tree); stat shards are not part of
 * `runesReforged` and therefore never resolve — the adaptation hint falls
 * back to text for them.
 */
export function buildRuneIconIndex(trees: RuneTrees): ReadonlyMap<number, RuneIconInfo> {
  const index = new Map<number, RuneIconInfo>();
  for (const tree of trees) {
    index.set(tree.id, { id: tree.id, name: tree.name, icon: tree.icon });
    for (const slot of tree.slots) {
      for (const perk of slot.runes) {
        index.set(perk.id, { id: perk.id, name: perk.name, icon: perk.icon });
      }
    }
  }
  return index;
}

/** CDN URL for a catalog `icon` path (`perk-images/...`), null without a version. */
export function runeIconUrl(version: string | null, icon: string): string | null {
  if (version === null) {
    return null;
  }
  return `${ICON_BASE}/${version}/img/${icon}`;
}

async function fetchJsonOrNull<T>(
  path: string,
  schema: { parse: (value: unknown) => T },
): Promise<T | null> {
  const response = await fetch(`${DATA_BASE}${path}`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Failed to load ${path} (${response.status} ${response.statusText})`);
  }
  return schema.parse(await response.json());
}

/** Load the per-champion rune export; null when the export has none (404). */
export async function loadRuneExport(
  patch: string,
  role: Role,
  championId: number,
): Promise<RuneExport | null> {
  return fetchJsonOrNull(`${patch}/roles/${role}/runes/${championId}.json`, runeExportSchema);
}

/** Load the static rune catalog (`<patch>/runes.json`) for icon lookup. */
export async function loadRuneCatalog(patch: string): Promise<RuneTrees> {
  return fetchJson(`${patch}/runes.json`, runeTreesSchema);
}
