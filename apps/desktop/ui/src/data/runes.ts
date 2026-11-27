/**
 * Rune catalog loading for the setup screen (BL-030b, SPECS §18.5).
 *
 * `<patch>/runes.json` is the static Data Dragon `runesReforged` catalog the
 * ETL publishes next to `champions.json` (SPECS §20 archive layout). It
 * resolves style/keystone/perk ids to display names and CDN icon paths;
 * stat shards are not part of the catalog and never resolve. A missing file
 * means "no catalog" (pages still render their stats), a corrupt file fails
 * closed like every manifest file.
 */

import { runeTreesSchema, type RuneTrees } from '@draftorb/shared';

import { cacheRead } from './aggregates';

/** One resolvable rune/style catalog entry (id -> name + icon path). */
export interface RuneIconInfo {
  readonly id: number;
  readonly name: string;
  readonly icon: string;
}

/**
 * Index every style and perk id of the rune catalog for name/icon lookup.
 * Keystones are perks (slot 0 of each tree); stat shards are absent.
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

const ICON_BASE = 'https://ddragon.leagueoflegends.com/cdn';

/** CDN URL for a catalog `icon` path (`perk-images/...`); null without a version. */
export function runeIconUrl(version: string | null, icon: string): string | null {
  if (version === null) return null;
  return `${ICON_BASE}/${version}/img/${icon}`;
}

/**
 * Loads `<patch>/runes.json` from the data cache. Returns null when the
 * cached release has no catalog; throws on invalid JSON or a schema
 * failure (fail-closed, same contract as the other manifest files).
 */
export async function loadRuneCatalog(patch: string): Promise<RuneTrees | null> {
  const raw = await cacheRead(`${patch}/runes.json`);
  if (raw === null) return null;
  return runeTreesSchema.parse(JSON.parse(raw));
}
